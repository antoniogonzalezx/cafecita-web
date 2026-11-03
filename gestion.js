// ---------- Gestión de un bar ----------
// Lo que el bar cambia de su página: sugerencias del día, carta y datos (gratis) y, con Pro,
// su logo, su color y el acabado del servilletero. En la demo se guarda en este navegador
// (bar.js) y la vista previa de la derecha es su página de verdad, que se recarga al guardar.
import { loadBar, saveBar, resetBar, isPro, logoOf, logoImage, sugerencia, precio, ALERGENOS, COLORES, ACABADOS, DEFAULT_COLOR } from './bar.js?v=1';
import { paintNapkin } from './napkin.js?v=14';

const ID = document.body.dataset.bar;
const INK = '#4A6789';
let bar = await loadBar(ID);
document.fonts.load("400 60px 'Reenie Beanie'").catch(() => {});

// ---------- DOM ----------
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat().filter((x) => x != null && x !== false));
  return e;
}
const $ = (id) => document.getElementById(id);
const card = (title, sub, ...kids) => el('section', { class: 'g-card' },
  el('header', { class: 'g-card-head' }, el('h2', {}, title), sub && el('p', { class: 'g-sub' }, sub)), ...kids);
const field = (label, input, hint) => el('label', { class: 'g-field' }, el('span', { class: 'g-label' }, label), input, hint && el('span', { class: 'g-hint' }, hint));
const num = (v) => (v === '' ? '' : Math.round(parseFloat(String(v).replace(',', '.')) * 100) / 100);

// ---------- Guardar ----------
// Cada cambio se guarda solo; la vista previa se recarga un poco después (es la página entera).
let saveTimer = null, frameTimer = null;
function changed({ redraw = false, napkin = false, brand = false } = {}) {
  clearTimeout(saveTimer);
  $('gSaved').textContent = 'Guardando…';
  saveTimer = setTimeout(() => {
    try {
      saveBar(bar);
      $('gSaved').textContent = 'Guardado';
    } catch {
      $('gSaved').textContent = 'No se ha podido guardar (¿logo muy grande?)';
    }
    clearTimeout(frameTimer);
    frameTimer = setTimeout(() => $('gFrame').contentWindow?.location.reload(), 500);
  }, 350);
  // el logo y el color se cargan antes de redibujar, que los usan
  const after = () => { if (redraw) render(); else if (napkin || brand) paintPreview(); };
  if (brand) paintBrand().then(after); else after();
}

// ---------- Cabecera y colores de la propia gestión ----------
let logo = null;
async function paintBrand() {
  const pro = isPro(bar);
  document.documentElement.style.setProperty('--brand', pro ? bar.marca.color : DEFAULT_COLOR);
  $('gName').textContent = bar.nombre || 'Tu bar';
  document.title = `Gestión · ${bar.nombre || 'Tu bar'}`;
  logo = await logoOf(bar).catch(() => null);
  const img = await logoImage(logo, '#F7F3EA');
  $('gLogo').replaceChildren(...(img ? [img] : []));
  $('gLogo').classList.toggle('empty', !img);
}

// la servilleta de sugerencias tal como saldrá (sin Pro, con CAFECITA en la solapa)
let previewSeq = 0;
async function paintPreview() {
  const c = $('gNapkin');
  if (!c) return;
  const seq = ++previewSeq;
  const pro = isPro(bar);
  const src = pro && logo ? logo : { svg: await fetch('logo.svg').then((r) => r.text()) };
  const img = await logoImage(src, INK);
  await document.fonts.load("400 60px 'Reenie Beanie'").catch(() => {});
  const lines = bar.sugerencias.filter((s) => s.texto.trim()).map(sugerencia);
  const tmp = document.createElement('canvas');
  await paintNapkin(tmp, { kind: 'bar', id: 'sugerencias-gestion', lines: lines.length ? lines : ['- Hoy, lo de siempre'] }, { logo: img });
  if (seq !== previewSeq) return;
  c.width = tmp.width;
  c.height = tmp.height;
  c.getContext('2d').drawImage(tmp, 0, 0);
}

// ---------- Secciones ----------
function planCard() {
  const pro = isPro(bar);
  const opt = (value, title, price, text) => el('button', {
    type: 'button', class: `g-plan${bar.plan === value ? ' on' : ''}`, 'aria-pressed': String(bar.plan === value),
    onclick: () => { bar.plan = value; changed({ redraw: true, brand: true }); },
  }, el('span', { class: 'g-plan-name' }, title, el('b', {}, price)), el('span', { class: 'g-plan-text' }, text));
  return card('Tu plan', 'En la demo puedes cambiar de plan sin pagar, para ver la diferencia.',
    el('div', { class: 'g-plans' },
      opt('gratis', 'Cafecita', 'Gratis', 'Tu página, tus sugerencias y tu carta, con la imagen de Cafecita.'),
      opt('pro', 'Cafecita Pro', '19 €/mes', 'Tu logo, tu color y tu servilletero. Sin anuncios de otras marcas.')),
    !pro && el('p', { class: 'g-note' }, 'Con el plan gratis, de vez en cuando sale un anuncio de Cafecita en tu servilletero.'));
}

function sugerenciasCard() {
  const rows = el('div', { class: 'g-rows' });
  const draw = () => {
    rows.replaceChildren(...bar.sugerencias.map((s, i) => el('div', { class: 'g-row' },
      el('input', { class: 'g-input grow', value: s.texto, placeholder: 'Bocata de calamares', 'aria-label': 'Sugerencia',
        oninput: (e) => { s.texto = e.target.value; changed({ napkin: true }); } }),
      priceInput(s, () => changed({ napkin: true })),
      removeBtn('Quitar sugerencia', () => { bar.sugerencias.splice(i, 1); draw(); changed({ napkin: true }); }))));
  };
  draw();
  return card('Sugerencias del día', 'Lo que escribes aquí sale a boli en la servilleta, como lo apuntaría el camarero.',
    el('div', { class: 'g-split' },
      el('div', { class: 'g-split-main' }, rows,
        el('button', { type: 'button', class: 'g-btn g-btn-add', onclick: () => {
          bar.sugerencias.push({ texto: '', precio: '' });
          draw();
          rows.lastElementChild?.querySelector('input')?.focus();
        } }, '+ Añadir sugerencia')),
      el('figure', { class: 'g-napkin' }, el('canvas', { id: 'gNapkin', role: 'img', 'aria-label': 'Así sale la servilleta' }),
        el('figcaption', {}, 'Así sale la servilleta'))));
}

function marcaCard() {
  const pro = isPro(bar);
  const m = bar.marca;
  const file = el('input', { type: 'file', accept: '.svg,image/svg+xml,image/png,image/jpeg,image/webp', hidden: true, onchange: (e) => upload(e.target.files[0]) });
  const logoBox = el('div', { class: 'g-logo-box' });
  logoImage(logo, '#F7F3EA').then((img) => logoBox.replaceChildren(img || el('span', {}, 'Sin logo')));
  async function upload(f) {
    if (!f) return;
    if (f.size > 400 * 1024) { alert('El logo tiene que pesar menos de 400 KB.'); return; }
    m.logo = f.type === 'image/svg+xml' || f.name.endsWith('.svg')
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await f.text())}`
      : await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
    changed({ redraw: true, brand: true });
  }
  const swatch = (c) => el('button', {
    type: 'button', class: `g-swatch${m.color.toLowerCase() === c.toLowerCase() ? ' on' : ''}`, 'aria-label': `Color ${c}`,
    'aria-pressed': String(m.color.toLowerCase() === c.toLowerCase()), disabled: !pro,
    onclick: () => { m.color = c; changed({ redraw: true, brand: true }); },
  }, el('span', { class: 'g-swatch-dot', 'data-c': c }));
  const finish = (k) => el('button', {
    type: 'button', class: `g-finish g-finish-${k}${m.servilletero === k ? ' on' : ''}`, 'aria-pressed': String(m.servilletero === k), disabled: !pro,
    onclick: () => { m.servilletero = k; changed({ redraw: true }); },
  }, el('span', { class: 'g-finish-box' }), ACABADOS[k]);
  const body = el('div', { class: `g-marca${pro ? '' : ' locked'}`, inert: !pro },
    field('Logo', el('div', { class: 'g-logo-row' }, logoBox,
      el('div', { class: 'g-logo-actions' },
        el('button', { type: 'button', class: 'g-btn', onclick: () => file.click() }, 'Subir logo'),
        el('button', { type: 'button', class: 'g-btn g-btn-ghost', onclick: () => { m.logo = `bares/${ID}/logo.svg`; changed({ redraw: true, brand: true }); } }, 'Usar el de ejemplo'),
        file)),
      'SVG de un color (se pinta en la tinta de la servilleta) o PNG. Sale arriba de tu página y en la solapa.'),
    field('Color de tu página', el('div', { class: 'g-swatches' }, COLORES.map(swatch),
      el('input', { type: 'color', class: 'g-color', value: m.color, 'aria-label': 'Otro color', disabled: !pro,
        onchange: (e) => { m.color = e.target.value; changed({ redraw: true, brand: true }); } }))),
    field('Servilletero', el('div', { class: 'g-finishes' }, Object.keys(ACABADOS).map(finish))));
  return card('Tu marca', pro ? 'Lo que hace que tu página sea tuya.' : null,
    !pro && el('div', { class: 'g-lock' },
      el('p', {}, el('b', {}, 'Con Cafecita Pro'), ' tu página lleva tu logo, tu color y tu servilletero, en vez de los de Cafecita.'),
      el('button', { type: 'button', class: 'g-btn g-btn-brand', onclick: () => { bar.plan = 'pro'; changed({ redraw: true, brand: true }); } }, 'Probar Pro')),
    body);
}

function cartaCard() {
  const wrap = el('div', { class: 'g-carta' });
  const draw = () => wrap.replaceChildren(...bar.carta.map((sec, si) => el('div', { class: 'g-sec' },
    el('div', { class: 'g-sec-head' },
      el('input', { class: 'g-input g-sec-name', value: sec.seccion, 'aria-label': 'Nombre de la sección', placeholder: 'Sección',
        oninput: (e) => { sec.seccion = e.target.value; changed(); } }),
      removeBtn('Quitar la sección', () => {
        if (sec.platos.length && !confirm(`¿Quitar «${sec.seccion}» y sus ${sec.platos.length} platos?`)) return;
        bar.carta.splice(si, 1); draw(); changed();
      })),
    el('div', { class: 'g-items' }, sec.platos.map((p, pi) => itemRow(p, () => { sec.platos.splice(pi, 1); draw(); changed(); }))),
    el('button', { type: 'button', class: 'g-btn g-btn-add', onclick: () => {
      sec.platos.push({ nombre: '', precio: '', alergenos: null });
      draw();
      wrap.children[si].querySelector('.g-items').lastElementChild?.querySelector('input')?.focus();
    } }, '+ Añadir plato'))));
  draw();
  return card('La carta', 'Lo agotado se ve tachado, y los alérgenos siempre a la vista. Si no los marcas, la carta dice «pregunta al personal».',
    wrap, el('button', { type: 'button', class: 'g-btn g-btn-add', onclick: () => {
      bar.carta.push({ seccion: 'Nueva sección', platos: [] }); draw(); changed();
    } }, '+ Añadir sección'));
}

function itemRow(p, remove) {
  const al = el('div', { class: 'g-al', hidden: true });
  const summary = el('button', { type: 'button', class: 'g-al-btn', 'aria-expanded': 'false' });
  const sum = () => {
    summary.textContent = !Array.isArray(p.alergenos) ? 'Alérgenos: sin marcar'
      : p.alergenos.length ? `Alérgenos: ${p.alergenos.map((a) => ALERGENOS[a]).join(', ')}` : 'Sin alérgenos';
    summary.classList.toggle('warn', !Array.isArray(p.alergenos));
  };
  summary.addEventListener('click', () => {
    al.hidden = !al.hidden;
    summary.setAttribute('aria-expanded', String(!al.hidden));
  });
  const chips = () => al.replaceChildren(
    ...Object.entries(ALERGENOS).map(([k, name]) => el('button', {
      type: 'button', class: `g-chip${p.alergenos?.includes(k) ? ' on' : ''}`, 'aria-pressed': String(!!p.alergenos?.includes(k)),
      onclick: () => {
        const list = Array.isArray(p.alergenos) ? p.alergenos : [];
        p.alergenos = list.includes(k) ? list.filter((x) => x !== k) : [...list, k];
        chips(); sum(); changed();
      },
    }, name)),
    el('button', { type: 'button', class: `g-chip g-chip-none${Array.isArray(p.alergenos) && !p.alergenos.length ? ' on' : ''}`,
      onclick: () => { p.alergenos = []; chips(); sum(); changed(); } }, 'No tiene'),
    el('button', { type: 'button', class: `g-chip g-chip-none${!Array.isArray(p.alergenos) ? ' on' : ''}`,
      onclick: () => { p.alergenos = null; chips(); sum(); changed(); } }, 'No lo sé'));
  chips();
  sum();
  const row = el('div', { class: `g-item${p.agotado ? ' out' : ''}` },
    el('div', { class: 'g-row' },
      el('input', { class: 'g-input grow', value: p.nombre, placeholder: 'Nombre del plato', 'aria-label': 'Plato',
        oninput: (e) => { p.nombre = e.target.value; changed(); } }),
      priceInput(p, () => changed()),
      el('label', { class: 'g-toggle', title: 'Se ve tachado en la carta' },
        el('input', { type: 'checkbox', checked: !!p.agotado, onchange: (e) => { p.agotado = e.target.checked; row.classList.toggle('out', p.agotado); changed(); } }),
        el('span', {}, 'Agotado')),
      removeBtn('Quitar el plato', remove)),
    summary, al);
  return row;
}

function priceInput(o, onChange) {
  return el('span', { class: 'g-price' },
    el('input', { class: 'g-input', inputmode: 'decimal', value: o.precio === '' || o.precio == null ? '' : String(o.precio).replace('.', ','),
      placeholder: '0', 'aria-label': 'Precio en euros',
      oninput: (e) => { const v = e.target.value.trim(); o.precio = v === '' ? '' : num(v); onChange(); } }),
    el('span', { class: 'g-euro' }, '€'));
}
const removeBtn = (label, onclick) => el('button', { type: 'button', class: 'g-remove', 'aria-label': label, title: label, onclick }, '×');

function datosCard() {
  const input = (k, ph) => el('input', { class: 'g-input', value: bar[k] || '', placeholder: ph,
    oninput: (e) => { bar[k] = e.target.value; changed({ brand: k === 'nombre' }); } });
  return card('Datos del bar', 'Salen al final de la carta.',
    field('Nombre', input('nombre', 'Bar Manolo')),
    field('Dirección', input('direccion', 'Calle del Pez, 14 · Madrid')),
    field('Horario', input('horario', 'De lunes a sábado, de 8:00 a 24:00')));
}

function render() {
  $('gForm').replaceChildren(
    planCard(), sugerenciasCard(), marcaCard(), cartaCard(), datosCard(),
    el('p', { class: 'g-reset' }, el('button', { type: 'button', class: 'g-link', onclick: async () => {
      if (!confirm('¿Volver a dejar la demo como estaba?')) return;
      resetBar(ID);
      bar = await loadBar(ID);
      await paintBrand();
      render();
      $('gFrame').contentWindow?.location.reload();
    } }, 'Restablecer la demo')));
  for (const d of document.querySelectorAll('.g-swatch-dot')) d.style.background = d.dataset.c;
  paintPreview();
}

await paintBrand();
render();
