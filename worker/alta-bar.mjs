// ---------- Alta de un bar ----------
// De momento los bares no se registran solos: Cafecita los da de alta y les pasa un enlace con
// su código de acceso. Este script:
//   1. genera el código (12 caracteres sin letras que se confundan) y guarda solo su SHA-256,
//   2. crea sus páginas (<id>/, <id>/gestion/, <id>/imprimir/) a partir de las de Bar Manolo,
//   3. mete su ficha en D1 y
//   4. imprime el enlace que se le da al bar.
// Uso (desde servilletero/worker):
//   npm run alta -- <id> "<Nombre del bar>" [--pro] [--local]
//   npm run alta -- <id> --nuevo-codigo [--local]     (si pierde el código: le da uno nuevo)
// Las páginas nuevas hay que publicarlas después (commit y PR a main).
import { spawnSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const [id, nombre] = args.filter((a) => !a.startsWith('--'));
const local = flag('--local');

if (!/^[a-z0-9-]{2,40}$/.test(id || '') || id === 'barmanolo') {
  console.error('Uso: npm run alta -- <id> "<Nombre del bar>" [--pro] [--local]\n<id>: minúsculas, números y guiones (2 a 40), como en cafecita.app/<id>');
  process.exit(1);
}

// 12 caracteres de 31 posibles (~59 bits): imposible de adivinar a base de intentos
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const raw = Array.from({ length: 12 }, () => ABC[randomInt(ABC.length)]).join('');
const codigo = raw.match(/.{4}/g).join('-');
const hash = createHash('sha256').update(raw).digest('hex');
const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;
const now = new Date().toISOString();

function d1(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'cafecita', local ? '--local' : '--remote', '--yes', '--command', command], { cwd: dirname(fileURLToPath(import.meta.url)), stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (r.status !== 0) { console.error('\nNo se ha podido escribir en D1.'); process.exit(1); }
}

if (flag('--nuevo-codigo')) {
  d1(`update bares set codigo = ${sql(hash)}, actualizado = ${sql(now)} where id = ${sql(id)}`);
} else {
  if (!nombre?.trim()) { console.error('Falta el nombre del bar.'); process.exit(1); }
  // sus páginas: las de Bar Manolo con su id y su nombre
  for (const f of ['index.html', 'gestion/index.html', 'imprimir/index.html']) {
    const dest = join(WEB, id, f);
    if (existsSync(dest)) { console.error(`Ya existe ${id}/${f}: ¿el bar ya estaba dado de alta?`); process.exit(1); }
    const html = readFileSync(join(WEB, 'barmanolo', f), 'utf8').replaceAll('barmanolo', id).replaceAll('Bar Manolo', nombre.trim());
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, html);
  }
  const datos = {
    id, nombre: nombre.trim(), direccion: '', horario: '',
    marca: { logo: '', color: '#1F6B45', servilletero: 'inox', letra: 'clasica' },
    sugerencias: [], carta: [],
  };
  d1(`insert into bares (id, datos, plan, codigo, actualizado) values (${sql(id)}, ${sql(JSON.stringify(datos))}, ${sql(flag('--pro') ? 'pro' : 'gratis')}, ${sql(hash)}, ${sql(now)})`);
}

const base = local ? 'http://localhost:5174' : 'https://cafecita.app';
console.log(`
${flag('--nuevo-codigo') ? 'Código nuevo' : 'Alta hecha'}${local ? ' (en local)' : ''}: ${id}
  Su página:   ${base}/${id}/
  Su gestión:  ${base}/${id}/gestion/#codigo=${codigo}
  Su código:   ${codigo}

Pásale el enlace de su gestión (lleva el código). El código no se guarda en ningún sitio:
si lo pierde, npm run alta -- ${id} --nuevo-codigo${local ? ' --local' : ''}
${flag('--nuevo-codigo') ? '' : `Antes, publica sus páginas: ${id}/ (commit y PR a main).`}`);
