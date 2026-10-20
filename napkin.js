// ---------- Servilletas pintadas al vuelo ----------
// Las noticias, los anuncios y el aviso de reponer se rotulan en el navegador sobre una de las
// servilletas fotografiadas de las plantillas (templates/, las genera tools/build_templates.py):
// arriba el titular, el periódico y la fecha; en la solapa, «Gracias por su visita» y el logo.
const SCALE = 1.5;                 // más resolución que la foto para que la letra salga nítida
const QUOTE = '#537393';           // los mismos azules que las servilletas de las citas
const AUTHOR = '#415F7A';
const SERIF = (s) => `italic 400 ${s}px Fraunces, Georgia, serif`;
const SANS = (s, w = 700) => `${w} ${s}px 'Bricolage Grotesque', system-ui, sans-serif`;

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
// La plantilla sale del id: la misma noticia cae siempre en la misma servilleta.
export async function paintNapkin(canvas, item, { logo } = {}) {
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
  g.fillText('Gracias por su visita', W / 2, cy);
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

// La story para compartir: la servilleta sobre azul en el mismo sitio que en stories/*.jpg
export function paintStory(napkin, logo) {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 1600;
  const g = c.getContext('2d');
  g.fillStyle = '#3F48F4';
  g.fillRect(0, 0, 900, 1600);
  const [x0, y0, x1, y1] = (napkin.dataset.box || '112,316,778,1283').split(',').map(Number);
  g.drawImage(napkin, x0, y0, x1 - x0, y1 - y0);
  if (logo) {
    const lh = 52, lw = lh * logo.naturalWidth / logo.naturalHeight;
    g.drawImage(logo, (900 - lw) / 2, 1392, lw, lh);
  }
  g.fillStyle = '#F7F3EA';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = SERIF(44);
  g.fillText('Gracias por su visita', 450, 1474);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
}
