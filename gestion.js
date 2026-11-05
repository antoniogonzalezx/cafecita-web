// ---------- Gestión de un bar ----------
// Lo que el bar cambia de su página: sugerencias del día, carta y datos (gratis) y, con Pro,
// su logo, su color y el acabado del servilletero. Un bar dado de alta entra con su código de
// acceso y lo que cambia se guarda en el servidor; en la demo (Bar Manolo), en este navegador.
// La vista previa de la derecha es su página de verdad, que se recarga al guardar.
import { loadBar, saveBar, resetBar, entrar, guardarRemoto, isPro, logoOf, logoImage, servilletas, servilletaDe, titulo, precio, ALERGENOS, COLORES, ACABADOS, TIPOS, DEFAULT_COLOR, LETRAS, letraCss, fotoUrl, prepararFoto, subirFoto } from './bar.js?v=9';
import { paintNapkin, tintaDe } from './napkin.js?v=25';
import { medir } from './medir.js?v=14';

const ID = document.body.dataset.bar;
// la vista previa es la página entera (con su 3D): solo se carga donde se ve, no en el móvil,
// que ya tiene «Ver mi página» y la servilleta de muestra
const WIDE = matchMedia('(min-width: 761px)');
const frame = () => document.getElementById('gFrame');
frame().dataset.src = `/${ID}/`;
document.getElementById('gVer')?.setAttribute('href', `/${ID}/`);
document.getElementById('gVer')?.addEventListener('click', () => marcarPaso('ver'));
function syncFrame() {
  const f = frame();
  if (WIDE.matches && !f.getAttribute('src')) f.src = f.dataset.src;
}
WIDE.addEventListener('change', syncFrame);
syncFrame();
let bar = await loadBar(ID);
const DEMO = !bar.remoto;
const letraDe = (b) => (isPro(b) && LETRAS[b.marca.letra] ? b.marca.letra : 'clasica');

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

// ---------- Acceso ----------
// El código llega en el enlace que da Cafecita (#codigo=…, que no sale del navegador) o se
// escribe aquí; se recuerda en este navegador hasta que se pulsa «Salir».
const KEY_CODIGO = `cafecita.acceso.${ID}`;
let codigo = null;
function recordar(c) { try { if (c) localStorage.setItem(KEY_CODIGO, c); else localStorage.removeItem(KEY_CODIGO); } catch {} }
async function acceso() {
  const m = location.hash.match(/codigo=([A-Za-z0-9-]+)/);
  if (m) history.replaceState(null, '', location.pathname + location.search);
  let c = m?.[1] || null;
  if (!c) try { c = localStorage.getItem(KEY_CODIGO); } catch {}
  if (c && await entrar(ID, c).catch(() => null)) { codigo = c; recordar(c); return true; }
  recordar(null);
  return false;
}
// msg: un aviso (al salir) o, con error, lo que ha fallado
function pantallaAcceso(msg, error = false) {
  document.body.classList.add('g-sin-acceso');
  const input = el('input', { class: 'g-input g-codigo', placeholder: 'XXXX-XXXX-XXXX', 'aria-label': 'Código de acceso', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: false });
  const err = el('p', { class: error ? 'g-error' : 'g-aviso', role: 'alert', hidden: !msg }, msg || '');
  const go = async (e) => {
    e.preventDefault();
    const c = input.value.trim();
    if (!c) return;
    err.hidden = true;
    err.className = 'g-error';
    const ok = await entrar(ID, c).catch(() => null);
    if (ok === null) { err.textContent = 'No hay conexión. Prueba otra vez en un momento.'; err.hidden = false; return; }
    if (!ok) { err.textContent = 'Ese código no es el de este bar. Revísalo o escríbenos a hola@cafecita.es.'; err.hidden = false; return; }
    codigo = c;
    recordar(c);
    document.body.classList.remove('g-sin-acceso');
    render();
  };
  $('gForm').replaceChildren(el('section', { class: 'g-card g-acceso' },
    el('header', { class: 'g-card-head' }, el('h2', {}, 'Entra en tu gestión'),
      el('p', { class: 'g-sub' }, 'Escribe tu código de acceso (el que te salió al darte de alta). Lo recordaremos en este dispositivo.')),
    el('form', { class: 'g-acceso-form', onsubmit: go }, input, el('button', { type: 'submit', class: 'g-btn g-btn-brand' }, 'Entrar')),
    err));
  input.focus();
}
function salir() {
  codigo = null;
  recordar(null);
  pantallaAcceso('Has salido. Para volver a entrar, escribe tu código.');
}

// ---------- Guardar ----------
// Cada cambio se guarda solo (en el servidor o, en la demo, en este navegador); la vista previa
// se recarga un poco después (es la página entera).
let saveTimer = null, frameTimer = null, retry = null;
async function guardar() {
  if (DEMO) { saveBar(bar); return true; }
  const status = await guardarRemoto(bar, codigo).catch(() => 0);
  if (status === 401) { salir(); $('gSaved').textContent = ''; return false; }
  if (status === 413) throw new Error('grande');
  if (status !== 200) {
    // sin conexión: lo intenta otra vez dentro de un rato, sin perder lo escrito
    $('gSaved').textContent = 'Sin conexión: se guardará en cuanto vuelva';
    clearTimeout(retry);
    retry = setTimeout(() => changed(), 8000);
    return false;
  }
  return true;
}
function changed({ redraw = false, napkin = false, brand = false } = {}) {
  clearTimeout(saveTimer);
  $('gSaved').textContent = 'Guardando…';
  saveTimer = setTimeout(async () => {
    let ok = false;
    try {
      ok = await guardar();
      if (ok) $('gSaved').textContent = 'Guardado';
    } catch {
      $('gSaved').textContent = DEMO ? 'No se ha podido guardar: en la demo caben pocas fotos' : 'No se ha podido guardar (¿logo muy grande?)';
    }
    if (!ok) return;
    clearTimeout(frameTimer);
    frameTimer = setTimeout(() => { if (frame().getAttribute('src')) frame().contentWindow?.location.reload(); }, 500);
  }, DEMO ? 350 : 700);
  // el logo y el color se cargan antes de redibujar, que los usan
  const after = () => { if (redraw) render(); else if (napkin || brand) paintPreview(); if (!redraw) refrescarPasos(); };
  if (brand) paintBrand().then(after); else after();
}

// Quitar algo no pregunta: se quita y, durante unos segundos, se puede deshacer
let toastTimer = null;
function undoable(msg, mutate) {
  const before = structuredClone(bar);
  mutate();
  changed({ redraw: true, napkin: true });
  const toast = $('gToast');
  toast.replaceChildren(el('span', {}, msg), el('button', { type: 'button', class: 'g-toast-undo', onclick: () => {
    bar = before;
    toast.hidden = true;
    changed({ redraw: true, napkin: true });
  } }, 'Deshacer'));
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}

// ---------- Cabecera y colores de la propia gestión ----------
let logo = null;
async function paintBrand() {
  const pro = isPro(bar);
  document.documentElement.style.setProperty('--brand', pro ? bar.marca.color : DEFAULT_COLOR);
  const l = LETRAS[letraDe(bar)];
  document.documentElement.style.setProperty('--boli', `'${l.family}', Georgia, serif`);
  document.documentElement.style.setProperty('--boli-style', l.style || 'normal');
  document.documentElement.style.setProperty('--boli-case', l.caps ? 'uppercase' : 'none');
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
  const src = pro && logo ? logo : { svg: await fetch('logo.svg?v=2').then((r) => r.text()) };
  // la misma tinta que la servilleta de verdad: el color del bar (sin Pro, el de cafecita)
  const ink = tintaDe(pro ? bar.marca.color : DEFAULT_COLOR);
  const img = await logoImage(src, ink);
  const letra = letraDe(bar);
  await document.fonts.load(letraCss(LETRAS[letra], 60)).catch(() => {});
  // la que esté elegida en las pestañas de encima (o la primera que haya)
  const list = servilletas(bar);
  const n = list.find((x) => x.tipo === previewTipo) || list[0]
    || { tipo: 'sugerencia', title: titulo('sugerencia'), lines: ['- Hoy, lo de siempre'] };
  drawTabs(list, n.tipo);
  const tmp = document.createElement('canvas');
  await paintNapkin(tmp, { kind: 'bar', id: `${n.tipo}-gestion`, title: n.title, lines: n.lines }, { logo: img, ink, letra });
  if (seq !== previewSeq) return;
  c.width = tmp.width;
  c.height = tmp.height;
  c.getContext('2d').drawImage(tmp, 0, 0);
}

let previewTipo = 'sugerencia';
function drawTabs(list, on) {
  const tabs = $('gTabs');
  if (!tabs) return;
  tabs.replaceChildren(...list.map((x) => el('button', {
    type: 'button', class: `g-tab${x.tipo === on ? ' on' : ''}`, 'aria-pressed': String(x.tipo === on),
    onclick: () => { previewTipo = x.tipo; paintPreview(); },
  }, x.title)));
  tabs.hidden = list.length < 2;
}

// ---------- Secciones ----------
// Piloto: los bares que empiezan antes del 31 de enero de 2027 tienen Pro gratis hasta entonces.
// En enero cada uno dice si sigue con Pro (pagando) o pasa a Basic; nadie paga sin decirlo.
const PILOTO = Date.parse('2027-01-31T23:59:59+01:00');
const enPiloto = () => Date.now() <= PILOTO;
const SEGUIR_KEY = `cafecita.pro.seguir.${ID}`;

function seguirConPro() {
  const hecho = el('p', { class: 'g-note' }, 'Apuntado. En enero te escribimos para dejarlo listo.');
  let ya = false;
  try { ya = localStorage.getItem(SEGUIR_KEY) === '1'; } catch {}
  if (ya) return hecho;
  const b = el('button', { type: 'button', class: 'g-btn g-btn-seguir', onclick: () => {
    medir('enlace', { a: 'pro:seguir', bar: ID });
    try { localStorage.setItem(SEGUIR_KEY, '1'); } catch {}
    b.replaceWith(hecho);
  } }, 'Quiero seguir con Pro en febrero');
  return b;
}

function planCard() {
  const pro = isPro(bar);
  if (!DEMO && pro && enPiloto()) {
    return card('Tu plan', 'Tienes Cafecita Pro gratis hasta el 31 de enero: tu logo, tu color, tu servilletero y tu letra, sin anuncios.',
      el('p', { class: 'g-note' }, 'Después, Pro cuesta 9,99 € + IVA al mes o 99 € + IVA al año. Si no quieres seguir, pasas a Basic, gratis, y no pierdes nada. No te cobramos nada sin que nos lo digas.'),
      seguirConPro());
  }
  // un bar dado de alta no se cambia el plan: lo pone Cafecita
  if (!DEMO) {
    return card('Tu plan', pro ? 'Tienes Cafecita Pro: tu logo, tu color, tu servilletero y tu letra, sin anuncios.'
      : 'Tienes Cafecita Basic, gratis. Con Pro, por 9,99 € + IVA al mes, tu página lleva tu logo, tu color, tu servilletero y tu letra, sin anuncios.',
    el('p', { class: 'g-note' }, pro ? 'Para cualquier cambio en tu plan, habla con Cafecita.' : 'Para pasarte a Pro, habla con Cafecita. ',
      !pro && el('a', { href: '/carta/#precios', target: '_blank', rel: 'noopener' }, 'Ver los planes')));
  }
  const opt = (value, title, price, text) => el('button', {
    type: 'button', class: `g-plan${bar.plan === value ? ' on' : ''}`, 'aria-pressed': String(bar.plan === value),
    onclick: () => { bar.plan = value; changed({ redraw: true, brand: true }); },
  }, el('span', { class: 'g-plan-name' }, title, el('b', {}, price)), el('span', { class: 'g-plan-text' }, text));
  return card('Tu plan', 'En la demo puedes cambiar de plan sin pagar, para ver la diferencia.',
    el('div', { class: 'g-plans' },
      opt('gratis', 'Basic', 'Gratis', 'Tu página, tus sugerencias y tu carta, con el color y el logo de Cafecita.'),
      opt('pro', 'Pro', '9,99 € + IVA/mes', 'Tu logo, tu color, tu servilletero y tu letra. Sin anuncios. O 99 € + IVA al año: dos meses gratis.')),
    !pro && el('p', { class: 'g-note' }, 'Con Basic, de vez en cuando sale un anuncio de Cafecita en tu servilletero.'),
    enPiloto() && el('p', { class: 'g-note' }, 'Si empiezas antes del 31 de enero, Pro es gratis hasta entonces.'));
}

// Lo de hoy: cada línea es una sugerencia del día o algo fuera de carta, y cada tipo sale en
// su propia servilleta, rotulada. Con Pro, también con el título que el bar quiera (las líneas
// con el mismo título van juntas). Lo más pedido no se escribe aquí: son los platos marcados en la carta.
function hoyCard() {
  const pro = isPro(bar);
  const rows = el('div', { class: 'g-rows' });
  const tipos = pro ? ['sugerencia', 'fuera', 'propio'] : ['sugerencia', 'fuera'];
  const nombre = (t) => (t === 'propio' ? 'Con tu título' : TIPOS[t]);
  const draw = () => {
    rows.replaceChildren(...bar.sugerencias.map((s, i) => el('div', { class: 'g-row g-hoy' },
      el('select', { class: 'g-input g-tipo', 'aria-label': 'Qué es',
        onchange: (e) => {
          s.tipo = e.target.value;
          if (s.tipo === 'propio') s.titulo ??= ''; else delete s.titulo;
          previewTipo = servilletaDe(bar, s);
          draw();
          changed({ napkin: true });
          if (s.tipo === 'propio') rows.children[i]?.querySelector('.g-titulo')?.focus();
        } },
        ...tipos.map((t) => el('option', { value: t, selected: (s.tipo || 'sugerencia') === t }, nombre(t)))),
      pro && s.tipo === 'propio' && el('input', { class: 'g-input g-titulo', value: s.titulo || '', maxlength: 40,
        placeholder: 'Título de la servilleta: Plato del día', 'aria-label': 'Título de la servilleta',
        oninput: (e) => { s.titulo = e.target.value; previewTipo = servilletaDe(bar, s); changed({ napkin: true }); } }),
      el('input', { class: 'g-input grow', value: s.texto, placeholder: s.tipo === 'fuera' ? 'Rabo de toro estofado' : 'Bocata de calamares',
        'aria-label': 'Plato', oninput: (e) => { s.texto = e.target.value; changed({ napkin: true }); } }),
      priceInput(s, () => changed({ napkin: true })),
      removeBtn('Quitar', () => undoable(`«${s.texto || 'Línea'}» quitada`, () => bar.sugerencias.splice(i, 1))),
      el('div', { class: 'g-hoy-al' }, ...alergenosUI(s)))));
  };
  draw();
  const add = (tipo, label) => el('button', { type: 'button', class: 'g-btn g-btn-add', onclick: () => {
    bar.sugerencias.push(tipo === 'propio' ? { tipo, titulo: '', texto: '', precio: '' } : { tipo, texto: '', precio: '' });
    previewTipo = tipo;
    draw();
    rows.lastElementChild?.querySelector('input')?.focus();
  } }, label);
  return card('Hoy en la barra', pro
    ? 'Cada cosa sale en su servilleta, rotulada a mano: la sugerencia del día, lo que hay fuera de carta, lo que tú quieras con tu título y lo más pedido (los platos que marques con ★ en la carta).'
    : 'Cada cosa sale en su servilleta, rotulada a mano: la sugerencia del día, lo que hay fuera de carta y lo más pedido (los platos que marques con ★ en la carta).',
    el('div', { class: 'g-split' },
      el('div', { class: 'g-split-main' }, rows,
        el('div', { class: 'g-adds' }, add('sugerencia', '+ Sugerencia del día'), add('fuera', '+ Fuera de carta'), pro && add('propio', '+ Con tu título'))),
      el('figure', { class: 'g-napkin' },
        el('div', { class: 'g-tabs', id: 'gTabs', role: 'group', 'aria-label': 'Qué servilleta ver' }),
        el('canvas', { id: 'gNapkin', role: 'img', 'aria-label': 'Así sale la servilleta' }),
        el('figcaption', {}, 'Así sale la servilleta'))));
}

function marcaCard() {
  const pro = isPro(bar);
  const m = bar.marca;
  const file = el('input', { type: 'file', accept: '.svg,image/svg+xml,image/png,image/jpeg,image/webp', hidden: true, onchange: (e) => upload(e.target.files[0]) });
  const logoBox = el('div', { class: 'g-logo-box' });
  const logoErr = el('p', { class: 'g-error', role: 'alert', hidden: true }, 'El logo pesa demasiado: tiene que ocupar menos de 400 KB.');
  logoImage(logo, '#F7F3EA').then((img) => logoBox.replaceChildren(img || el('span', {}, 'Sin logo')));
  async function upload(f) {
    if (!f) return;
    logoErr.hidden = f.size <= 400 * 1024;
    if (!logoErr.hidden) return;
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
        file), logoErr),
      'SVG de un color (se pinta en la tinta de la servilleta) o PNG. Sale arriba de tu página y en la solapa.'),
    field('Color de tu página', el('div', { class: 'g-swatches' }, COLORES.map(swatch),
      el('input', { type: 'color', class: 'g-color', value: m.color, 'aria-label': 'Otro color', disabled: !pro,
        onchange: (e) => { m.color = e.target.value; changed({ redraw: true, brand: true }); } }))),
    field('Servilletero', el('div', { class: 'g-finishes' }, Object.keys(ACABADOS).map(finish))),
    field('Letra de lo que escribes', el('div', { class: 'g-letras' }, Object.entries(LETRAS).map(([k, l]) => {
      const on = (m.letra || 'clasica') === k;
      const muestra = el('span', { class: 'g-letra-muestra' }, l.caps ? 'SUGERENCIA DEL DÍA' : 'Sugerencia del día');
      muestra.style.fontFamily = `'${l.family}', Georgia, serif`;
      muestra.style.fontStyle = l.style || 'normal';
      return el('button', { type: 'button', class: `g-letra${on ? ' on' : ''}`, 'aria-pressed': String(on), disabled: !pro,
        onclick: () => { m.letra = k; changed({ redraw: true, brand: true }); } },
      muestra, el('span', { class: 'g-letra-nombre' }, k === 'clasica' ? `${l.nombre} (la de la frase)` : l.nombre));
    })), 'La de las servilletas y los títulos de tu carta.'));
  return card('Tu marca', pro ? 'Lo que hace que tu página sea tuya.' : null,
    !pro && el('div', { class: 'g-lock' },
      el('p', {}, el('b', {}, 'Con Cafecita Pro'), ' tu página lleva tu logo, tu color y tu servilletero, en vez de los de Cafecita.'),
      DEMO && el('button', { type: 'button', class: 'g-btn g-btn-brand', onclick: () => { bar.plan = 'pro'; changed({ redraw: true, brand: true }); } }, 'Probar Pro')),
    body);
}

function cartaCard() {
  const wrap = el('div', { class: 'g-carta' });
  const draw = () => wrap.replaceChildren(...bar.carta.map((sec, si) => el('div', { class: 'g-sec' },
    el('div', { class: 'g-sec-head' },
      el('input', { class: 'g-input g-sec-name', value: sec.seccion, 'aria-label': 'Nombre de la sección', placeholder: 'Sección',
        oninput: (e) => { sec.seccion = e.target.value; changed(); } }),
      removeBtn('Quitar la sección', () => undoable(`Sección «${sec.seccion}» quitada`, () => bar.carta.splice(si, 1)))),
    el('div', { class: 'g-items' }, sec.platos.map((p, pi) => itemRow(p, () => undoable(`«${p.nombre || 'Plato'}» quitado`, () => sec.platos.splice(pi, 1))))),
    el('button', { type: 'button', class: 'g-btn g-btn-add', onclick: () => {
      sec.platos.push({ nombre: '', precio: '', alergenos: null });
      draw();
      wrap.children[si].querySelector('.g-items').lastElementChild?.querySelector('input')?.focus();
    } }, '+ Añadir plato'))));
  draw();
  return card('La carta', 'Lo agotado se ve tachado, y los alérgenos siempre a la vista. Si no los marcas, la carta dice «pregunta al personal».',
    wrap, el('button', { type: 'button', class: 'g-btn g-btn-add', onclick: () => {
      bar.carta.push({ seccion: 'Nueva sección', platos: [] }); draw(); changed();
    } }, '+ Añadir sección'),
    isPro(bar) && el('p', { class: 'g-note' }, 'Las fotos quedan mejor con luz natural y el plato en el centro. Que sean tuyas: las de internet tienen dueño.'));
}

// Los 14 alérgenos de un plato (o de lo de hoy): un resumen que se despliega en botones.
// «No lo sé» deja que la carta diga «pregunta al personal», nunca una suposición.
function alergenosUI(p) {
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
  return [summary, al];
}

function itemRow(p, remove) {
  const row = el('div', { class: `g-item${p.agotado ? ' out' : ''}` },
    el('div', { class: 'g-row' },
      el('input', { class: 'g-input grow', value: p.nombre, placeholder: 'Nombre del plato', 'aria-label': 'Plato',
        oninput: (e) => { p.nombre = e.target.value; changed(); } }),
      priceInput(p, () => changed()),
      el('label', { class: 'g-toggle g-star', title: 'Sale en la servilleta de lo más pedido' },
        el('input', { type: 'checkbox', checked: !!p.destacado, onchange: (e) => { p.destacado = e.target.checked; if (p.destacado) previewTipo = 'estrella'; changed({ napkin: true }); } }),
        el('span', {}, '★ Más pedido')),
      el('label', { class: 'g-toggle', title: 'Se ve tachado en la carta' },
        el('input', { type: 'checkbox', checked: !!p.agotado, onchange: (e) => { p.agotado = e.target.checked; row.classList.toggle('out', p.agotado); changed({ napkin: true }); } }),
        el('span', {}, 'Agotado')),
      removeBtn('Quitar el plato', remove)),
    ...pieDePlato(p));
  return row;
}

// Debajo del plato: su foto (con Pro) y sus alérgenos, que se despliegan debajo
function pieDePlato(p) {
  const [summary, al] = alergenosUI(p);
  return [el('div', { class: 'g-item-foot' }, fotoUI(p), summary), al];
}

// La foto del plato: se recorta y se comprime aquí mismo, en el móvil, y se sube al momento
// (en la demo se queda en este navegador). Sin Pro se ve, pero apagada.
const CAMARA = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
function fotoUI(p) {
  const box = el('div', { class: 'g-foto' });
  const icono = () => Object.assign(el('span', { class: 'g-foto-ico' }), { innerHTML: CAMARA });
  const input = el('input', { type: 'file', accept: 'image/*', class: 'g-foto-file', tabindex: -1, 'aria-hidden': 'true', onchange: (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) subir(f);
  } });
  const elegir = () => input.click();
  const draw = (estado) => {
    if (!isPro(bar)) {
      const nota = el('span', { class: 'g-foto-msg', hidden: true }, DEMO ? 'Cámbiate a Pro en «Tu plan» para probarlo.' : 'Las fotos de los platos van con Pro.');
      box.replaceChildren(el('button', { type: 'button', class: 'g-foto-add g-foto-lock', onclick: () => { nota.hidden = false; } },
        icono(), 'Foto', el('b', {}, 'Pro')), nota);
      return;
    }
    if (estado === 'subiendo') {
      box.replaceChildren(el('span', { class: 'g-foto-msg', role: 'status' }, 'Subiendo la foto…'));
      return;
    }
    // replaceChildren no se salta los null: sin error, una cadena vacía
    const error = estado ? el('span', { class: 'g-foto-msg g-foto-err', role: 'alert' }, estado) : '';
    if (!p.foto) {
      box.replaceChildren(input, el('button', { type: 'button', class: 'g-foto-add', onclick: elegir }, icono(), 'Añadir foto'), error);
      return;
    }
    box.replaceChildren(input,
      el('button', { type: 'button', class: 'g-foto-thumb', 'aria-label': 'Cambiar la foto', title: 'Cambiar la foto', onclick: elegir },
        el('img', { src: fotoUrl(bar, p.foto), alt: '', width: 72, height: 72 })),
      el('button', { type: 'button', class: 'g-link', onclick: () => undoable('Foto quitada', () => { delete p.foto; }) }, 'Quitar'),
      error);
  };
  async function subir(f) {
    draw('subiendo');
    let msg = 'No se ha podido subir. Prueba otra vez.';
    try {
      const blob = await prepararFoto(f).catch(() => { msg = 'Esa imagen no se puede abrir. Prueba con otra foto.'; throw 0; });
      if (DEMO) {
        p.foto = await new Promise((res, rej) => Object.assign(new FileReader(), { onload: (e) => res(e.target.result), onerror: rej }).readAsDataURL(blob));
      } else {
        const r = await subirFoto(ID, codigo, blob).catch(() => 0);
        if (r === 401) { salir(); return; }
        if (typeof r !== 'string') {
          if (r === 403) msg = 'Las fotos de los platos van con Pro.';
          if (r === 409) msg = 'Ya tienes 150 fotos: quita alguna antes.';
          throw 0;
        }
        p.foto = r;
      }
      draw();
      changed();
    } catch {
      draw(msg);
    }
  }
  draw();
  return box;
}

function priceInput(o, onChange) {
  return el('span', { class: 'g-price' },
    el('input', { class: 'g-input', inputmode: 'decimal', value: o.precio === '' || o.precio == null ? '' : precio(o.precio).replace('€', ''),
      placeholder: '0', 'aria-label': 'Precio en euros',
      oninput: (e) => {
        const v = e.target.value.trim(), n = v === '' ? '' : num(v);
        // solo números (con coma o punto): si no, se marca y no se guarda
        const bad = n !== '' && Number.isNaN(n);
        e.target.setAttribute('aria-invalid', String(bad));
        e.target.title = bad ? 'Solo números, por ejemplo 7,50' : '';
        if (bad) return;
        o.precio = n;
        onChange();
      } }),
    el('span', { class: 'g-euro' }, '€'));
}
const removeBtn = (label, onclick) => el('button', { type: 'button', class: 'g-remove', 'aria-label': label, title: label, onclick }, '×');

// lo que hay que imprimir para empezar: el QR de las mesas, el cartel y la carta en papel
// ---------- Primeros pasos (CAF-54) ----------
// La primera vez, tres cosas que hacer; cada una se marca sola al hacerla. Con las tres, la
// tarjeta dice «Listo» una vez y no vuelve a salir (en este navegador). En la demo no sale.
const PASOS_KEY = `cafecita.pasos.${ID}`;
function pasos() { try { return JSON.parse(localStorage.getItem(PASOS_KEY)) || {}; } catch { return {}; } }
function guardarPasos(p) { try { localStorage.setItem(PASOS_KEY, JSON.stringify(p)); } catch {} }
function marcarPaso(k) {
  const p = pasos();
  if (p[k]) return;
  guardarPasos({ ...p, [k]: 1 });
  refrescarPasos();
}
function refrescarPasos() {
  const nueva = pasosCard(), vieja = document.querySelector('.g-pasos-card');
  if (vieja) vieja.replaceWith(nueva || '');
  else if (nueva) $('gForm').prepend(nueva);
}
function pasosCard() {
  if (DEMO) return null;
  const p = pasos();
  if (p.fin) return null;
  const hecho = { hoy: (bar.sugerencias || []).some((s) => s.texto?.trim()), qr: !!p.qr, ver: !!p.ver };
  const listo = hecho.hoy && hecho.qr && hecho.ver;
  if (listo) guardarPasos({ ...p, fin: 1 }); // se ve esta vez y ya no vuelve
  const paso = (ok, ...kids) => el('li', { class: ok ? 'hecho' : '' }, el('span', { class: 'g-paso-check', 'aria-hidden': 'true' }), el('span', {}, ...kids),
    el('span', { class: 'g-visually-hidden' }, ok ? ' (hecho)' : ' (pendiente)'));
  const a = (href, txt, k) => el('a', { href, target: '_blank', rel: 'noopener', onclick: () => marcarPaso(k) }, txt);
  return el('section', { class: 'g-card g-pasos-card' },
    el('header', { class: 'g-card-head' }, el('h2', {}, listo ? 'Listo: tu bar ya está en cafecita' : 'Primeros pasos'),
      el('p', { class: 'g-sub' }, listo ? 'A partir de ahora, solo cambia lo de hoy cuando cambie.' : 'Tres cosas y tus clientes ya pueden ver tu carta.')),
    el('ol', { class: 'g-pasos' },
      paso(hecho.hoy, 'Pon tu plato del día en «Hoy en la barra»'),
      paso(hecho.qr, a(`/${ID}/imprimir/?que=mesas`, 'Imprime los QR', 'qr'), ' y pégalos en las mesas'),
      paso(hecho.ver, a(`/${ID}/`, 'Mira tu página', 'ver'), ' como la ven tus clientes')));
}

function imprimirCard() {
  const link = (que, title, sub) => el('a', { class: 'g-print', href: `/${ID}/imprimir/?que=${que}`, target: '_blank', rel: 'noopener', onclick: () => marcarPaso('qr') },
    el('span', { class: 'g-print-t' }, title), el('span', { class: 'g-print-s' }, sub));
  return card('Para imprimir', 'Listo para la impresora o para guardar en PDF.',
    el('div', { class: 'g-prints' },
      link('mesas', 'Pegatinas para las mesas', 'Seis QR por hoja, con el aviso de alérgenos'),
      link('barra', 'Cartel para la barra', 'A4 a todo color'),
      link('carta', 'Carta en papel', 'Con los alérgenos de cada plato')),
    // con Basic las pegatinas llevan el marco de azulejos de Cafecita; con Pro se puede quitar
    isPro(bar) && el('label', { class: 'g-toggle g-marco' },
      el('input', { type: 'checkbox', checked: bar.marca.marcoQr !== false, onchange: (e) => { bar.marca.marcoQr = e.target.checked; changed(); } }),
      el('span', {}, 'Marco de azulejos en las pegatinas')));
}

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
    pasosCard() || '', hoyCard(), cartaCard(), imprimirCard(), marcaCard(), datosCard(), planCard(),
    // replaceChildren no se salta los false: pondría «false» en la página
    DEMO ? el('p', { class: 'g-reset' }, el('button', { type: 'button', class: 'g-link', onclick: async (e) => {
      // dos toques: el primero pregunta, sin ventanas del navegador
      const b = e.currentTarget;
      if (!b.dataset.sure) {
        b.dataset.sure = '1';
        b.textContent = '¿Seguro? Pulsa otra vez para restablecer';
        setTimeout(() => { delete b.dataset.sure; b.textContent = 'Restablecer la demo'; }, 4000);
        return;
      }
      resetBar(ID);
      bar = await loadBar(ID);
      await paintBrand();
      render();
      if (frame().getAttribute('src')) frame().contentWindow?.location.reload();
    } }, 'Restablecer la demo')) : '');
  for (const d of document.querySelectorAll('.g-swatch-dot')) d.style.background = d.dataset.c;
  paintPreview();
}

await paintBrand();
// la demo avisa de que es una demo; un bar de verdad entra con su código y puede salir
$('gDemo').hidden = !DEMO;
if (!DEMO) {
  $('gSalir').hidden = false;
  $('gSalir').addEventListener('click', salir);
}
if (DEMO || await acceso()) render();
else pantallaAcceso();
