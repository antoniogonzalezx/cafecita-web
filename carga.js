// ---------- Carga: la pared se llena y el logo se monta ----------
// Mientras llega el servilletero (body.loading), sobre el azul de cafecita, una franja de tres filas
// de azulejos se llena de uno en uno desde el centro, tenue y con el fondo de la servilleta. En el
// centro de la fila del medio queda un hueco para el logo, que aparece y desaparece (style.css).
// En la página de un bar con Pro (su propia marca) no hay azulejos: solo el logo de cafecita.
// En la de un bar se espera a saber cuál es (carta.js pone body.bar-ready). Al quitar body.loading, todo se para.
import { AZULEJOS, AZUL, PAPEL } from './marca.js?v=1';

const caja = document.querySelector('.carga');
const franja = caja?.querySelector('.carga-franja');
const logo = caja?.querySelector('.carga-logo');
const NS = 'http://www.w3.org/2000/svg';
const TIPOS = Object.keys(AZULEJOS);
const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
let reloj = null;

function monta() {
  clearInterval(reloj);
  const W = innerWidth, L = Math.max(34, Math.min(58, W / 9));
  let cols = Math.ceil(W / L);
  if (cols % 2 === 0) cols++;
  let hc = 0;
  if (logo) {
    hc = Math.ceil((logo.getBoundingClientRect().width + L * .9) / L);
    if (hc % 2 === 0) hc++;
  }
  const c0 = (cols - hc) / 2, mid = (cols - 1) / 2;
  let seed = 17;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${cols * L} ${3 * L}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.style.height = `${3 * L}px`;
  const az = [];
  let prev = null;
  for (let y = 0; y < 3; y++) for (let x = 0; x < cols; x++) {
    if (y === 1 && x >= c0 && x < c0 + hc) continue;
    let t;
    do t = TIPOS[Math.floor(r() * TIPOS.length)]; while (t === prev);
    prev = t;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'az');
    g.innerHTML = `<rect x="${x * L}" y="${y * L}" width="${L}" height="${L}" fill="${PAPEL}"/>` +
      `<svg x="${x * L}" y="${y * L}" width="${L}" height="${L}" viewBox="-32 -32 64 64" overflow="hidden"><g fill="${AZUL}" color="${AZUL}">${AZULEJOS[t]}</g></svg>`;
    svg.append(g);
    az.push({ g, d: Math.abs(x - mid) + Math.abs(y - 1) + r() * 1.5 });
  }
  franja.querySelector(':scope > svg')?.remove();
  franja.prepend(svg);
  az.sort((a, b) => a.d - b.d);
  if (quieto) { az.forEach((a) => a.g.classList.add('on')); return; }
  let n = 0, pausa = 0;
  reloj = setInterval(() => {
    if (pausa > 0) {
      if (--pausa === 0) { franja.classList.remove('vacia'); az.forEach((a) => a.g.classList.remove('on')); n = 0; }
      return;
    }
    if (n < az.length) { az[n++].g.classList.add('on'); return; }
    franja.classList.add('vacia');
    pausa = 9;
  }, 140);
}

const B = document.body.classList;
const listo = () => !document.body.dataset.bar || B.contains('bar-ready');
let montada = false;
function empieza() {
  if (montada || !listo()) return;
  montada = true;
  if (B.contains('bar-pro')) caja.classList.add('solo');
  else monta();
}
if (caja && B.contains('loading')) {
  empieza();
  // cuando llega el servilletero, se para (y deja de gastar)
  new MutationObserver(() => {
    empieza();
    if (!B.contains('loading')) { clearInterval(reloj); setTimeout(() => caja.remove(), 600); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
