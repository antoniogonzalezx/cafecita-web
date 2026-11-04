// ---------- Cafecita para bares (carta/) ----------
// La página para vender Cafecita a los bares: azul y blanco, poco texto y los azulejos como detalle.
// La servilleta no es una foto: se pinta con el mismo código que el servilletero (napkin.js).
// El QR de su esquina lleva a la demo.
import { paintNapkin, BAR_INK } from './napkin.js?v=21';
import { logoImage, LETRAS, letraCss } from './bar.js?v=8';
import { qrSvg } from './qr.js?v=2';
import { medir } from './medir.js?v=14';
import { mosaico, ASPA, AZUL } from './marca.js?v=1';

const $ = (id) => document.getElementById(id);

// ---------- Lo que caduca ----------
// el piloto (Pro gratis hasta el 31 de enero) desaparece solo al día siguiente
for (const e of document.querySelectorAll('[data-hasta]')) {
  if (Date.now() > Date.parse(`${e.dataset.hasta}T23:59:59+01:00`)) e.hidden = true;
}

// ---------- La franja de azulejos del pie ----------
$('lFranja').innerHTML = mosaico({ cols: 48, filas: 3, l: 40, semilla: 21 });

// ---------- El QR de la demo ----------
$('lQr').innerHTML = qrSvg('https://cafecita.app/barmanolo/?o=qr-landing', AZUL, { centro: ASPA });

// ---------- Analítica: quién llega y quién abre la demo ----------
medir('visita', { origen: `landing:${document.referrer ? new URL(document.referrer).hostname : 'directo'}`.slice(0, 40) });
for (const a of document.querySelectorAll('[data-medir]')) a.addEventListener('click', () => medir('enlace', { a: `landing:${a.dataset.medir}` }));

// ---------- Las servilletas ----------
const svg = (src) => fetch(src).then((r) => r.text()).then((t) => ({ svg: t }));
// en la solapa, el logo de cafecita
const logo = await svg('logo.svg?v=2').then((l) => logoImage(l, BAR_INK)).catch(() => null);
await document.fonts.load(letraCss(LETRAS.clasica, 60)).catch(() => {});

// id: elige la plantilla (la misma servilleta fotografiada cada vez)
const SERVILLETAS = {
  hero: { id: 'landing-hero', title: 'Plato del día', lines: ['- Carrillada de carne', '13,50€'], logo },
};

// se pintan cuando se van a ver, la primera la del principio
const pintar = async (c) => {
  const s = SERVILLETAS[c.dataset.servilleta];
  if (!s || c.dataset.pintada) return;
  c.dataset.pintada = '1';
  await paintNapkin(c, { kind: 'bar', id: s.id, title: s.title, lines: s.lines }, { logo: s.logo, ink: BAR_INK });
  c.classList.add('lista');
};
const lazy = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { lazy.unobserve(e.target); pintar(e.target); }
}, { rootMargin: '300px 0px' });
for (const c of document.querySelectorAll('canvas[data-servilleta]')) lazy.observe(c);
