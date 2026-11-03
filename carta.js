// ---------- La página de un bar: lo que no espera al 3D ----------
// Se carga antes que main.js y sin Three.js. Nada más abrir pone el color, la letra y el logo
// del bar (sin un instante del azul de Cafecita) y la carta ya funciona, también con la Wi-Fi
// lenta de un bar: el cliente viene a ver qué hay. El servilletero llega después (main.js),
// que abre la carta desde la servilleta con el evento «carta:abrir».
import { loadBar, isPro, logoOf, logoImage, renderCarta, DEFAULT_COLOR, LETRAS } from './bar.js?v=5';
import { medir } from './medir.js?v=14';

const $ = (id) => document.getElementById(id);
const ID = document.body.dataset.bar;
const bar = await loadBar(ID);
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
document.body.classList.add('bar-ready');

// ---------- La carta ----------
// Una hoja que sube desde abajo. Escape solo la cierra a ella: la servilleta sigue debajo.
const carta = $('carta');
let drawn = false, hideTimer = null;
function open() {
  if (carta.classList.contains('open')) return;
  if (!drawn) { renderCarta($('cartaBody'), bar); drawn = true; }
  clearTimeout(hideTimer);
  carta.hidden = false;
  $('cartaBody').scrollTop = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => carta.classList.add('open')));
  $('cartaClose').focus({ preventScroll: true, focusVisible: false });
  medir('carta', { bar: ID });
}
function close() {
  if (!carta.classList.contains('open')) return;
  carta.classList.remove('open');
  hideTimer = setTimeout(() => { carta.hidden = true; }, 380);
  if (location.hash === '#carta') history.replaceState(null, '', location.pathname + location.search);
}
$('cartaBtn').addEventListener('click', open);
$('cartaClose').addEventListener('click', close);
carta.querySelector('.carta-veil').addEventListener('click', close);
document.addEventListener('carta:abrir', open);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && carta.classList.contains('open')) { e.stopImmediatePropagation(); close(); }
}, { capture: true });
// un QR que lleve a cafecita.app/<bar>/#carta abre directamente la carta
if (location.hash === '#carta') open();
