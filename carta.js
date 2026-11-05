// ---------- La página de un bar: lo que no espera al 3D ----------
// Se carga antes que main.js y sin Three.js. Nada más abrir pone el color, la letra y el logo
// del bar (sin un instante del azul de Cafecita) y la carta ya funciona, también con la Wi-Fi
// lenta de un bar: el cliente viene a ver qué hay. El servilletero llega después (main.js),
// que abre la carta desde la servilleta con el evento «carta:abrir».
import { loadBar, isPro, logoOf, logoImage, renderCarta, precio, DEFAULT_COLOR, LETRAS, ALERGENOS } from './bar.js?v=9';
import { medir } from './medir.js?v=14';

const $ = (id) => document.getElementById(id);
const ID = document.body.dataset.bar;
// sin conexión, o si el bar no existe (una dirección mal escrita), no hay ficha: se dice
const bar = await loadBar(ID).catch(() => null);
if (!bar) {
  document.body.classList.add('bar-ready');
  const msg = document.createElement('p');
  msg.className = 'bar-name';
  msg.textContent = 'No encontramos este bar. Revisa la dirección o recarga la página.';
  document.querySelector('.logo').replaceChildren(msg);
  throw new Error(`No se ha podido cargar el bar ${ID}`);
}
const pro = isPro(bar);

// ---------- Su marca ----------
const color = pro ? bar.marca.color : DEFAULT_COLOR;
const letra = LETRAS[pro && LETRAS[bar.marca.letra] ? bar.marca.letra : 'clasica'];
const css = document.documentElement.style;
css.setProperty('--azul', color);
css.setProperty('--azul-hover', `color-mix(in srgb, ${color} 86%, black)`);
css.setProperty('--bar-font', `'${letra.family}'`);
css.setProperty('--bar-style', letra.style || 'normal');
css.setProperty('--bar-case', letra.caps ? 'uppercase' : 'none');
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
document.title = `${bar.nombre} · Carta y sugerencias`;
document.body.classList.add('bar');
// para la carga (carga.js): un bar con Pro tiene su marca, así que mientras carga solo sale el logo de cafecita
if (pro) document.body.classList.add('bar-pro');

// arriba, su logo (con Pro); si no, CAFECITA y debajo su nombre
const head = document.querySelector('.logo');
head.setAttribute('aria-label', bar.nombre);
const logo = pro ? await logoImage(await logoOf(bar).catch(() => null), '#F7F3EA') : null;
if (logo) {
  logo.alt = '';
  head.classList.add('bar-logo');
  head.replaceChildren(logo);
} else {
  const name = document.createElement('p');
  name.className = 'bar-name';
  name.textContent = bar.nombre;
  head.after(name);
}
// debajo, lo de hoy en una línea: aunque no saque ninguna servilleta, el cliente ve qué hay (CAF-51).
// Al tocarla se abre la carta.
const hoy = (bar.sugerencias || []).find((s) => s.texto?.trim());
if (hoy) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bar-hoy';
  b.textContent = `Hoy: ${hoy.texto.trim()}${precio(hoy.precio) ? ` · ${precio(hoy.precio, true)}` : ''}`;
  b.addEventListener('click', () => document.dispatchEvent(new Event('carta:abrir')));
  document.querySelector('.top').append(b);
}
document.body.classList.add('bar-ready');

// ---------- La carta ----------
// Una hoja que sube desde abajo. Escape solo la cierra a ella: la servilleta sigue debajo.
const carta = $('carta');
let drawn = false, hideTimer = null;
// Para quien tiene una alergia: marca lo que no puede tomar y la carta apaga lo que lo lleva.
// Lo que el bar no ha confirmado se queda a la vista, pero avisando de que hay que preguntar.
const sin = new Set();
function filtro() {
  const bar_ = document.createElement('div');
  bar_.className = 'carta-filtro';
  bar_.setAttribute('role', 'group');
  bar_.setAttribute('aria-label', 'Filtrar por alergia');
  for (const [k, nombre] of Object.entries(ALERGENOS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'carta-chip';
    b.textContent = `Sin ${nombre.toLowerCase()}`;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      if (sin.has(k)) sin.delete(k); else sin.add(k);
      b.setAttribute('aria-pressed', String(sin.has(k)));
      aplicar();
    });
    bar_.append(b);
  }
  return bar_;
}
function aplicar() {
  for (const li of $('cartaBody').querySelectorAll('.carta-item')) {
    const al = li.dataset.al, lleva = al !== '?' && al.split(' ').some((a) => sin.has(a));
    li.classList.toggle('filtrado', sin.size > 0 && lleva);
    li.classList.toggle('dudoso', sin.size > 0 && al === '?');
  }
  $('cartaBody').classList.toggle('filtrando', sin.size > 0);
}

// Al final de la carta, una sola pregunta para el piloto (CAF-52): sin registro ni datos
// personales, es un evento más de la analítica. Se pregunta una vez al día en cada bar.
function teHaServido() {
  const KEY = `cafecita.util.${ID}`;
  const hoy = new Date().toISOString().slice(0, 10);
  const box = document.createElement('div');
  box.className = 'carta-util';
  try { if (localStorage.getItem(KEY) === hoy) return box; } catch {}
  const q = Object.assign(document.createElement('p'), { textContent: '¿Te ha servido la carta?' });
  const botones = document.createElement('div');
  for (const [txt, val] of [['Sí', 'si'], ['No', 'no']]) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'carta-chip', textContent: txt });
    b.addEventListener('click', () => {
      medir('enlace', { a: `carta:util:${val}`, bar: ID });
      try { localStorage.setItem(KEY, hoy); } catch {}
      q.textContent = val === 'si' ? 'Gracias. Se lo diremos al bar.' : 'Gracias. Lo mejoraremos con el bar.';
      botones.remove();
    });
    botones.append(b);
  }
  box.append(q, botones);
  return box;
}

function open() {
  if (carta.classList.contains('open')) return;
  if (!drawn) {
    renderCarta($('cartaBody'), bar, { fotos: true });
    $('cartaBody').before(filtro());
    $('cartaBody').append(teHaServido());
    drawn = true;
  }
  clearTimeout(hideTimer);
  carta.hidden = false;
  $('cartaBody').scrollTop = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => carta.classList.add('open')));
  $('cartaClose').focus({ preventScroll: true, focusVisible: false });
  medir('carta', { bar: ID });
}
function close() {
  if (!carta.classList.contains('open')) return;
  cerrarFoto();
  carta.classList.remove('open');
  hideTimer = setTimeout(() => { carta.hidden = true; }, 380);
  if (location.hash === '#carta') history.replaceState(null, '', location.pathname + location.search);
}
// ---------- La foto de un plato, en grande ----------
// La polaroid crece sobre la carta, con el plato, el precio y los alérgenos escritos debajo.
// Se cierra tocando en cualquier sitio o con Escape (que no cierra la carta).
let foto = null;
function verFoto(btn) {
  const li = btn.closest('.carta-item');
  const pie = (cls, sel) => Object.assign(document.createElement('p'), { className: cls, textContent: li.querySelector(sel)?.textContent || '' });
  const big = document.createElement('img');
  big.src = btn.querySelector('img').src;
  big.alt = li.querySelector('.carta-name').textContent;
  const card = document.createElement('figure');
  card.className = 'foto-card';
  const cap = document.createElement('figcaption');
  cap.append(pie('foto-name', '.carta-name'), pie('foto-price', '.carta-price'));
  const al = li.querySelector('.carta-al').cloneNode(true);
  al.classList.add('foto-al');
  card.append(big, cap, al);
  foto = document.createElement('div');
  foto.className = 'foto-grande';
  foto.setAttribute('role', 'dialog');
  foto.setAttribute('aria-modal', 'true');
  foto.setAttribute('aria-label', big.alt);
  foto.tabIndex = -1;
  foto.append(card);
  foto.addEventListener('click', cerrarFoto);
  carta.append(foto);
  requestAnimationFrame(() => requestAnimationFrame(() => foto?.classList.add('open')));
  foto.focus({ preventScroll: true });
  foto.dataset.desde = String([...$('cartaBody').querySelectorAll('.carta-foto')].indexOf(btn));
  medir('enlace', { a: `foto:${ID}` });
}
function cerrarFoto() {
  if (!foto) return;
  const f = foto, i = +f.dataset.desde;
  foto = null;
  f.classList.remove('open');
  setTimeout(() => f.remove(), 260);
  $('cartaBody').querySelectorAll('.carta-foto')[i]?.focus({ preventScroll: true });
}
$('cartaBody').addEventListener('click', (e) => {
  const b = e.target.closest('.carta-foto');
  if (b) verFoto(b);
});

$('cartaBtn').addEventListener('click', open);
$('cartaClose').addEventListener('click', close);
carta.querySelector('.carta-veil').addEventListener('click', close);
document.addEventListener('carta:abrir', open);
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !carta.classList.contains('open')) return;
  e.stopImmediatePropagation();
  if (foto) cerrarFoto(); else close();
}, { capture: true });
// un QR que lleve a cafecita.app/<bar>/#carta abre directamente la carta
if (location.hash === '#carta') open();
