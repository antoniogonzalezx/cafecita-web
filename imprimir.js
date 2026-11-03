// ---------- Para imprimir: pegatinas, cartel y carta en papel ----------
// Lo que el bar necesita para empezar, hecho en el navegador y sin servicios externos: el QR de
// las mesas (con el aviso de alérgenos), un cartel para la barra y la carta en papel, que según la
// OCU tiene que seguir existiendo aunque haya QR. Se imprime o se guarda en PDF desde el navegador.
// Cada QR lleva ?o= para saber de dónde viene la visita (mesa, barra o carta).
import { loadBar, isPro, logoOf, logoImage, renderCarta, DEFAULT_COLOR, LETRAS } from './bar.js?v=7';
import { qrSvg } from './qr.js?v=1';

const $ = (id) => document.getElementById(id);
const ID = document.body.dataset.bar;
const bar = await loadBar(ID);
const pro = isPro(bar);
const color = pro ? bar.marca.color : DEFAULT_COLOR;
const letra = LETRAS[pro && LETRAS[bar.marca.letra] ? bar.marca.letra : 'clasica'];
const css = document.documentElement.style;
css.setProperty('--brand', color);
css.setProperty('--brand-ink', `color-mix(in srgb, ${color} 78%, black)`);
css.setProperty('--bar-font', `'${letra.family}'`);
css.setProperty('--bar-style', letra.style || 'normal');
css.setProperty('--bar-case', letra.caps ? 'uppercase' : 'none');
document.title = `Para imprimir · ${bar.nombre}`;
$('pBack').href = `/${ID}/gestion/`;

const url = (o) => `${location.origin}/${ID}/?o=${o}`;
const short = `${location.host}/${ID}`;
const ALERGIAS = 'Alérgenos: en la carta o pregunta al personal';

// el logo del bar con Pro; sin Pro, CAFECITA y su nombre
const logo = pro ? await logoOf(bar).catch(() => null) : null;
const cafecita = { svg: await fetch('logo.svg').then((r) => r.text()) };
const marca = async (tinta, cls) => {
  const box = document.createElement('div');
  box.className = `p-marca ${cls}`;
  const img = await logoImage(logo || cafecita, tinta);
  if (img) { img.alt = bar.nombre; box.append(img); }
  if (!logo) {
    const n = document.createElement('p');
    n.className = 'p-nombre';
    n.textContent = bar.nombre;
    box.append(n);
  }
  return box;
};
const html = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const qr = (o, tinta) => {
  const box = html('div', 'p-qr');
  box.innerHTML = qrSvg(url(o), tinta); // SVG generado aquí mismo (qr.js), sin datos de fuera
  box.firstChild.setAttribute('aria-label', `QR a ${short}`);
  return box;
};

// ---------- Las hojas ----------
// La hoja es el contenedor (su ancho son los cqw) y lo de dentro se maqueta en un hijo:
// las unidades cqw de un elemento se miden contra su contenedor, no contra él mismo.
function sheet(cls, label) {
  const hoja = html('section', `hoja hoja-${cls}`);
  hoja.setAttribute('aria-label', label);
  const inner = html('div', `hoja-in in-${cls}`);
  hoja.append(inner);
  return [hoja, inner];
}

async function mesas() {
  const [hojaEl, hoja] = sheet('mesas', 'Pegatinas para las mesas');
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
  for (let i = 0; i < 6; i++) {
    const p = html('article', 'pegatina');
    p.append(await marca(ink, 'p-marca-peq'), qr('qr-mesa', '#16171C'),
      html('p', 'p-titulo', 'La carta y lo de hoy'),
      html('p', 'p-sub', 'Escanea con la cámara del móvil'),
      html('p', 'p-legal', ALERGIAS));
    hoja.append(p);
  }
  return [hojaEl];
}

async function barra() {
  const [hojaEl, hoja] = sheet('barra', 'Cartel para la barra');
  const serv = html('div', 'p-servilleta');
  serv.append(html('p', 'p-kicker', 'Saca una servilleta'), qr('qr-barra', '#16171C'), html('p', 'p-url', short));
  hoja.append(await marca('#F7F3EA', 'p-marca-grande'),
    html('h1', 'p-cartel', 'Lo de hoy, en una servilleta'),
    html('p', 'p-cartel-sub', 'La sugerencia del día, lo de fuera de carta y la carta entera, en tu móvil.'),
    serv,
    html('p', 'p-legal p-legal-claro', `${ALERGIAS}.`));
  return [hojaEl];
}

async function carta() {
  const [hojaEl, hoja] = sheet('carta', 'Carta en papel');
  const head = html('header', 'pc-head');
  head.append(await marca(getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(), 'p-marca-carta'), html('h1', 'pc-titulo', 'Carta'));
  const body = html('div', 'pc-body');
  renderCarta(body, bar);
  const foot = html('footer', 'pc-legal');
  const txt = html('div');
  txt.append(html('p', null, 'Si tienes alguna alergia o intolerancia alimentaria, díselo al personal antes de pedir.'),
    html('p', null, 'Informamos de los 14 alérgenos del Reglamento (UE) 1169/2011.'),
    html('p', 'pc-digital', `Carta digital y lo de hoy: ${short}`));
  foot.append(txt, qr('qr-carta', '#16171C'));
  hoja.append(head, body, foot);
  return [hojaEl];
}

const HOJAS = { mesas, barra, carta };
const AYUDA = {
  mesas: 'Seis pegatinas de 8,5 cm por hoja A4. Imprímelas en papel adhesivo y recórtalas por la línea.',
  barra: 'Un cartel A4 a todo color para la barra o el escaparate.',
  carta: 'La carta en papel, con los alérgenos de cada plato. La ley pide que siga habiendo carta en papel aunque tengas QR.',
};

let que = new URLSearchParams(location.search).get('que');
if (!HOJAS[que]) que = 'mesas';
async function show(q) {
  que = q;
  for (const t of document.querySelectorAll('.p-tab')) t.setAttribute('aria-pressed', String(t.dataset.que === q));
  $('pHint').textContent = AYUDA[q];
  document.body.dataset.que = q;
  $('pSheets').replaceChildren(...(await HOJAS[q]()));
  history.replaceState(null, '', `${location.pathname}?que=${q}`);
}
for (const t of document.querySelectorAll('.p-tab')) t.addEventListener('click', () => show(t.dataset.que));
$('pPrint').addEventListener('click', () => window.print());
await document.fonts.ready;
await show(que);
