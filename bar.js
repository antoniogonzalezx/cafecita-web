// ---------- Bares ----------
// Cada bar tiene su página, cafecita.app/<bar>/, con el mismo servilletero que la web pero con lo
// suyo: sus sugerencias del día escritas a boli en la servilleta y su carta. Es gratis; con Pro,
// además, su logo, su color y su servilletero (ver «Cafecita y Cafecita Pro»).
// La ficha de cada bar es bares/<bar>.json. En la demo, lo que se guarda en la gestión
// (<bar>/gestion/) se queda en este navegador y pisa la ficha.

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
  const base = await fetch(`bares/${id}.json`).then((r) => r.json());
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY(id))); } catch {}
  return saved && saved.id === id ? { ...base, ...saved, marca: { ...base.marca, ...saved.marca } } : base;
}
export function saveBar(bar) {
  localStorage.setItem(KEY(bar.id), JSON.stringify(bar));
}
export function resetBar(id) {
  try { localStorage.removeItem(KEY(id)); } catch {}
}

export const isPro = (bar) => bar.plan === 'pro';

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

export function renderCarta(root, bar) {
  root.replaceChildren();
  for (const sec of bar.carta || []) {
    if (!sec.platos?.length) continue;
    const s = h('section', 'carta-sec');
    s.append(h('h3', 'carta-sec-title', sec.seccion));
    const list = h('ul', 'carta-list');
    for (const p of sec.platos) {
      const li = h('li', `carta-item${p.agotado ? ' agotado' : ''}`);
      const row = h('div', 'carta-row');
      row.append(h('span', 'carta-name', p.nombre), h('span', 'carta-price', precio(p.precio, true)));
      li.append(row);
      const al = h('p', 'carta-al');
      if (p.agotado) al.append(h('span', 'carta-out', 'Agotado'));
      al.append(Array.isArray(p.alergenos)
        ? (p.alergenos.length ? `Contiene: ${p.alergenos.map((a) => ALERGENOS[a] || a).join(', ')}` : 'Sin alérgenos declarados')
        : 'Alérgenos: pregunta al personal');
      li.append(al);
      list.append(li);
    }
    s.append(list);
    root.append(s);
  }
  if (bar.direccion || bar.horario) {
    const foot = h('footer', 'carta-foot');
    if (bar.direccion) foot.append(h('p', null, bar.direccion));
    if (bar.horario) foot.append(h('p', null, bar.horario));
    root.append(foot);
  }
}
