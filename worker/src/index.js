// API de cafecita.app en Cloudflare (Worker + D1). Sustituye a Supabase:
//
//  GET  /noticias          titulares de portada, ya ordenados
//  GET  /hemeroteca?id=…   un titular que ya salió de portada ([] si no está)
//  POST /registrar         tanda de eventos de analítica (medir.js)
//  POST /refrescar         rehace la portada a mano (como mucho una vez cada 10 min)
//  GET  /bar/libre?id=…    ¿está libre cafecita.app/<id>/ para un bar nuevo?
//  POST /bar/alta          un bar se da de alta solo y recibe su código de acceso (una vez)
//
// El cron (wrangler.toml) rehace la portada a los minutos 7 y 37: lee los RSS de los periódicos,
// quita duplicados entre ellos, alterna fuentes y guarda las nuevas también en la hemeroteca.

const MAX_AGE_H = 36;
const MAX_ITEMS = 160;
const PER_SOURCE = 30;
const MIN_GAP_MIN = 10;

// [nombre visible, url del feed, dominio al que deben apuntar los enlaces]
const FEEDS = [
  ['El País', 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', 'elpais.com'],
  ['elDiario.es', 'https://www.eldiario.es/rss/', 'eldiario.es'],
  ['El Mundo', 'https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml', 'elmundo.es'],
  ['20minutos', 'https://www.20minutos.es/rss/', '20minutos.es'],
  ['La Vanguardia', 'https://www.lavanguardia.com/rss/home.xml', 'lavanguardia.com'],
  ['ABC', 'https://www.abc.es/rss/2.0/portada/', 'abc.es'],
  ['Europa Press', 'https://www.europapress.es/rss/rss.aspx', 'europapress.es'],
];

const UA = 'Mozilla/5.0 (compatible; CafecitaBot/1.0; +https://cafecita.app/)';
// «carta»: alguien abre la carta de un bar (con su id en los datos, como el resto de eventos de bar)
const EVENTOS = new Set(['visita', 'dia', 'servilleta', 'enlace', 'compartir', 'bola', 'bienvenida', 'carta']);
const BATCH = 25;

// ---------- Respuestas ----------
// Todo es público (titulares y eventos anónimos), así que vale cualquier origen
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const json = (body, status = 200, maxAge = 0) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
});

// La portada solo cambia cada media hora: cada copia del Worker la guarda un minuto en memoria
let memo = { at: 0, body: null };
async function portada(db) {
  if (memo.body && Date.now() - memo.at < 60e3) return memo.body;
  const row = await db.prepare('select noticias from portada where id = 1').first();
  memo = { at: Date.now(), body: row?.noticias ?? '[]' };
  return memo.body;
}

async function hemeroteca(db, id) {
  if (!/^[\w-]{1,40}$/.test(id || '')) return json([], 400);
  const row = await db.prepare('select id, titular, fuente, url, fecha from hemeroteca where id = ?').bind(id).first();
  return row ? json([row], 200, 86400) : json([]);
}

// La web manda los eventos en tandas: {"eventos": [{"e": "servilleta", "d": {...}}, ...]} (como mucho 25).
// Lo que no cumple las reglas se descarta sin tumbar el resto de la tanda.
const madrid = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }); // «AAAA-MM-DD»
const bytes = (s) => new TextEncoder().encode(s).length;
async function registrar(db, request) {
  const text = await request.text();
  if (text.length > 32e3) return json({ ok: false }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ ok: false }, 400); }
  const eventos = Array.isArray(body?.eventos) ? body.eventos.slice(0, BATCH) : [];
  const now = new Date(), creado = now.toISOString(), dia = madrid.format(now);
  const insert = db.prepare('insert into eventos (creado, dia, evento, datos) values (?, ?, ?, ?)');
  const rows = [];
  for (const ev of eventos) {
    const d = ev?.d ?? {};
    if (!EVENTOS.has(ev?.e) || typeof d !== 'object' || d === null || Array.isArray(d)) continue;
    const datos = JSON.stringify(d);
    if (bytes(datos) >= 512) continue;
    rows.push(insert.bind(creado, dia, ev.e, datos));
  }
  if (rows.length) await db.batch(rows);
  return new Response(null, { status: 204, headers: CORS });
}

// ---------- RSS ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function unescape(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function clean(s = '') {
  s = s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return unescape(unescape(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// «Última hora de la guerra, en directo | Zelenski anuncia…» → «Zelenski anuncia…»
function headline(title) {
  const i = title.indexOf(' | ');
  if (i < 0) return title;
  const head = title.slice(0, i), rest = title.slice(i + 3);
  return /directo|última hora/i.test(head) && rest.length >= 25 ? rest : title;
}

const TAGS = Object.fromEntries(['title', 'link', 'pubDate', 'dc:date'].map((n) => [n, new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'i')]));
const tag = (xml, name) => xml.match(TAGS[name])?.[1];

// Solo enlaces http(s) al propio periódico: el feed no puede colar otra web
function safeLink(link, domain) {
  try {
    const u = new URL(clean(link));
    const host = u.hostname.toLowerCase();
    if (!/^https?:$/.test(u.protocol) || !(host === domain || host.endsWith('.' + domain))) return null;
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return null;
  }
}

async function sha1(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}

async function items(name, url, domain, now) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  const out = [];
  for (const [, item] of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const titular = headline(clean(tag(item, 'title')));
    const link = safeLink(tag(item, 'link'), domain);
    const raw = clean(tag(item, 'pubDate') ?? tag(item, 'dc:date') ?? '');
    const t = raw ? Date.parse(raw) : NaN;
    if (titular.length < 25 || !link) continue;
    if (!isNaN(t) && (now - t > MAX_AGE_H * 3600e3 || t - now > 2 * 3600e3)) continue;
    out.push({ titular, fuente: name, url: link, fecha: new Date(isNaN(t) ? now : t).toISOString() }); // el id, después
    if (out.length >= PER_SOURCE) break;
  }
  return out;
}

function words(title) {
  const t = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return new Set((t.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 3));
}
// La misma noticia contada por dos periódicos: comparten al menos 3 palabras y el 40 % de las del
// titular más corto. Con un índice palabra → titulares solo se miran los que comparten alguna,
// en vez de todos contra todos (que se comía la CPU).
function stories() {
  const index = new Map(), sizes = [];
  return {
    seen(w) {
      const shared = new Map();
      for (const x of w) for (const j of index.get(x) ?? []) shared.set(j, (shared.get(j) ?? 0) + 1);
      for (const [j, s] of shared) if (s >= 3 && s / Math.max(1, Math.min(w.size, sizes[j])) >= 0.4) return true;
      return false;
    },
    add(w) {
      const j = sizes.push(w.size) - 1;
      for (const x of w) index.has(x) ? index.get(x).push(j) : index.set(x, [j]);
    },
  };
}

async function refrescar(db) {
  const now = Date.now();
  const log = [];
  const perSource = (await Promise.all(FEEDS.map(async ([name, url, domain]) => {
    try {
      const got = await items(name, url, domain, now);
      log.push(`${name}: ${got.length}`);
      return got;
    } catch (e) { // un periódico caído no tumba al resto
      log.push(`${name}: ${e.message}`);
      return [];
    }
  }))).filter((s) => s.length);

  // portada alternando periódicos: el 1º de cada uno, luego el 2º…
  const merged = [], urls = new Set(), seen = stories();
  for (let rank = 0; rank < Math.max(0, ...perSource.map((s) => s.length)); rank++) {
    for (const src of perSource) {
      const n = src[rank];
      if (!n || urls.has(n.url)) continue;
      const w = words(n.titular);
      if (seen.seen(w)) continue;
      urls.add(n.url);
      seen.add(w);
      merged.push(n);
    }
  }
  const rows = merged.slice(0, MAX_ITEMS);
  if (rows.length < 10) return { ok: false, error: `solo ${rows.length} titulares, no se toca la portada`, log };

  // El id es el sha1 del enlace (la web y la hemeroteca dependen de él). Los que ya estaban en
  // portada lo traen de antes; solo se calcula, y se archiva en la hemeroteca, el de los nuevos.
  const prev = new Map(JSON.parse((await db.prepare('select noticias from portada where id = 1').first())?.noticias ?? '[]').map((n) => [n.url, n.id]));
  const fresh = [];
  for (const n of rows) {
    n.id = prev.get(n.url);
    if (!n.id) fresh.push(n);
  }
  await Promise.all(fresh.map(async (n) => { n.id = await sha1(n.url); }));
  const archivar = db.prepare('insert or ignore into hemeroteca (id, titular, fuente, url, fecha) values (?, ?, ?, ?, ?)');
  await db.batch([
    ...fresh.map((n) => archivar.bind(n.id, n.titular, n.fuente, n.url, n.fecha)),
    db.prepare('insert into portada (id, actualizado, noticias) values (1, ?, ?) on conflict (id) do update set actualizado = excluded.actualizado, noticias = excluded.noticias')
      .bind(new Date().toISOString(), JSON.stringify(rows)),
  ]);
  memo = { at: 0, body: null };
  return { ok: true, titulares: rows.length, log };
}

// ---------- Bares ----------
// La ficha de cada bar (lo que cambia en su gestión) vive en D1. Leerla es público; cambiarla
// pide su código de acceso, que el bar recibe al darse de alta (o que Cafecita le da a mano).
// Del código solo se guarda su SHA-256. El plan (gratis o Pro) lo pone Cafecita: el bar no puede tocarlo.
const BAR_ID = /^[a-z0-9-]{2,40}$/;
const ALERGENOS = new Set(['gluten', 'crustaceos', 'huevos', 'pescado', 'cacahuetes', 'soja', 'lacteos', 'frutos', 'apio', 'mostaza', 'sesamo', 'sulfitos', 'altramuces', 'moluscos']);
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');
// el código se escribe como se quiera (minúsculas, con o sin guiones): se compara normalizado
const normalizarCodigo = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function barDe(db, id) {
  if (!BAR_ID.test(id || '')) return null;
  return db.prepare('select datos, plan, codigo from bares where id = ?').bind(id).first();
}
async function autorizado(row, codigo) {
  const c = normalizarCodigo(codigo);
  return !!row && c.length >= 12 && (await sha256(c)) === row.codigo;
}

// Lo que llega de la gestión se reescribe campo a campo: solo lo que conocemos, con su tamaño
function limpiarBar(d, id) {
  const txt = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const precio = (v) => (v === '' || v == null || !Number.isFinite(+v) ? '' : Math.round(+v * 100) / 100);
  const alergenos = (v) => (Array.isArray(v) ? [...new Set(v.filter((a) => ALERGENOS.has(a)))] : null);
  const m = d?.marca ?? {};
  const logo = typeof m.logo === 'string' && (/^data:image\/(svg\+xml|png|jpeg|webp)[;,]/.test(m.logo) || /^bares\/[a-z0-9-]+\/logo\.svg$/.test(m.logo)) && m.logo.length < 600e3 ? m.logo : '';
  return {
    id,
    nombre: txt(d?.nombre, 60) || id,
    direccion: txt(d?.direccion, 120),
    horario: txt(d?.horario, 120),
    marca: {
      logo,
      color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#1F6B45',
      servilletero: ['inox', 'blanco', 'negro'].includes(m.servilletero) ? m.servilletero : 'inox',
      letra: ['clasica', 'rotulador', 'pizarra', 'pincel'].includes(m.letra) ? m.letra : 'clasica',
      marcoQr: m.marcoQr !== false,
    },
    sugerencias: (Array.isArray(d?.sugerencias) ? d.sugerencias : []).slice(0, 20).map((x) => ({
      tipo: ['fuera', 'propio'].includes(x?.tipo) ? x.tipo : 'sugerencia', texto: txt(x?.texto, 80), precio: precio(x?.precio), alergenos: alergenos(x?.alergenos),
      // con Pro, el título que el bar le pone a su servilleta («Plato del día»)
      ...(x?.tipo === 'propio' ? { titulo: txt(x?.titulo, 40) } : {}),
    })),
    carta: (Array.isArray(d?.carta) ? d.carta : []).slice(0, 20).map((sec) => ({
      seccion: txt(sec?.seccion, 60),
      platos: (Array.isArray(sec?.platos) ? sec.platos : []).slice(0, 80).map((p) => ({
        nombre: txt(p?.nombre, 80), precio: precio(p?.precio), alergenos: alergenos(p?.alergenos), agotado: p?.agotado === true, destacado: p?.destacado === true,
        ...(FOTO_ID.test(p?.foto ?? '') ? { foto: p.foto } : {}),
      })),
    })),
  };
}

async function leerBar(db, id) {
  const row = await barDe(db, id);
  if (!row) return json({ ok: false, error: 'no existe' }, 404);
  return json({ ...JSON.parse(row.datos), id, plan: row.plan });
}
async function entrarBar(db, request) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false }, 400); }
  const row = await barDe(db, body?.id);
  return (await autorizado(row, body?.codigo)) ? json({ ok: true }) : json({ ok: false, error: 'código no válido' }, 401);
}
async function guardarBar(db, request, id) {
  const row = await barDe(db, id);
  const codigo = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await autorizado(row, codigo))) return json({ ok: false, error: 'código no válido' }, 401);
  const text = await request.text();
  if (text.length > 800e3) return json({ ok: false, error: 'demasiado grande' }, 413);
  let d;
  try { d = JSON.parse(text); } catch { return json({ ok: false }, 400); }
  const datos = limpiarBar(d, id);
  const now = new Date().toISOString();
  // las fotos que ya no lleva ningún plato se borran, pero con un día de margen: una recién
  // subida aún no está en la ficha, y quitar una foto se puede deshacer
  const usadas = datos.carta.flatMap((sec) => sec.platos).map((p) => p.foto).filter(Boolean);
  await db.batch([
    db.prepare('update bares set datos = ?, actualizado = ? where id = ?').bind(JSON.stringify(datos), now, id),
    db.prepare('delete from fotos where bar = ? and creada < ? and id not in (select value from json_each(?))')
      .bind(id, new Date(Date.now() - 864e5).toISOString(), JSON.stringify(usadas)),
  ]);
  return json({ ok: true, actualizado: now });
}

// ---------- Alta de un bar (CAF-37) ----------
// El bar se da de alta solo desde cafecita.app/alta/: elige su dirección, recibe su código de
// acceso en pantalla (una sola vez: solo se guarda su SHA-256) y entra en su gestión. Su página
// no necesita carpeta: GitHub Pages sirve 404.html para cualquier cafecita.app/<id>/ (ver ruta.js).
// Direcciones que no pueden ser de un bar: las carpetas y ficheros de la web y alguna más.
// (la misma lista está en ruta.js)
const RESERVADOS = new Set(['404', 'admin', 'alta', 'api', 'app', 'apple-touch-icon', 'assets', 'ayuda', 'bar', 'bares', 'barmanolo',
  'blog', 'cafecita', 'carta', 'cname', 'demo', 'favicon', 'fonts', 'gestion', 'hola', 'img', 'imprimir', 'index', 'legal',
  'logo', 'models', 'napkins', 'og', 'precios', 'servilletero', 'static', 'stories', 'templates', 'tienda', 'tools', 'vendor',
  'worker', 'www']);
// hasta el 31 de enero de 2027, los bares que se dan de alta tienen Pro gratis (el piloto)
const FIN_PILOTO = Date.parse('2027-01-31T23:59:59+01:00');
// contra altas en masa: como mucho 5 al día desde una misma conexión (en datos móviles muchos comparten IP) y 40 al día en total
const ALTAS_IP_DIA = 5, ALTAS_DIA = 40;
// 12 caracteres de 31 posibles (sin letras que se confundan), como alta-bar.mjs
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function nuevoCodigo() {
  const out = [];
  while (out.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(24))) {
      if (b < 248 && out.length < 12) out.push(ABC[b % 31]); // 248 = 8 × 31: sin sesgo
    }
  }
  return out.join('');
}

async function libre(db, id) {
  if (!BAR_ID.test(id || '') || /^-|-$|--/.test(id)) return 'Usa letras, números y guiones (de 2 a 40).';
  if (RESERVADOS.has(id)) return 'Esa dirección no está disponible.';
  if (await db.prepare('select 1 from bares where id = ?').bind(id).first()) return 'Ya hay un bar con esa dirección.';
  return null;
}
async function barLibre(db, id) {
  const motivo = await libre(db, String(id ?? '').toLowerCase());
  return json(motivo ? { libre: false, motivo } : { libre: true });
}

async function altaBar(db, request) {
  const text = await request.text();
  if (text.length > 4e3) return json({ ok: false }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ ok: false }, 400); }
  // el campo trampa: invisible para una persona, los robots lo rellenan
  if (body?.web) return json({ ok: false, error: 'No se ha podido dar de alta.' }, 400);
  const id = String(body?.id ?? '').toLowerCase();
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim().slice(0, 60) : '';
  const direccion = typeof body?.direccion === 'string' ? body.direccion.trim().slice(0, 120) : '';
  if (nombre.length < 2) return json({ ok: false, error: 'Escribe el nombre de tu bar.' }, 400);
  // su WhatsApp, si lo deja (CAF-53): para ayudarle y devolverle el código. No va en la ficha
  // pública (columna aparte que leerBar no devuelve). Solo cifras y un + delante, de 9 a 15.
  const tel = String(body?.whatsapp ?? '').replace(/[\s().-]/g, '');
  if (tel && !/^\+?\d{9,15}$/.test(tel)) return json({ ok: false, error: 'Revisa el número de WhatsApp (o déjalo vacío).' }, 400);
  if (body?.acepto !== true) return json({ ok: false, error: 'Tienes que aceptar el aviso legal y la privacidad.' }, 400);
  const motivo = await libre(db, id);
  if (motivo) return json({ ok: false, error: motivo }, 409);

  // límites: de la conexión solo se guarda un resumen que cambia cada día, y una semana
  const now = new Date(), hoy = madrid.format(now);
  const ip = await sha256(`${request.headers.get('CF-Connecting-IP') || 'local'}|${hoy}`);
  const { porIp, total } = await db.prepare('select count(*) filter (where ip = ?) as porIp, count(*) as total from altas where dia = ?').bind(ip, hoy).first();
  if (porIp >= ALTAS_IP_DIA || total >= ALTAS_DIA) return json({ ok: false, error: 'Hoy no se pueden dar más altas. Escríbenos a hola@cafecita.es.' }, 429);

  const codigo = nuevoCodigo();
  const datos = {
    id, nombre, direccion, horario: '',
    marca: { logo: '', color: '#1F6B45', servilletero: 'inox', letra: 'clasica' },
    sugerencias: [], carta: [],
  };
  try {
    await db.batch([
      db.prepare('insert into bares (id, datos, plan, codigo, actualizado, contacto) values (?, ?, ?, ?, ?, ?)')
        .bind(id, JSON.stringify(datos), Date.now() <= FIN_PILOTO ? 'pro' : 'gratis', await sha256(codigo), now.toISOString(), tel || null),
      db.prepare('insert into altas (dia, ip, bar, creada) values (?, ?, ?, ?)').bind(hoy, ip, id, now.toISOString()),
      db.prepare('delete from altas where creada < ?').bind(new Date(now - 7 * 864e5).toISOString()),
    ]);
  } catch {
    // dos altas a la vez con la misma dirección: la segunda choca con la clave
    return json({ ok: false, error: 'Ya hay un bar con esa dirección.' }, 409);
  }
  return json({ ok: true, id, codigo: codigo.match(/.{4}/g).join('-') });
}

// ---------- Fotos de la carta (solo Pro) ----------
// Llegan ya recortadas y comprimidas desde el móvil (WebP o JPEG, de menos de 200 KB) y se
// guardan en D1 con su SHA-256 por nombre: una foto no cambia nunca, así que se puede guardar
// un año en el navegador. Cuando no quepan en D1 (5 GB), a R2.
const FOTO_ID = /^[0-9a-f]{32}$/;
const FOTO_MAX = 200e3;
const FOTOS_POR_BAR = 150;
// con el alta abierta, un tope para todos: que nadie llene la base de datos creando bares de prueba
const FOTOS_DIA = 400;
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
// lo que dicen sus primeros bytes, no lo que diga la petición
const tipoFoto = (b) => (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
  : ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' ? 'image/webp' : null);

async function subirFoto(db, request, id) {
  const row = await barDe(db, id);
  const codigo = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await autorizado(row, codigo))) return json({ ok: false, error: 'código no válido' }, 401);
  if (row.plan !== 'pro') return json({ ok: false, error: 'las fotos son de Pro' }, 403);
  if (+(request.headers.get('Content-Length') || 0) > FOTO_MAX) return json({ ok: false, error: 'demasiado grande' }, 413);
  const b = new Uint8Array(await request.arrayBuffer());
  if (!b.length || b.length > FOTO_MAX) return json({ ok: false, error: 'demasiado grande' }, 413);
  const tipo = tipoFoto(b);
  if (!tipo) return json({ ok: false, error: 'tiene que ser WebP o JPEG' }, 415);
  const { n } = await db.prepare('select count(*) as n from fotos where bar = ?').bind(id).first();
  if (n >= FOTOS_POR_BAR) return json({ ok: false, error: 'demasiadas fotos' }, 409);
  const { hoy } = await db.prepare('select count(*) as hoy from fotos where creada >= ?').bind(new Date(Date.now() - 864e5).toISOString()).first();
  if (hoy >= FOTOS_DIA) return json({ ok: false, error: 'hoy no se pueden subir más fotos' }, 429);
  const foto = [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
  await db.prepare('insert or ignore into fotos (bar, id, tipo, datos, creada) values (?, ?, ?, ?, ?)')
    .bind(id, foto, tipo, b, new Date().toISOString()).run();
  return json({ ok: true, foto });
}
async function verFoto(db, bar, id) {
  if (!BAR_ID.test(bar || '') || !FOTO_ID.test(id || '')) return json({ ok: false, error: 'no existe' }, 404);
  const row = await db.prepare('select tipo, datos from fotos where bar = ? and id = ?').bind(bar, id).first();
  if (!row) return json({ ok: false, error: 'no existe' }, 404);
  return new Response(new Uint8Array(row.datos), {
    headers: { ...CORS, 'Content-Type': row.tipo, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}

export default {
  async fetch(request, env) {
    const { pathname, searchParams } = new URL(request.url);
    const m = request.method;
    if (m === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
    if (m === 'GET' && pathname === '/noticias') {
      return new Response(await portada(env.DB), { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
    }
    if (m === 'GET' && pathname === '/hemeroteca') return hemeroteca(env.DB, searchParams.get('id'));
    if (m === 'POST' && pathname === '/registrar') return registrar(env.DB, request);
    if (m === 'GET' && pathname === '/bar') return leerBar(env.DB, searchParams.get('id'));
    if (m === 'POST' && pathname === '/bar/entrar') return entrarBar(env.DB, request);
    if (m === 'GET' && pathname === '/bar/libre') return barLibre(env.DB, searchParams.get('id'));
    if (m === 'POST' && pathname === '/bar/alta') return altaBar(env.DB, request);
    if (m === 'PUT' && pathname === '/bar') return guardarBar(env.DB, request, searchParams.get('id'));
    if (m === 'POST' && pathname === '/bar/foto') return subirFoto(env.DB, request, searchParams.get('id'));
    if (m === 'GET' && pathname === '/foto') return verFoto(env.DB, searchParams.get('bar'), searchParams.get('id'));
    if (m === 'POST' && pathname === '/refrescar') {
      const last = await env.DB.prepare('select actualizado from portada where id = 1').first();
      const since = last ? (Date.now() - Date.parse(last.actualizado)) / 60000 : Infinity;
      if (since < MIN_GAP_MIN) return json({ ok: true, skipped: `refrescado hace ${Math.round(since)} min` });
      const r = await refrescar(env.DB);
      return json(r, r.ok ? 200 : 502);
    }
    return json({ ok: false, error: 'no existe' }, 404);
  },

  async scheduled(_event, env) {
    const r = await refrescar(env.DB);
    console.log(JSON.stringify(r));
    if (!r.ok) throw new Error(r.error);
  },
};
