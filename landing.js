// ---------- Cafecita para bares (bares/) ----------
// La página para vender Cafecita a los bares. Las servilletas no son fotos: se pintan con el mismo
// código que el servilletero (napkin.js), así que salen igual que las verá el cliente del bar.
// El QR del cartel lleva a la demo de Bar Manolo.
import { paintNapkin, BAR_INK } from './napkin.js?v=21';
import { logoImage, LETRAS, letraCss } from './bar.js?v=8';
import { qrSvg } from './qr.js?v=2';
import { medir } from './medir.js?v=14';
import { mosaico, ASPA, AZUL } from './marca.js?v=1';

const $ = (id) => document.getElementById(id);

// ---------- Pro: mensual o anual ----------
const PAGOS = {
  mes: { precio: '9,99 €', periodo: '/mes', nota: 'Sin permanencia. O 99 € al año.' },
  ano: { precio: '99 €', periodo: '/año', nota: 'Sale a 8,25 € al mes: dos meses gratis.' },
};
for (const b of document.querySelectorAll('[data-pago]')) {
  b.addEventListener('click', () => {
    const p = PAGOS[b.dataset.pago];
    for (const o of document.querySelectorAll('[data-pago]')) o.setAttribute('aria-pressed', String(o === b));
    $('lPrecio').textContent = p.precio;
    $('lPeriodo').textContent = p.periodo;
    $('lNota').textContent = p.nota;
  });
}

// ---------- Lo que caduca ----------
// el piloto (Pro gratis hasta el 31 de enero) desaparece solo al día siguiente
for (const e of document.querySelectorAll('[data-hasta]')) {
  if (Date.now() > Date.parse(`${e.dataset.hasta}T23:59:59+01:00`)) e.hidden = true;
}

// ---------- La franja de azulejos del pie ----------
$('lFranja').innerHTML = mosaico({ cols: 60, filas: 3, l: 64, semilla: 21 });

// ---------- El QR de la demo ----------
$('lQr').innerHTML = qrSvg('https://cafecita.app/barmanolo/?o=qr-landing', AZUL, { centro: ASPA });

// ---------- Analítica: quién llega y quién abre la demo ----------
medir('visita', { origen: `landing:${document.referrer ? new URL(document.referrer).hostname : 'directo'}`.slice(0, 40) });
for (const a of document.querySelectorAll('[data-medir]')) a.addEventListener('click', () => medir('enlace', { a: `landing:${a.dataset.medir}` }));

// ---------- Las servilletas ----------
const svg = (src) => fetch(src).then((r) => r.text()).then((t) => ({ svg: t }));
const [manolo, cafecita] = await Promise.all([
  svg('bares/barmanolo/logo.svg').then((l) => logoImage(l, BAR_INK)),
  svg('logo.svg').then((l) => logoImage(l, BAR_INK)),
  document.fonts.load(letraCss(LETRAS.clasica, 60)),
]).catch(() => []);

// id: elige la plantilla (la misma servilleta fotografiada cada vez)
const SERVILLETAS = {
  hero: { id: 'landing-hero', title: 'Sugerencia del día', lines: ['- Bocata de calamares 6€'], logo: manolo },
  sugerencia: { id: 'landing-sugerencia', title: 'Sugerencia del día', lines: ['- Migas con uvas 7€'], logo: manolo },
  fuera: { id: 'landing-fuera', title: 'Fuera de carta', lines: ['- Rabo de toro estofado 14€'], logo: manolo },
  estrella: { id: 'landing-estrella', title: 'Lo más pedido', lines: ['- Patatas bravas 5€', '- Pisto manchego 6,50€'], logo: manolo },
  basic: { id: 'landing-basic', title: 'Sugerencia del día', lines: ['- Tu plato del día 6€'], logo: cafecita },
  pro: { id: 'landing-pro', title: 'Sugerencia del día', lines: ['- Tu plato del día 6€'], logo: manolo },
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
