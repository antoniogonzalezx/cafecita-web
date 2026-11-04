// ---------- Bares ----------
// Cada bar tiene su página, cafecita.app/<bar>/, con el mismo servilletero que la web pero con lo
// suyo: sus sugerencias del día escritas a boli en la servilleta y su carta. Es gratis; con Pro,
// además, su logo, su color y su servilletero (ver «Cafecita y Cafecita Pro»).
// La ficha de cada bar dado de alta vive en el servidor (worker/, tabla «bares») y su gestión
// la cambia con el código de acceso que le da Cafecita. Bar Manolo es la demo: su ficha es
// bares/barmanolo.json y lo que se cambia en su gestión se queda en este navegador.
import { API as API_PROD } from './medir.js?v=14';

// en local se puede probar contra el Worker de wrangler dev: localStorage['cafecita.api'] = 'local'
const API = (() => {
  try { if (location.hostname === 'localhost' && localStorage.getItem('cafecita.api') === 'local') return 'http://localhost:8787'; } catch {}
  return API_PROD;
})();

export const DEFAULT_COLOR = '#3F48F4';
const KEY = (id) => `cafecita.bar.${id}`;

export const ALERGENOS = {
  gluten: 'Gluten', crustaceos: 'Crustáceos', huevos: 'Huevos', pescado: 'Pescado', cacahuetes: 'Cacahuetes',
  soja: 'Soja', lacteos: 'Lácteos', frutos: 'Frutos de cáscara', apio: 'Apio', mostaza: 'Mostaza',
  sesamo: 'Sésamo', sulfitos: 'Sulfitos', altramuces: 'Altramuces', moluscos: 'Moluscos',
};
// los colores que puede elegir un bar Pro: bastante oscuros para que se lea el blanco encima
export const COLORES = ['#1F6B45', '#8C2F2B', '#2B3F7A', '#6B3F1F', '#1E5C66', '#5A2A5E', '#3B3B3B', '#3F48F4'];
export const ACABADOS = { inox: 'Inox', blanco: 'Blanco', negro: 'Negro' };

export async function loadBar(id) {
  // dado de alta: su ficha, recién leída del servidor (remoto: se guarda allí)
  const remota = await fetch(`${API}/bar?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (remota) return { ...remota, remoto: true };
  // si no, la demo: la ficha del repo y lo que se haya cambiado en este navegador
  const base = await fetch(`bares/${id}.json`).then((r) => {
    if (!r.ok) throw new Error(`No se ha podido cargar el bar ${id}`);
    return r.json();
  });
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY(id))); } catch {}
  return saved && saved.id === id ? { ...base, ...saved, marca: { ...base.marca, ...saved.marca } } : base;
}
export function saveBar(bar) {
  localStorage.setItem(KEY(bar.id), JSON.stringify(bar));
}

// ---------- Acceso a la gestión (bares dados de alta) ----------
// ¿Vale este código para este bar? (lanza si no hay conexión, para no confundirlo con un código malo)
export async function entrar(id, codigo) {
  const r = await fetch(`${API}/bar/entrar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, codigo }),
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 401) return false;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return true;
}
// Guarda la ficha en el servidor. El plan no viaja: lo pone Cafecita.
export async function guardarRemoto(bar, codigo) {
  const { remoto, plan, ...datos } = bar;
  const r = await fetch(`${API}/bar?id=${encodeURIComponent(bar.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${codigo}` },
    body: JSON.stringify(datos), signal: AbortSignal.timeout(10000),
  });
  return r.status;
}
export function resetBar(id) {
  try { localStorage.removeItem(KEY(id)); } catch {}
}

export const isPro = (bar) => bar.plan === 'pro';

// ---------- Fotos de los platos (solo Pro) ----------
// En el servidor, cada foto es un id; en la demo se queda en el navegador como data URL.
export const fotoUrl = (bar, foto) => (foto.startsWith('data:') ? foto
  : `${API}/foto?bar=${encodeURIComponent(bar.id)}&id=${foto}`);

// La foto, cuadrada (lo del centro) y comprimida en el propio móvil: WebP si el navegador
// sabe hacerlo (Safari no) y si no JPEG, bajando la calidad hasta que pese menos de 190 KB.
const FOTO_LADO = 900;
export async function prepararFoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const lado = Math.min(bmp.width, bmp.height);
  const n = Math.min(FOTO_LADO, lado);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  c.getContext('2d').drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, n, n);
  bmp.close();
  const blob = (type, q) => new Promise((res) => c.toBlob(res, type, q));
  for (const q of [0.8, 0.7, 0.6, 0.5]) {
    let b = await blob('image/webp', q);
    if (b?.type !== 'image/webp') b = await blob('image/jpeg', q);
    if (b && b.size < 190e3) return b;
  }
  throw new Error('La foto no se ha podido comprimir');
}
// Devuelve el id de la foto o el estado HTTP si no se ha podido (403: el bar no es Pro)
export async function subirFoto(id, codigo, blob) {
  const r = await fetch(`${API}/bar/foto?id=${encodeURIComponent(id)}`, {
    method: 'POST', headers: { 'Content-Type': blob.type, Authorization: `Bearer ${codigo}` }, body: blob,
    signal: AbortSignal.timeout(20000),
  });
  return r.ok ? (await r.json()).foto : r.status;
}

// Las letras para lo que escribe el bar. Por defecto, la misma que «Gracias por su visita»;
// con Pro, el bar elige una a mano (esas van en mayúsculas, como se rotula una pizarra).
// size: lo grande que se escribe con ella (las estrechas, más; las anchas, algo menos).
export const LETRAS = {
  clasica: { nombre: 'Clásica', family: 'Fraunces', style: 'italic', caps: false, size: 1 },
  rotulador: { nombre: 'Rotulador', family: 'Shantell Sans', caps: true, size: 0.92 },
  pizarra: { nombre: 'Pizarra', family: 'Just Another Hand', caps: true, size: 1.25 },
  pincel: { nombre: 'Pincel', family: 'Caveat Brush', caps: true, size: 1.05 },
};
export const letraCss = (l, s) => `${l.style || 'normal'} 400 ${s}px '${l.family}', Georgia, serif`;


// Lo que sale en las servilletas, cada cosa en la suya y bien rotulada: la sugerencia del día,
// lo que hay fuera de carta y lo más pedido (los platos de la carta marcados como destacados).
export const TIPOS = { sugerencia: 'Sugerencia del día', fuera: 'Fuera de carta', estrella: 'Lo más pedido' };
const tipoDe = (s) => (s.tipo in TIPOS && s.tipo !== 'estrella' ? s.tipo : 'sugerencia');
export function servilletas(bar) {
  const hoy = (bar.sugerencias || []).filter((s) => s.texto?.trim());
  const de = (tipo) => hoy.filter((s) => tipoDe(s) === tipo).map(sugerencia);
  const estrellas = (bar.carta || []).flatMap((sec) => sec.platos)
    .filter((p) => p.destacado && !p.agotado && p.nombre?.trim())
    .map((p) => sugerencia({ texto: p.nombre, precio: p.precio }));
  return [
    { tipo: 'sugerencia', lines: de('sugerencia') },
    { tipo: 'fuera', lines: de('fuera') },
    { tipo: 'estrella', lines: estrellas },
  ].filter((x) => x.lines.length).map((x) => ({ ...x, title: titulo(x.tipo, x.lines.length) }));
}
// en plural si hay varias («Sugerencias del día»)
export function titulo(tipo, n = 1) {
  if (n > 1 && tipo === 'sugerencia') return 'Sugerencias del día';
  return TIPOS[tipo] || TIPOS.sugerencia;
}

// 6 → «6€», 5.5 → «5,50€» (en la servilleta, sin espacio, como lo escribe el camarero)
export function precio(n, space = false) {
  if (n === '' || n == null || Number.isNaN(+n)) return '';
  const s = Number.isInteger(+n) ? String(+n) : (+n).toFixed(2).replace('.', ',');
  return `${s}${space ? ' ' : ''}€`;
}
export const sugerencia = (s) => `- ${s.texto}${s.precio !== '' && s.precio != null ? ` ${precio(s.precio)}` : ''}`;

// El logo, como SVG (se puede pintar del color que haga falta) o, si el bar subió una imagen, tal cual
export async function logoOf(bar) {
  const src = bar.marca?.logo;
  if (!src) return null;
  if (src.startsWith('data:image/svg+xml')) {
    const svg = src.includes(';base64,') ? atob(src.split(',')[1]) : decodeURIComponent(src.split(',')[1]);
    return { svg };
  }
  if (src.startsWith('data:')) return { src };
  if (src.endsWith('.svg')) return { svg: await fetch(src).then((r) => r.text()) };
  return { src };
}

// El logo en una imagen del color pedido (solo los SVG de un color cambian de color)
export async function logoImage(logo, color) {
  if (!logo) return null;
  const img = new Image();
  img.src = logo.svg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logo.svg.replace(/currentColor/g, color))}`
    : logo.src;
  try { await img.decode(); } catch { return null; }
  return img;
}

// ---------- La carta ----------
// Una libreta de comandas: secciones, y en cada plato nombre y precio en la misma línea.
// Lo agotado se tacha (no desaparece) y los alérgenos se ven siempre; si el bar no los ha
// confirmado, «pregunta al personal», nunca una suposición.
const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

// lo que dice la carta de los alérgenos: lo marcado o, si no lo está, que se pregunte
const alergenosTexto = (list) => (Array.isArray(list)
  ? (list.length ? `Contiene: ${list.map((a) => ALERGENOS[a] || a).join(', ')}` : 'Sin alérgenos declarados')
  : 'Alérgenos: pregunta al personal');

// fotos: en la página del bar, las de los platos (con Pro); en la carta de papel no van
export function renderCarta(root, bar, { fotos = false } = {}) {
  const conFotos = fotos && isPro(bar);
  root.replaceChildren();
  // arriba, lo de hoy: lo mismo que sale en las servilletas
  const hoy = (bar.sugerencias || []).filter((s) => s.texto?.trim());
  if (hoy.length) {
    const s = h('section', 'carta-sec carta-hoy');
    s.append(h('h3', 'carta-sec-title', 'Hoy'));
    const list = h('ul', 'carta-list');
    for (const x of hoy) {
      const li = h('li', 'carta-item');
      li.dataset.al = Array.isArray(x.alergenos) ? x.alergenos.join(' ') : '?';
      const row = h('div', 'carta-row');
      row.append(h('span', 'carta-name', x.texto), h('span', 'carta-dots'), h('span', 'carta-price', precio(x.precio, true)));
      const tag = h('p', 'carta-al');
      tag.append(h('span', `carta-tag tag-${tipoDe(x)}`, TIPOS[tipoDe(x)]), alergenosTexto(x.alergenos));
      li.append(row, tag);
      list.append(li);
    }
    s.append(list);
    root.append(s);
  }
  for (const sec of bar.carta || []) {
    if (!sec.platos?.length) continue;
    const s = h('section', 'carta-sec');
    s.append(h('h3', 'carta-sec-title', sec.seccion));
    const list = h('ul', 'carta-list');
    for (const p of sec.platos) {
      const li = h('li', `carta-item${p.agotado ? ' agotado' : ''}`);
      li.dataset.al = Array.isArray(p.alergenos) ? p.alergenos.join(' ') : '?';
      const row = h('div', 'carta-row');
      row.append(h('span', 'carta-name', p.nombre), h('span', 'carta-dots'), h('span', 'carta-price', precio(p.precio, true)));
      li.append(row);
      // la foto, como una polaroid grapada a la comanda; al tocarla se ve en grande (carta.js)
      if (conFotos && p.foto) {
        li.classList.add('con-foto');
        const b = h('button', 'carta-foto');
        b.type = 'button';
        b.setAttribute('aria-label', `Ver la foto: ${p.nombre}`);
        const img = h('img');
        Object.assign(img, { src: fotoUrl(bar, p.foto), alt: '', loading: 'lazy', decoding: 'async', width: 128, height: 128 });
        b.append(img);
        li.prepend(b);
      }
      const al = h('p', 'carta-al');
      if (p.agotado) al.append(h('span', 'carta-out', 'Agotado'));
      else if (p.destacado) al.append(h('span', 'carta-tag tag-estrella', TIPOS.estrella));
      al.append(alergenosTexto(p.alergenos));
      li.append(al);
      list.append(li);
    }
    s.append(list);
    root.append(s);
  }
  // el aviso que pide el RD 126/2015: dónde está la información y que se puede preguntar
  root.append(h('p', 'carta-aviso', 'Si tienes alguna alergia o intolerancia alimentaria, díselo al personal antes de pedir.'));
  if (bar.direccion || bar.horario) {
    const foot = h('footer', 'carta-foot');
    if (bar.direccion) foot.append(h('p', null, bar.direccion));
    if (bar.horario) foot.append(h('p', null, bar.horario));
    root.append(foot);
  }
}
