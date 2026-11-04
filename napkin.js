import { LETRAS, letraCss } from './bar.js?v=9';

// ---------- Servilletas pintadas al vuelo ----------
// Las noticias, los anuncios y el aviso de reponer se rotulan en el navegador sobre una de las
// servilletas fotografiadas de las plantillas (templates/, las genera tools/build_templates.py):
// arriba el titular, el periódico y la fecha; en la solapa, «Gracias por su visita» y el logo.
const SCALE = 1.5;                 // más resolución que la foto para que la letra salga nítida
const QUOTE = '#537393';           // los mismos azules que las servilletas de las citas
const AUTHOR = '#415F7A';
const SERIF = (s) => `italic 400 ${s}px Fraunces, Georgia, serif`;
const SANS = (s, w = 700) => `${w} ${s}px 'Rethink Sans', system-ui, sans-serif`;

const loadImg = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});
// se empiezan a bajar en cuanto carga la página (son ~300 KB entre las seis)
const TEMPLATES = fetch('templates.json').then((r) => r.json())
  .then((list) => list.map((t) => ({ ...t, img: loadImg(t.src) })));

const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

// ---------- Texto ----------
function wrap(g, text, maxW) {
  const lines = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (line && g.measureText(t).width > maxW) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

// líneas parejas: el ancho más estrecho que no añade líneas
function balanced(g, text, maxW) {
  const n = wrap(g, text, maxW).length;
  let lo = maxW * 0.4, hi = maxW;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(g, text, mid).length > n) lo = mid; else hi = mid;
  }
  return wrap(g, text, hi);
}

// el cuerpo más grande con el que el texto cabe en la caja
function fit(g, text, font, w, h, max, min, lh) {
  for (let size = max; size >= min; size -= 2) {
    g.font = font(size);
    const lines = balanced(g, text, w);
    if (lines.length * size * lh <= h && lines.every((l) => g.measureText(l).width <= w)) return { size, lines };
  }
  g.font = font(min);
  return { size: min, lines: balanced(g, text, w).slice(0, Math.max(1, Math.floor(h / (min * lh)))) };
}

function spaced(g, text, x, y, em) {
  if ('letterSpacing' in g) g.letterSpacing = `${em}em`;
  g.fillText(text, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const when = (iso) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${capital(day)} · ${time}`;
};

// titular, firma y pie de cada tipo de servilleta
function lines(item) {
  if (item.kind === 'ad') return [item.ad.texto, item.ad.marca, 'Publicidad'];
  if (item.kind === 'empty') return ['Espere a que el personal reponga las servilletas.', 'La dirección', 'Gracias por su paciencia'];
  return [item.news.titular, item.news.fuente, when(item.news.fecha)];
}

// ---------- Servilletas ----------
// item: { kind: 'news', news: {titular, fuente, fecha} } | { kind: 'ad', ad: {texto, marca} } | { kind: 'empty' }
//     | { kind: 'bar', title: 'Sugerencia del día', lines: ['- Bocata de calamares 6€', …] } (lo de hoy en un bar)
// La plantilla sale del id: la misma noticia cae siempre en la misma servilleta.
// ink: en las de bar, la única tinta de la servilleta (lo escrito, la frase y el logo, que ya viene pintado de ella)
// letra: la que el bar ha elegido para lo que escribe (LETRAS; por defecto, la de la frase)
export async function paintNapkin(canvas, item, { logo, ink = BAR_INK, letra = 'clasica' } = {}) {
  const list = await TEMPLATES;
  const t = list[hash(item.id || 'x') % list.length];
  const img = await t.img;
  const W = Math.round(t.size[0] * SCALE), H = Math.round(t.size[1] * SCALE);
  canvas.width = W;
  canvas.height = H;
  canvas.dataset.box = t.box.join(',');
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.drawImage(img, 0, 0, W, H);

  // la tinta empapa el papel: encima de una mancha de café se ve más oscura
  g.globalCompositeOperation = 'multiply';
  if ('filter' in g) g.filter = 'blur(0.45px)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fy = H * t.fold;
  if (item.kind === 'bar') {
    penLines(g, item.lines, W, fy, ink, hash(item.id || 'x'), item.title, LETRAS[letra] || LETRAS.clasica);
    barFlap(g, W, fy, H, logo, ink);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    if ('filter' in g) g.filter = 'none';
    return canvas;
  }
  const [title, signer, foot] = lines(item);

  // arriba: titular, el periódico en mayúsculas y la fecha
  const srcSize = Math.round(W * 0.04), footSize = Math.round(W * 0.036), lh = 1.14;
  const below = srcSize * 2.7 + footSize * 1.5;
  const top = H * 0.07, bottom = fy - H * 0.05;
  const { size, lines: rows } = fit(g, title, SERIF, W * 0.8, bottom - top - below, Math.round(W * 0.092), Math.round(W * 0.042), lh);
  const blockH = rows.length * size * lh + below;
  let y = top + (bottom - top - blockH) / 2 + size * lh / 2;
  g.fillStyle = QUOTE;
  g.font = SERIF(size);
  for (const row of rows) { g.fillText(row, W / 2, y); y += size * lh; }
  y += srcSize * 1.7 - size * lh / 2;
  g.fillStyle = AUTHOR;
  g.font = SANS(srcSize);
  spaced(g, signer.toUpperCase(), W / 2, y, 0.05);
  y += srcSize * 0.7 + footSize * 1.1;
  g.fillStyle = QUOTE;
  g.globalAlpha = 0.85;
  g.font = SERIF(footSize);
  g.fillText(foot, W / 2, y);

  // en la solapa: el clásico «Gracias por su visita» y el logo, como en el servilletero
  const cy = fy + (H - fy) * 0.42;
  g.globalAlpha = 0.9;
  g.font = SERIF(Math.round(W * 0.078));
  g.fillText(THANKS, W / 2, cy);
  // dónde cae cada letra, para poder doblarla como en los bares (el easter egg de main.js)
  const x0 = W / 2 - g.measureText(THANKS).width / 2;
  canvas.dataset.thanks = ['Gracias p', 'Gracias por s', 'Gracias por su', 'Gracias por su visi']
    .map((s) => Math.round(x0 + g.measureText(s).width)).join(',');
  canvas.dataset.fold = t.fold;
  const ly = cy + W * 0.095, lH = W * 0.044;
  if (logo) {
    const lW = lH * logo.naturalWidth / logo.naturalHeight;
    g.drawImage(logo, W / 2 - lW / 2, ly - lH / 2, lW, lH);
  }

  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  if ('filter' in g) g.filter = 'none';
  return canvas;
}

const THANKS = 'Gracias por su visita';
// la tinta de las servilletas de un bar: lo que escribe, la frase y su logo, todo del mismo boli
export const BAR_INK = '#2F4C82';
// La tinta es el color del bar. Si es muy claro (un amarillo, un rosa), se oscurece lo justo
// para que se lea sobre el papel (contraste 4,5:1 con la servilleta, #F7F3EA).
export function tintaDe(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
  if (!m) return BAR_INK;
  let rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const lum = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const PAPEL = lum([247, 243, 234]);
  for (let k = 0; k < 40 && (PAPEL + 0.05) / (lum(rgb) + 0.05) < 4.5; k++) rgb = rgb.map((v) => v * 0.94);
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

// La solapa de un bar: «Gracias por su visita» y, debajo, su logo (o CAFECITA, sin Pro).
// Se mide lo que ocupa de verdad la frase, y entre ella y el logo siempre queda el mismo hueco:
// nunca se tocan, sea cual sea el logo. El conjunto va centrado en la solapa (de top a bottom).
// Lo usa también main.js para la solapa del servilletero 3D.
export function barFlap(g, W, top, bottom, logo, ink) {
  const h = bottom - top, pad = h * 0.12, gap = W * 0.045;
  g.save();
  g.fillStyle = ink;
  g.globalAlpha = 0.9;
  g.font = SERIF(Math.round(W * 0.06));
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const m = g.measureText(THANKS);
  const asc = m.actualBoundingBoxAscent, textH = asc + m.actualBoundingBoxDescent;
  let lW = 0, lH = 0;
  if (logo) {
    const ratio = logo.naturalWidth / logo.naturalHeight;
    // una tira (CAFECITA) va baja y ancha; un logo casi cuadrado, más alto pero sin pasar del hueco que queda
    lH = Math.max(0, Math.min(h - 2 * pad - textH - gap, ratio >= 4 ? W * 0.04 : W * 0.16, W * 0.38 / ratio));
    lW = lH * ratio;
  }
  const groupH = textH + (lH ? gap + lH : 0);
  const y0 = top + (h - groupH) / 2;
  g.fillText(THANKS, W / 2, y0 + asc);
  if (lH) g.drawImage(logo, W / 2 - lW / 2, y0 + textH + gap, lW, lH);
  g.restore();
}

// Lo que escribe el bar: en mayúsculas, a rotulador, grande, y cada línea un pelín torcida.
// Si una sugerencia no cabe en una línea, sigue en la siguiente con sangría (detrás del guion).
// Cada sugerencia en una línea o, si no cabe, en dos lo más parejas posible (nada de una
// palabra suelta en una línea). El precio va siempre pegado a la palabra de antes.
// Devuelve null si a este tamaño no cabe en dos líneas.
function penWrap(g, text, maxW) {
  const words = text.split(' ').filter(Boolean);
  if (words.length > 2 && /\d/.test(words.at(-1))) words.splice(-2, 2, `${words.at(-2)} ${words.at(-1)}`);
  const w = (ws) => g.measureText(ws.join(' ')).width;
  if (w(words) <= maxW) return [words.join(' ')];
  let best = null, bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i), b = words.slice(i), m = Math.max(w(a), w(b));
    if (m <= maxW && m < bestW) { bestW = m; best = [a.join(' '), b.join(' ')]; }
  }
  return best;
}

// Lo que escribe el bar, grande, centrado y cada línea un pelín torcida. Sin guiones: si hay
// varias sugerencias, un poco de aire entre una y otra; si una no cabe, sigue en la línea de abajo.
function penLines(g, rows, W, fy, ink, seed, title, letra) {
  if (!rows.length) return;
  const HAND = (sz) => letraCss(letra, sz);
  const rnd = prng(seed || 1);
  const up = (t) => (letra.caps ? t.toUpperCase() : t);
  // los datos traen «- » delante de cada sugerencia (bar.js); en la servilleta no se escribe
  const text = rows.map((r) => up(r.replace(/^[-–] /, '')));
  const maxW = W * 0.8, lh = 1.25, bottom = fy * 0.9;
  let top = fy * 0.09;
  // arriba, qué es: «SUGERENCIA DEL DÍA», «FUERA DE CARTA» o «LO MÁS PEDIDO», subrayado a mano
  if (title) {
    g.save();
    let ts = Math.round(W * 0.08 * letra.size);
    g.font = HAND(ts);
    const tt = up(title);
    while (g.measureText(tt).width > maxW && ts > W * 0.04) g.font = HAND(--ts);
    g.fillStyle = ink;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const tw = g.measureText(tt).width, tx = (W - tw) / 2, y = top + ts;
    g.globalAlpha = 0.95;
    g.fillText(tt, tx, y);
    // el subrayado: un trazo algo torcido, más largo que la palabra, como quien lo hace deprisa
    g.strokeStyle = ink;
    g.lineCap = 'round';
    g.lineWidth = Math.max(2, W * 0.007);
    g.beginPath();
    const uy = y + ts * 0.32;
    g.moveTo(tx - W * 0.01, uy + ts * 0.04);
    g.quadraticCurveTo(tx + tw * 0.5, uy - ts * (0.06 + rnd() * 0.06), tx + tw + W * 0.02, uy + ts * 0.02);
    g.stroke();
    g.restore();
    top = uy + ts * 0.55;
  }
  // el tamaño más grande al que cada sugerencia cabe en una o dos líneas y todas caben en la servilleta
  const min = Math.round(W * 0.05), aire = rows.length > 1 ? 0.35 : 0;
  const alto = (ls, sz) => (ls.length * lh + (text.length - 1) * aire) * sz;
  let size = Math.round(W * 0.13 * letra.size), out = null;
  for (; size >= min && !out; size -= 2) {
    g.font = HAND(size);
    const wrapped = text.map((r) => penWrap(g, r, maxW));
    if (wrapped.some((x) => !x) || alto(wrapped.flat(), size) > bottom - top) continue;
    out = wrapped.flatMap((ls, n) => ls.map((l, i) => ({ l, otra: n > 0 && i === 0 })));
  }
  if (out) size += 2;
  else {
    // ni a la letra más pequeña: se corta por palabras, como sea
    size = min;
    g.font = HAND(size);
    out = text.flatMap((r, n) => wrap(g, r, maxW).map((l, i) => ({ l, otra: n > 0 && i === 0 })));
  }
  g.font = HAND(size);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = ink;
  let y = top + size;
  for (const { l, otra } of out) {
    if (otra) y += size * aire;
    g.save();
    g.translate(W / 2 + (rnd() - 0.5) * W * 0.015, y);
    g.rotate((rnd() - 0.6) * 0.03);
    // dos pasadas: el rotulador deja más tinta en unos trazos que en otros
    g.globalAlpha = 0.9;
    g.fillText(l, 0, 0);
    g.globalAlpha = 0.25;
    g.fillText(l, 0.9, 0.6);
    g.restore();
    y += size * lh;
  }
  g.globalAlpha = 1;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
}

// La story para compartir: la servilleta sobre azul en el mismo sitio que en stories/*.jpg
// pie: en un bar, su nombre y dirección y su enlace (en vez de «Gracias por su visita»)
export function paintStory(napkin, logo, bg = '#3F48F4', pie = null) {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 1600;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 900, 1600);
  const [x0, y0, x1, y1] = (napkin.dataset.box || '112,316,778,1283').split(',').map(Number);
  g.drawImage(napkin, x0, y0, x1 - x0, y1 - y0);
  if (logo) {
    // CAFECITA es una tira; el logo de un bar, casi cuadrado, va más grande
    const tall = logo.naturalWidth / logo.naturalHeight < 4;
    const lh = tall ? 130 : 52, lw = Math.min(600, lh * logo.naturalWidth / logo.naturalHeight);
    g.drawImage(logo, (900 - lw) / 2, tall ? 110 : 1392, lw, lw * logo.naturalHeight / logo.naturalWidth);
  }
  g.fillStyle = '#F7F3EA';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (pie) {
    g.font = SANS(30, 500);
    g.globalAlpha = 0.85;
    g.fillText(pie[0], 450, 1420);
    g.globalAlpha = 1;
    g.font = SANS(34, 700);
    spaced(g, pie[1], 450, 1478, 0.04);
  } else {
    g.font = SERIF(44);
    g.fillText('Gracias por su visita', 450, 1474);
  }
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
}

// ---------- Arrugada ----------
// Una servilleta que ya se hizo bola y se vuelve a abrir: el papel queda en facetas con sus
// pliegues (Voronoi a baja resolución, que luego se suaviza al ampliarlo) y se funde con
// luz suave sobre lo pintado, sin tocar la silueta.
function prng(seed) { // mulberry32
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wrinkle(canvas, seed) {
  const W = canvas.width, H = canvas.height;
  const sw = Math.round(W / 4), sh = Math.round(H / 4);
  const rnd = prng(seed);
  const pts = Array.from({ length: 80 }, () => ({ x: rnd() * sw, y: rnd() * sh, n: (rnd() - 0.5) * 2 }));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sg = small.getContext('2d');
  const img = sg.createImageData(sw, sh), d = img.data;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let d1 = Infinity, d2 = Infinity, best = null;
      for (const p of pts) {
        const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (dd < d1) { d2 = d1; d1 = dd; best = p; } else if (dd < d2) d2 = dd;
      }
      // cada faceta mira a un lado; en la arista entre dos, el pliegue
      const edge = Math.exp(-(Math.sqrt(d2) - Math.sqrt(d1)) / 1.2);
      const v = 128 + best.n * 52 - edge * 70 + (rnd() - 0.5) * 6;
      const i = (y * sw + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  sg.putImageData(img, 0, 0);
  const g = canvas.getContext('2d');
  const shape = document.createElement('canvas');
  shape.width = W;
  shape.height = H;
  shape.getContext('2d').drawImage(canvas, 0, 0);
  g.save();
  g.imageSmoothingEnabled = true;
  g.globalCompositeOperation = 'soft-light';
  g.drawImage(small, 0, 0, W, H);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(shape, 0, 0);
  g.restore();
  return canvas;
}
