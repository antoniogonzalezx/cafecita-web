import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gsap } from 'gsap';
import { paintNapkin, paintStory } from './napkin.js?v=7';
import * as sound from './sound.js?v=7';

// ---------- Medidas (cm, iguales que tools/blender_servilletero.py) ----------
const W = 9.0;      // ancho
const H = 11.8;     // alto
const D = 8.4;      // fondo (entre las dos bocas)
const T = 0.1;      // grosor de chapa
const LIFT = 0.25;  // gomas
const FLANGE = 0.3; // la chapa de la boca se dobla hacia dentro
const TOP = LIFT + H;
const WIN = { x: W / 2 - 0.6, bottom: LIFT + 1.0, top: TOP - 1.1 };
const PLATE_IN = D / 2 - T - FLANGE; // donde acaba la pestaña, por dentro
const PLATE_OUT = D / 2 + 0.03;    // cara exterior
const NAPKIN_Z = PLATE_IN - 0.05;  // el muelle aprieta el taco contra la ventana
// la servilleta cabe entera dentro: el borde de arriba queda escondido bajo el marco
const N_BOTTOM = LIFT + T + 0.2, N_TOP = TOP - T - 0.25;
const NW = 2 * WIN.x - 0.2, NH = N_TOP - N_BOTTOM;
const BASE_ROT = 0.55;
const PAPER = '#FBF9F4';

// ---------- Estado ----------
// El servilletero no se acaba: cada dispositivo lleva la cuenta de las que ha sacado
// y de las noticias que ya ha leído, para no repetirlas.
const STORE_KEY = 'cafecita.servilletero.v2';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const freshState = () => ({ count: 0, served: 0, quotes: 0, day: today(), quotesToday: 0, seen: [], last: null });
function loadState() {
  try {
    const s = { ...freshState(), ...JSON.parse(localStorage.getItem(STORE_KEY)) };
    if (Number.isInteger(s.count) && Number.isInteger(s.served) && Number.isInteger(s.quotes) && Array.isArray(s.seen)) return s;
  } catch {}
  return freshState();
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}
let state = loadState();
// ?reset vuelve a empezar (para pruebas)
if (new URLSearchParams(location.search).has('reset')) {
  state = freshState();
  saveState();
  try { ['cafecita.suelo.v1', 'cafecita.onboarding.v1'].forEach((k) => localStorage.removeItem(k)); } catch {}
  history.replaceState(null, '', location.pathname);
}

// ---------- Citas ----------
// Cada dispositivo tiene su propia baraja de citas, sin repetir hasta acabar el mazo.
// Las legendarias pesan menos, así que suelen salir tarde.
const DECK_KEY = 'cafecita.baraja.v1';
const WEIGHT = { comun: 6, rara: 3, legendaria: 1 };

function loadDeck() {
  try {
    const d = JSON.parse(localStorage.getItem(DECK_KEY));
    if (d && Number.isInteger(d.seed)) return d;
  } catch {}
  const d = { seed: crypto.getRandomValues(new Uint32Array(1))[0] | 0 };
  try { localStorage.setItem(DECK_KEY, JSON.stringify(d)); } catch {}
  return d;
}

function prng(seed) { // mulberry32
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// barajado ponderado sin repetición (Efraimidis–Spirakis): clave u^(1/peso)
function shuffle(cards, seed) {
  const rnd = prng(seed);
  return cards
    .map((c) => ({ c, k: Math.pow(rnd() || 1e-9, 1 / (WEIGHT[c.rareza] || WEIGHT.rara)) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.c);
}

function drawCard(cards, salt, n) {
  const round = (r) => shuffle(cards, Math.imul(deck.seed ^ salt, 0x9E3779B1) + r);
  const r = Math.floor(n / cards.length), i = n % cards.length;
  const order = round(r);
  // que la primera de una vuelta no repita la última de la anterior
  if (r > 0 && cards.length > 1 && order[0] === round(r - 1).at(-1)) [order[0], order[1]] = [order[1], order[0]];
  return order[i];
}

// ---------- Qué sale en cada servilleta ----------
// Noticias sin fin mientras haya (noticias.json, lo renueva cada media hora .github/workflows/noticias.yml),
// como mucho QUOTES_PER_DAY citas al día entre medias y, cada AD_EVERY, un anuncio (anuncios.json).
// Si ya se han leído todas las noticias, sale el aviso de que el personal está reponiendo.
const AD_EVERY = 10;      // como mucho 1 de cada 10 (monetizacion.md)
const QUOTES_PER_DAY = 2;
const QUOTE_ODDS = 0.2;
const getNews = () => fetch('noticias.json', { cache: 'no-cache' }).then((r) => r.json()).then((d) => d.noticias || []);
let [NAPKINS, NEWS, ADS] = await Promise.all([
  fetch('napkins.json').then((r) => r.json()),
  getNews().catch(() => []),
  fetch('anuncios.json').then((r) => r.json()).catch(() => []),
]);
const deck = loadDeck();

// sin noticias nuevas, se vuelve a mirar si han llegado (como mucho una vez por minuto)
let lastRefresh = Date.now();
function refreshNews() {
  if (Date.now() - lastRefresh < 60000) return;
  lastRefresh = Date.now();
  getNews().then((n) => { if (n.length) NEWS = n; }).catch(() => {});
}
setInterval(refreshNews, 10 * 60000);

function nextNapkin() {
  state.count++;
  if (state.day !== today()) Object.assign(state, { day: today(), quotesToday: 0 });
  const fresh = NEWS.find((x) => !state.seen.includes(x.id));
  let item;
  if (!fresh) {
    refreshNews();
    item = { kind: 'empty', id: `vacio-${state.count}` };
  } else if (ADS.length && ++state.served % AD_EVERY === 0) {
    const ad = ADS[(state.served / AD_EVERY - 1) % ADS.length];
    item = { kind: 'ad', id: ad.id, ad };
  } else if (state.quotesToday < QUOTES_PER_DAY && state.last === 'news' && Math.random() < QUOTE_ODDS) {
    const quote = drawCard(NAPKINS, 0xC, state.quotes++);
    state.quotesToday++;
    item = { kind: 'quote', id: quote.id, quote };
  } else {
    item = { kind: 'news', id: fresh.id, news: fresh };
    state.seen = [...state.seen, fresh.id].slice(-600);
  }
  state.last = item.kind;
  saveState();
  return item;
}

// la solapa se rotula con la tipografía de la marca y el logo en tinta
const INK = '#4A6789';
const logoSvg = fetch('logo.svg').then((r) => r.text());
const logoIn = (color) => logoSvg.then(async (svg) => {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('currentColor', color))}`;
  await img.decode();
  return img;
}).catch(() => null);
const [inkLogo, paperLogo] = await Promise.all([
  logoIn(INK),
  logoIn('#F7F3EA'),
  document.fonts.load('italic 400 80px Fraunces').catch(() => {}),
  document.fonts.load("700 40px 'Bricolage Grotesque'").catch(() => {}),
]);

// ---------- Render ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
// estudio neutro (el inox se ve plata, no azul) con tiras de luz muy intensas.
// El metal necesita contraste (claros y oscuros) que reflejar, o parece plástico.
function studioEnv() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = vP.y * 0.5 + 0.5; vec3 c = mix(vec3(0.24, 0.25, 0.29), vec3(0.5, 0.51, 0.53), smoothstep(0.4, 0.5, h)); c = mix(c, vec3(1.15), smoothstep(0.6, 0.95, h)); gl_FragColor = vec4(c, 1.0); }',
    })
  ));
  const box = (w, h, x, y, z, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.material.color.setScalar(k);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  box(3, 44, -24, 6, 16, 9);    // tira alta, izquierda delante
  box(2, 36, 26, 4, 10, 6);     // tira derecha
  box(44, 5, 0, 30, 2, 4);      // techo
  box(12, 26, 12, 4, -28, 3);   // detrás
  box(26, 3, 0, 6, 30, 2.2);    // reflejo bajo en la cara
  box(6, 20, -30, 2, -12, 1.5);
  box(34, 30, -34, 10, 22, 1.6); // ventanal grande y suave: degradado en los laterales cepillados
  box(24, 22, 30, 6, 26, 0.9);
  return env;
}
scene.environment = pmrem.fromScene(studioEnv(), 0.02).texture;

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 200);
const target = new THREE.Vector3(0, TOP * 0.47, 0);

const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(-9, 22, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -16, right: 16, top: 18, bottom: -14, near: 1, far: 70 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.radius = 6;
scene.add(key);
scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe1fb, 0.75));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ color: 0x0c0e2e, opacity: 0.22 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------- Texturas ----------
function contactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.filter = 'blur(16px)';
  g.fillStyle = 'rgba(12,14,46,0.9)';
  g.fillRect(56, 56, 144, 144);
  return new THREE.CanvasTexture(c);
}

function fibers(g, w, h, n, alpha) {
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const a = Math.random() * Math.PI, l = 2 + Math.random() * (w / 120);
    g.strokeStyle = `rgba(120,108,85,${Math.random() * alpha})`;
    g.lineWidth = Math.random() * 1.2 + 0.3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
}

function grain(g, w, h, amount) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

const TEX_W = 1024, TEX_H = Math.round(1024 * NH / NW);
const FOLD_V = 0.36; // pliegue de la solapa, desde abajo (como en la imagen)

function canvasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function paperCanvas() {
  const c = document.createElement('canvas');
  c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext('2d');
  g.fillStyle = PAPER;
  g.fillRect(0, 0, TEX_W, TEX_H);
  fibers(g, TEX_W, TEX_H, 1600, 0.06);
  return { c, g };
}

// Cara de fuera, la que se ve en el servilletero: la solapa con el clásico rótulo de bar
function flapTexture() {
  const { c, g } = paperCanvas();
  const fy = TEX_H * (1 - FOLD_V);
  // canto de la solapa doblada
  g.fillStyle = 'rgba(90,80,60,0.16)';
  g.fillRect(0, fy - 3, TEX_W, 3);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillRect(0, fy, TEX_W, 2);
  const shade = g.createLinearGradient(0, fy, 0, fy + 40);
  shade.addColorStop(0, 'rgba(90,80,60,0.05)');
  shade.addColorStop(1, 'rgba(90,80,60,0)');
  g.fillStyle = shade;
  g.fillRect(0, fy + 2, TEX_W, 40);
  // rótulo
  const cy = fy + (TEX_H - fy) * 0.44;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = INK;
  g.globalAlpha = 0.9;
  g.filter = 'blur(0.4px)';
  g.font = `italic 400 ${Math.round(TEX_W * 0.082)}px Fraunces, Georgia, serif`;
  g.fillText('Gracias por su visita', TEX_W / 2, cy);
  const ly = cy + TEX_W * 0.09, lh = TEX_W * 0.04;
  const lw = inkLogo ? lh * inkLogo.naturalWidth / inkLogo.naturalHeight : 0;
  if (inkLogo) g.drawImage(inkLogo, TEX_W / 2 - lw / 2, ly - lh / 2, lw, lh);
  g.filter = 'none';
  g.globalAlpha = 1;
  grain(g, TEX_W, TEX_H, 7);
  return canvasTexture(c);
}

// Cara de dentro: papel en blanco (el retrato y la frase se ven al revelarla)
function blankTexture() {
  const { c, g } = paperCanvas();
  grain(g, TEX_W, TEX_H, 7);
  return canvasTexture(c);
}

// Acero cepillado: vetas horizontales finas (color y rugosidad)
function brushedTextures() {
  const n = 1024;
  const make = (base, spread, alpha) => {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.fillStyle = `rgb(${base},${base},${base})`;
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 5000; i++) {
      const v = base + (Math.random() - 0.5) * spread | 0;
      g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
      const y = Math.random() * n, len = n * (0.2 + Math.random() * 0.8);
      g.fillRect(Math.random() * n - len / 2, y, len, Math.random() * 1.6 + 0.4);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / 6, 1 / 6); // 6 cm por tesela (UV = cm)
    t.anisotropy = 16;
    return t;
  };
  const color = make(240, 26, 0.35);
  color.colorSpace = THREE.SRGBColorSpace;
  return { color, rough: make(200, 90, 0.5) };
}

// Relieve del papel: arrugas finas + los dos pliegues de la servilleta de bar
function paperNormalMap() {
  const w = 256, h = Math.round(256 * NH / NW);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, w, h);
  g.filter = 'blur(1.5px)';
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * w, y = Math.random() * h, a = Math.random() * Math.PI, l = 10 + Math.random() * 60;
    const v = Math.random() < 0.5 ? 150 : 100;
    g.strokeStyle = `rgba(${v},${v},${v},${0.15 + Math.random() * 0.35})`;
    g.lineWidth = 0.6 + Math.random() * 1.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.filter = 'blur(2px)';
  g.fillStyle = 'rgba(210,210,210,0.9)';
  g.fillRect(0, h * (1 - FOLD_V) - 1.5, w, 3);
  g.fillStyle = 'rgba(120,120,120,0.5)';
  g.fillRect(w / 2 - 1, 0, 2, h);
  g.filter = 'none';
  const src = g.getImageData(0, 0, w, h).data;
  const out = g.createImageData(w, h);
  const hgt = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * 3;
      const dy = (hgt(x, y + 1) - hgt(x, y - 1)) * 3;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      out.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return new THREE.CanvasTexture(c);
}

// Canto del taco: muchas hojas apiladas
function stackEdgeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = PAPER;
  g.fillRect(0, 0, 64, 256);
  for (let x = 0; x < 64; x += 2) {
    g.fillStyle = `rgba(110,100,80,${0.05 + Math.random() * 0.1})`;
    g.fillRect(x, 0, 1, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Materiales ----------
const brushed = brushedTextures();
const MATERIALS = {
  Inox: new THREE.MeshPhysicalMaterial({
    color: '#f6f7f9', map: brushed.color, metalness: 1, roughness: 0.27, roughnessMap: brushed.rough, envMapIntensity: 1.3,
    anisotropy: 0.8, anisotropyRotation: 0,
  }),
  Goma: new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.6 }),
};
const paperNormal = paperNormalMap();
const edgeTex = stackEdgeTexture();
const stackFront = new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.95, envMapIntensity: 0.35, emissive: '#ffffff', emissiveIntensity: 0.3 });
const stackEdge = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.95, emissive: '#ffffff', emissiveIntensity: 0.18 });
function paperMaterial(map, side) {
  return new THREE.MeshStandardMaterial({
    map, side, roughness: 0.88, envMapIntensity: 0.35,
    normalMap: paperNormal, normalScale: new THREE.Vector2(0.35, 0.35),
    emissive: '#ffffff', emissiveIntensity: 0.42, emissiveMap: map,
  });
}

// ---------- Servilletero ----------
const dispenser = new THREE.Group();
scene.add(dispenser);

// sombra de contacto
const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(W * 256 / 144, D * 256 / 144),
  new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.55 })
);
contact.rotation.x = -Math.PI / 2;
contact.position.y = 0.01;
dispenser.add(contact);

const pickables = [];
// hasta que llega el modelo se ve la silueta (.skeleton); luego entra la escena
const loaded = () => requestAnimationFrame(() => requestAnimationFrame(() => {
  document.body.classList.remove('loading');
  gsap.delayedCall(0.6, () => onboard.start());
}));
new GLTFLoader().load('models/servilletero.glb', (gltf) => {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = MATERIALS[o.material?.name] ?? MATERIALS.Inox;
    o.castShadow = o.receiveShadow = true;
    pickables.push(o);
  });
  dispenser.add(gltf.scene);
  loaded();
}, undefined, loaded);

// ---------- Servilleta: hoja de papel simulada ----------
// Rejilla de partículas (verlet) con distancias fijas: el papel se dobla pero no se estira.
// La parte de arriba queda pillada bajo el marco y solo desliza si se tira hacia abajo;
// la de abajo (la solapa) se suelta en cuanto se agarra.
const NX = 13, NY = 19;
const N = NX * NY;
const DX = NW / (NX - 1), DY = NH / (NY - 1);
const GRAVITY = -650;   // cm/s², el papel cae "frenado" por el aire
const DRAG = 0.992;
const ITER = 18;
const FREE = 0, HELD_TOP = 1, HELD_BOTTOM = 2, GRABBED = 3;

// El servilletero es macizo para el papel: por dentro solo se sale por la ventana,
// y por fuera solo se entra por ella. Si un punto acaba metido en la chapa, sale por
// la cara por la que venía. Devuelve si el punto queda dentro; la posición, en solid.out.
function solid(x, y, z, inside, px, py, pz) {
  const out = solid.out;
  const inWin = Math.abs(x) < WIN.x - 0.06 && y > WIN.bottom + 0.06 && y < WIN.top - 0.06;
  if (inside) {
    if (!inWin) z = Math.min(z, PLATE_IN - 0.02);
    x = THREE.MathUtils.clamp(x, -W / 2 + T + 0.05, W / 2 - T - 0.05);
    y = THREE.MathUtils.clamp(y, LIFT + T, N_TOP);
    z = Math.max(z, NAPKIN_Z);
    if (z > PLATE_OUT) inside = 0;          // ha salido por la ventana
  } else {
    const m = 0.04, bx = W / 2 + m, bt = TOP + m, bf = PLATE_OUT + m, bb = -D / 2 - m;
    if (Math.abs(x) < bx && y < bt && z < bf && z > bb) {
      if (inWin && z > PLATE_IN - 0.02) {
        if (z < (PLATE_IN + PLATE_OUT) / 2) inside = 1;  // entra por la ventana
      } else {
        const pen = [bx - x, x + bx, bt - y, bf - z, z - bb];
        const came = [px >= bx, px <= -bx, py >= bt, pz >= bf, pz <= bb];
        let best = -1;
        for (let k = 0; k < 5; k++) if (came[k] && (best < 0 || pen[k] < pen[best])) best = k;
        if (best < 0) for (let k = 0; k < 5; k++) if (best < 0 || pen[k] < pen[best]) best = k;
        if (best === 0) x = bx; else if (best === 1) x = -bx; else if (best === 2) y = bt; else if (best === 3) z = bf; else z = bb;
      }
    }
  }
  out[0] = x; out[1] = y; out[2] = z;
  return inside;
}
solid.out = new Float32Array(3);

class Sheet {
  constructor() {
    this.pos = new Float32Array(N * 3);
    this.prev = new Float32Array(N * 3);
    this.rest = new Float32Array(N * 3);
    this.mode = new Uint8Array(N);
    this.inside = new Uint8Array(N);   // 1 = dentro del servilletero
    this.offset = new Float32Array(N * 3);
    const c = [];
    const idx = (ix, iy) => iy * NX + ix;
    const link = (a, b, k) => c.push(a, b, k);
    for (let iy = 0; iy < NY; iy++) {
      for (let ix = 0; ix < NX; ix++) {
        const i = idx(ix, iy);
        this.rest.set([-NW / 2 + ix * DX, N_TOP - iy * DY, NAPKIN_Z], i * 3);
        if (ix < NX - 1) link(i, idx(ix + 1, iy), 1);
        if (iy < NY - 1) link(i, idx(ix, iy + 1), 1);
        if (ix < NX - 1 && iy < NY - 1) { link(i, idx(ix + 1, iy + 1), 0.9); link(idx(ix + 1, iy), idx(ix, iy + 1), 0.9); }
        // rigidez a flexión y a torsión: el papel se curva en arcos amplios, no se arruga como la tela
        if (ix < NX - 2) link(i, idx(ix + 2, iy), 1);
        if (iy < NY - 2) link(i, idx(ix, iy + 2), 1);
        if (ix < NX - 2 && iy < NY - 2) { link(i, idx(ix + 2, iy + 2), 0.7); link(idx(ix + 2, iy), idx(ix, iy + 2), 0.7); }
        if (ix < NX - 4) link(i, idx(ix + 4, iy), 0.45);
        if (iy < NY - 4) link(i, idx(ix, iy + 4), 0.45);
      }
    }
    this.obstacles = [];
    this.pairs = Int32Array.from(c.filter((_, j) => j % 3 !== 2));
    this.stiff = Float32Array.from(c.filter((_, j) => j % 3 === 2));
    this.len = new Float32Array(this.stiff.length);
    for (let k = 0; k < this.len.length; k++) {
      const a = this.pairs[k * 2] * 3, b = this.pairs[k * 2 + 1] * 3;
      this.len[k] = Math.hypot(this.rest[a] - this.rest[b], this.rest[a + 1] - this.rest[b + 1]);
    }
    this.reset();
  }

  reset() {
    this.pos.set(this.rest);
    this.prev.set(this.rest);
    this.slide = 0;
    this.grabTarget = null;
    this.inside.fill(1);
    for (let i = 0; i < N; i++) {
      const y = this.rest[i * 3 + 1];
      this.mode[i] = y > WIN.top ? HELD_TOP : y < WIN.bottom ? HELD_BOTTOM : FREE;
    }
  }

  get heldTop() {
    for (let i = 0; i < N; i++) if (this.mode[i] === HELD_TOP) return true;
    return false;
  }

  // Abre la solapa y pellizca las partículas cercanas a (x, y)
  grab(x, y) {
    for (let i = 0; i < N; i++) if (this.mode[i] === HELD_BOTTOM) this.mode[i] = FREE;
    let best = 0, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (this.mode[i] !== FREE) continue;
      const d = Math.hypot(this.pos[i * 3] - x, this.pos[i * 3 + 1] - y);
      if (d < bd) { bd = d; best = i; }
    }
    const cx = this.pos[best * 3], cy = this.pos[best * 3 + 1], cz = this.pos[best * 3 + 2];
    this.grabRestY = this.rest[best * 3 + 1];
    this.grabbed = [];
    // los dedos pellizcan una línea del papel: el resto puede girar alrededor
    const row = (best / NX) | 0;
    for (let i = row * NX; i < (row + 1) * NX; i++) {
      if (this.mode[i] !== FREE) continue;
      const ox = this.pos[i * 3] - cx, oy = this.pos[i * 3 + 1] - cy;
      if (Math.abs(ox) > 1.6) continue;
      this.mode[i] = GRABBED;
      this.offset.set([ox, oy, this.pos[i * 3 + 2] - cz], i * 3);
      this.grabbed.push(i);
    }
    this.grabTarget = new THREE.Vector3(cx, cy, cz);
  }

  release() {
    for (const i of this.grabbed || []) this.mode[i] = FREE;
    this.grabbed = [];
    this.grabTarget = null;
  }

  // Tirar hacia abajo saca lo que estaba pillado bajo el marco de arriba;
  // hacia arriba solo llega hasta donde da el papel que ya está fuera.
  pull(t) {
    const hinge = new THREE.Vector3(t.x, WIN.top, PLATE_OUT);
    const dist = t.distanceTo(hinge);
    const base = WIN.top - this.grabRestY;
    if (t.y < WIN.top) this.slide = Math.max(this.slide, dist * 0.97 - base);
    const hidden = Math.max(0, N_TOP - this.slide - WIN.top);
    const reach = N_TOP - this.grabRestY - hidden + 0.3;
    if (dist > reach) t.copy(hinge.add(t.clone().sub(hinge).setLength(reach)));
    t.y = Math.max(t.y, 0.3);
    return t;
  }

  step(dt, pressure) {
    const p = this.pos, q = this.prev;
    const g = GRAVITY * dt * dt;
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      const m = this.mode[i];
      if (m === FREE) {
        const vx = (p[j] - q[j]) * DRAG, vy = (p[j + 1] - q[j + 1]) * DRAG, vz = (p[j + 2] - q[j + 2]) * DRAG;
        q[j] = p[j]; q[j + 1] = p[j + 1]; q[j + 2] = p[j + 2];
        p[j] += vx;
        p[j + 1] += vy + g;
        // el muelle del servilletero aprieta lo que sigue dentro contra el taco
        p[j + 2] += vz - (this.inside[i] ? pressure * dt * dt : 0);
      } else {
        q[j] = p[j]; q[j + 1] = p[j + 1]; q[j + 2] = p[j + 2];
        if (m === HELD_TOP) {
          p[j] = this.rest[j]; p[j + 1] = this.rest[j + 1] - this.slide; p[j + 2] = NAPKIN_Z;
        } else if (m === HELD_BOTTOM) {
          p[j] = this.rest[j]; p[j + 1] = this.rest[j + 1]; p[j + 2] = NAPKIN_Z;
        } else if (this.grabTarget) {
          p[j] = this.grabTarget.x + this.offset[j];
          p[j + 1] = this.grabTarget.y + this.offset[j + 1];
          p[j + 2] = this.grabTarget.z + this.offset[j + 2];
        }
      }
    }

    const { pairs, len, stiff, mode } = this;
    for (let it = 0; it < ITER; it++) {
      for (let k = 0; k < len.length; k++) {
        const a = pairs[k * 2], b = pairs[k * 2 + 1];
        const fa = mode[a] === FREE, fb = mode[b] === FREE;
        if (!fa && !fb) continue;
        const ja = a * 3, jb = b * 3;
        const dx = p[jb] - p[ja], dy = p[jb + 1] - p[ja + 1], dz = p[jb + 2] - p[ja + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = (d - len[k]) / d;
        const s = stiff[k];
        const wa = fa ? (fb ? 0.5 : 1) : 0, wb = fb ? (fa ? 0.5 : 1) : 0;
        p[ja] += dx * diff * s * wa; p[ja + 1] += dy * diff * s * wa; p[ja + 2] += dz * diff * s * wa;
        p[jb] -= dx * diff * s * wb; p[jb + 1] -= dy * diff * s * wb; p[jb + 2] -= dz * diff * s * wb;
      }
      this.collide();
      if (it === ITER - 4) this.selfCollide();
    }

    for (let i = 0; i < N; i++) {
      if (this.mode[i] === HELD_TOP && this.rest[i * 3 + 1] - this.slide < WIN.top - 0.05) {
        this.mode[i] = FREE;
      }
    }
  }

  // Al doblarse, una capa de papel no atraviesa la otra
  selfCollide() {
    const p = this.pos, R = 0.3, cell = 0.5;
    const grid = new Map();
    const cellKey = (x, y, z) => ((x + 64) * 256 + (y + 64)) * 256 + (z + 64);
    for (let i = 0; i < N; i++) {
      const k = cellKey(Math.floor(p[i * 3] / cell), Math.floor(p[i * 3 + 1] / cell), Math.floor(p[i * 3 + 2] / cell));
      const list = grid.get(k);
      if (list) list.push(i); else grid.set(k, [i]);
    }
    for (let i = 0; i < N; i++) {
      const ix = i % NX, iy = (i / NX) | 0;
      const cx = Math.floor(p[i * 3] / cell), cy = Math.floor(p[i * 3 + 1] / cell), cz = Math.floor(p[i * 3 + 2] / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const list = grid.get(cellKey(cx + a, cy + b, cz + c));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const jx = j % NX, jy = (j / NX) | 0;
          if (Math.abs(ix - jx) + Math.abs(iy - jy) < 3) continue;
          const dx = p[j * 3] - p[i * 3], dy = p[j * 3 + 1] - p[i * 3 + 1], dz = p[j * 3 + 2] - p[i * 3 + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= R * R || d2 < 1e-10) continue;
          const d = Math.sqrt(d2), push = (R - d) / d * 0.5;
          const fi = this.mode[i] === FREE, fj = this.mode[j] === FREE;
          const wi = fi ? (fj ? 1 : 2) : 0, wj = fj ? (fi ? 1 : 2) : 0;
          p[i * 3] -= dx * push * wi; p[i * 3 + 1] -= dy * push * wi; p[i * 3 + 2] -= dz * push * wi;
          p[j * 3] += dx * push * wj; p[j * 3 + 1] += dy * push * wj; p[j * 3 + 2] += dz * push * wj;
        }
      }
    }
  }

  collide() {
    const p = this.pos, q = this.prev, out = solid.out;
    for (let i = 0; i < N; i++) {
      if (this.mode[i] !== FREE) continue;
      const j = i * 3;
      this.inside[i] = solid(p[j], p[j + 1], p[j + 2], this.inside[i], q[j], q[j + 1], q[j + 2]);
      let x = out[0], y = out[1], z = out[2];
      // las bolas del suelo tampoco se atraviesan
      for (const o of this.obstacles) {
        const dx = x - o.x, dy = y - o.y, dz = z - o.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= o.r2 || d2 < 1e-8) continue;
        const k = o.r / Math.sqrt(d2);
        x = o.x + dx * k; y = o.y + dy * k; z = o.z + dz * k;
      }
      p[j] = x; p[j + 1] = Math.max(y, 0.03); p[j + 2] = z;
    }
  }
}

// ---------- Caras ----------
const faces = {};
const flapTex = flapTexture(), blankTex = blankTexture();
const stackGeo = new THREE.BoxGeometry(NW, NH, NAPKIN_Z - 0.06);
stackGeo.translate(0, N_BOTTOM + NH / 2, (NAPKIN_Z - 0.06) / 2 + 0.03);

for (const [id, s] of [['A', 1], ['B', -1]]) {
  const group = new THREE.Group();
  group.rotation.y = s > 0 ? 0 : Math.PI;
  dispenser.add(group);

  const stack = new THREE.Mesh(stackGeo, [stackEdge, stackEdge, stackEdge, stackEdge, stackFront, stackFront]);
  stack.receiveShadow = true;
  group.add(stack);

  const sheet = new Sheet();
  const geo = new THREE.PlaneGeometry(NW, NH, NX - 1, NY - 1);
  geo.attributes.position.array.set(sheet.pos);
  const front = new THREE.Mesh(geo, paperMaterial(flapTex, THREE.FrontSide));
  const back = new THREE.Mesh(geo, paperMaterial(blankTex, THREE.BackSide));
  for (const m of [front, back]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }

  faces[id] = { id, s, group, stack, sheet, geo, front, back, settled: true };
}

function syncGeometry(face) {
  face.geo.attributes.position.array.set(face.sheet.pos);
  face.geo.attributes.position.needsUpdate = true;
  face.geo.computeVertexNormals();
  face.geo.computeBoundingSphere();
}

// ---------- Cámara ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const distV = (TOP * 2.1) / 2 / Math.tan(half);
  const distH = (W * 2.2) / 2 / (Math.tan(half) * camera.aspect);
  const dist = Math.max(distV, distH);
  const el = THREE.MathUtils.degToRad(13);
  camera.position.set(0, target.y + Math.sin(el) * dist, Math.cos(el) * dist);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
let rot = BASE_ROT, rotTarget = BASE_ROT, parallax = 0;
let drag = null, busy = false;

function facingFace() {
  const toCam = camera.position.clone().sub(target).setY(0).normalize();
  const nA = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
  return nA.dot(toCam) >= 0 ? faces.A : faces.B;
}

function updateUI() {
  // la pista se va cuando ya se ha pillado el gesto
  $('hint').classList.toggle('gone', state.count >= 3 || !!drag || busy);
  $('sound').setAttribute('aria-pressed', String(sound.isOn()));
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setRay(e) {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}
function pick(e) {
  setRay(e);
  const face = facingFace();
  if (!face.front.visible) return null;
  const hits = raycaster.intersectObjects([face.front, face.back, face.stack, ...pickables], false);
  const hit = hits[0];
  if (hit && (hit.object === face.front || hit.object === face.back || hit.object === face.stack)) return { face, point: hit.point };
  return null;
}

// Punto bajo el dedo en un plano paralelo a la ventana, a `z` delante (coords de la cara)
const plane = new THREE.Plane();
function pointerOnPlane(face, z) {
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(face.group.getWorldQuaternion(new THREE.Quaternion()));
  const p0 = face.group.localToWorld(new THREE.Vector3(0, 0, z));
  plane.setFromNormalAndCoplanarPoint(n, p0);
  const out = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, out)) return null;
  return face.group.worldToLocal(out);
}

// el audio se desbloquea con el primer gesto, antes que nada más
for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, sound.unlock, { capture: true, passive: true });

canvas.addEventListener('pointerdown', (e) => {
  if (busy) return;
  const hit = pick(e);
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  if (hit) {
    const local = hit.face.group.worldToLocal(hit.point.clone());
    gsap.killTweensOf(hit.face);
    hit.face.sheet.grab(local.x, local.y);
    hit.face.settled = false;
    sound.grab();
    sound.rubStart();
    onboard.grabbed();
    drag = { mode: 'pull', face: hit.face, sx: e.clientX, sy: e.clientY, z0: hit.face.sheet.grabTarget.z, out: 0, last: null, inside: 1 };
    canvas.style.cursor = 'grabbing';
  } else {
    drag = { mode: 'rotate', lastX: e.clientX };
  }
  updateUI();
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (e.pointerType === 'mouse') {
      canvas.style.cursor = !busy && pick(e) ? 'grab' : 'default';
      parallax = ((e.clientX / window.innerWidth) - 0.5) * 0.1;
    }
    return;
  }
  if (drag.mode === 'rotate') {
    rot += (e.clientX - drag.lastX) * 0.008;
    rotTarget = rot;
    drag.lastX = e.clientX;
    updateUI();
    return;
  }
  // al empezar a tirar, la solapa se despega y viene hacia ti
  const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
  drag.out = Math.max(drag.out, Math.min(1, moved / 40));
  setRay(e);
  const z = drag.z0 + (PLATE_OUT + 1.4 - drag.z0) * drag.out;
  const p = pointerOnPlane(drag.face, z);
  const sheet = drag.face.sheet;
  if (p && sheet.grabTarget) {
    const t = sheet.pull(p), o = sheet.grabTarget;
    drag.inside = solid(t.x, t.y, t.z, drag.inside, o.x, o.y, o.z);
    o.fromArray(solid.out);
  }
});

function endDrag() {
  if (!drag) return;
  if (drag.mode === 'rotate') {
    rotTarget = BASE_ROT + Math.round((rot - BASE_ROT) / Math.PI) * Math.PI;
  } else if (!busy) {
    // se suelta a medias: el papel cae y vuelve a meterse en el servilletero
    sound.rubStop();
    const face = drag.face;
    face.sheet.release();
    gsap.delayedCall(0.45, () => tuckBack(face));
    onboard.released();
  }
  drag = null;
  canvas.style.cursor = 'default';
  updateUI();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function tuckBack(face) {
  if (drag && drag.face === face) return;
  const sheet = face.sheet;
  const from = Float32Array.from(sheet.pos);
  const slide0 = sheet.slide;
  const o = { t: 0 };
  face.tween = gsap.to(o, {
    t: 1, duration: 0.7, ease: 'power2.inOut',
    onStart: () => { sheet.mode.fill(GRABBED); sheet.grabTarget = null; sound.tuck(); },
    onUpdate: () => {
      for (let i = 0; i < N * 3; i++) sheet.pos[i] = from[i] + (sheet.rest[i] - from[i]) * o.t;
      sheet.prev.set(sheet.pos);
      sheet.slide = slide0 * (1 - o.t);
    },
    onComplete: () => { sheet.reset(); face.settled = true; },
  });
}

function extract(face) {
  busy = true;
  const item = nextNapkin();
  sound.pull();
  if (navigator.vibrate) navigator.vibrate(18);
  updateUI();
  // la servilleta cuelga un momento de los dedos y se la lleva la cámara
  gsap.delayedCall(0.45, () => {
    face.sheet.release();
    if (drag && drag.face === face) drag = null;
    for (const m of [face.front, face.back]) {
      m.material.transparent = true;
      gsap.to(m.material, { opacity: 0, duration: 0.25, delay: 0.1, onComplete: () => refill(face) });
    }
    showReveal(item);
  });
}

// el muelle coloca la siguiente servilleta en la ventana: el taco no se acaba nunca
function refill(face) {
  // si alguien ya la estaba agarrando (cerró muy rápido), el muelle gana: se suelta
  if (drag?.face === face) { drag = null; sound.rubStop(); }
  face.sheet.reset();
  syncGeometry(face);
  face.settled = true;
  for (const m of [face.front, face.back]) {
    m.material.opacity = 1;
    m.material.transparent = false;
  }
}

function turn() {
  if (busy) return;
  rotTarget = BASE_ROT + (Math.round((rotTarget - BASE_ROT) / Math.PI) + 1) * Math.PI;
}
$('turn').addEventListener('click', turn);

// ---------- Bolas en el suelo ----------
// Al cerrar la servilleta se arruga en una bola y se tira al suelo, como en la barra de un bar.
// Las bolas ruedan, chocan entre ellas, con el servilletero y con el papel que cuelga,
// y se quedan ahí hasta el día siguiente. No se pueden coger: el rayo de pick() solo mira
// el servilletero, así que nunca estorban.
const BALL_R = 1.15;
const BALL_G = 700;          // cm/s²: el papel cae algo frenado
const MAX_BALLS = 24;
const FLOOR_KEY = 'cafecita.suelo.v1';
const balls = [];
const UP = new THREE.Vector3(0, 1, 0);
const blankBallMat = paperMaterial(blankTex, THREE.DoubleSide);

// a dónde cae cada punto de la hoja al hacerla una bola: el centro delante, los bordes detrás,
// con abolladuras de baja frecuencia para que no sea una esfera perfecta
function crumpleTargets(rest, seed) {
  const rnd = prng(seed);
  const n = rest.length / 3;
  let maxR = 0;
  for (let i = 0; i < n; i++) maxR = Math.max(maxR, Math.hypot(rest[i * 3], rest[i * 3 + 1]));
  const k = [rnd() * 6, rnd() * 6, 1.5 + rnd() * 2, 1.5 + rnd() * 2];
  const out = new Float32Array(rest.length), rr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1];
    rr[i] = Math.hypot(x, y) / maxR;
    const wob = Math.sin(x * k[2] + k[0]) * Math.sin(y * k[3] + k[1]);
    const a = Math.atan2(y, x) + wob * 0.5, th = rr[i] * Math.PI * 0.97;
    const r = BALL_R * (0.8 + 0.2 * wob + 0.16 * (rnd() - 0.5));
    out.set([r * Math.sin(th) * Math.cos(a), r * Math.sin(th) * Math.sin(a), r * Math.cos(th)], i * 3);
  }
  return { out, rr };
}

function addBall(mesh, v, w) {
  // choca con lo que de verdad mide la bola, no con una esfera de compromiso
  const a = mesh.geometry.attributes.position.array;
  let r = 0;
  for (let i = 0; i < a.length; i += 3) r = Math.max(r, Math.hypot(a[i], a[i + 1], a[i + 2]));
  const b = { mesh, v, w, r: r * 0.95, asleep: false, ground: false };
  balls.push(b);
  // el suelo no se llena del todo: la más vieja se desvanece
  while (balls.length > MAX_BALLS) {
    const old = balls.shift();
    gsap.to(old.mesh.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.4, onComplete: () => disposeBall(old.mesh) });
  }
  return b;
}

function disposeBall(mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
  if (mesh.material !== blankBallMat) { mesh.material.map?.dispose(); mesh.material.dispose(); }
}

function saveFloor() {
  const list = balls.filter((b) => b.asleep).map((b) => ({
    s: b.mesh.userData.seed,
    p: b.mesh.position.toArray().map((x) => +x.toFixed(2)),
    q: b.mesh.quaternion.toArray().map((x) => +x.toFixed(3)),
  }));
  try { localStorage.setItem(FLOOR_KEY, JSON.stringify({ day: today(), balls: list })); } catch {}
}

// las bolas de hoy siguen en el suelo al volver (se ven en blanco: el papel arrugado no deja leer nada)
function restoreFloor() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(FLOOR_KEY)); } catch {}
  if (!saved || saved.day !== today() || !Array.isArray(saved.balls)) return;
  for (const { s: seed, p, q } of saved.balls.slice(-MAX_BALLS)) {
    if (!Number.isInteger(seed) || p?.length !== 3 || q?.length !== 4) continue;
    const geo = new THREE.PlaneGeometry(5.7, 8.2, 18, 26);
    geo.attributes.position.array.set(crumpleTargets(geo.attributes.position.array, seed).out);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, blankBallMat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.seed = seed;
    mesh.position.fromArray(p);
    mesh.position.x = THREE.MathUtils.clamp(mesh.position.x, -8.5, 8.5);
    mesh.position.z = THREE.MathUtils.clamp(mesh.position.z, -10, 8);
    mesh.quaternion.fromArray(q).normalize();
    scene.add(mesh);
    // despierta: si se guardó metida en otra o en el servilletero, la física la saca
    addBall(mesh, new THREE.Vector3(), new THREE.Vector3());
  }
}

// ---------- Arrugar ----------
// La servilleta que se estaba leyendo pasa a la escena 3D justo donde se veía en pantalla.
// paper.t va de hoja lisa (0) a bola (1); k son las arrugas de ir arrastrándola (0…1).
function paperFromCard(el) {
  const nw = el.naturalWidth || el.width, nh = el.naturalHeight || el.height;
  if (!nw || !nh) return null;
  // tamaño de lo pintado dentro de la caja (object-fit: contain)
  const r = el.getBoundingClientRect(), bw = el.offsetWidth, bh = el.offsetHeight;
  const fitW = Math.min(bw, bh * nw / nh), fitH = fitW * nh / nw;
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = Math.round(384 * nh / nw);
  c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
  const tex = canvasTexture(c);

  const dist = 25, perPx = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / window.innerHeight;
  const geo = new THREE.PlaneGeometry(fitW * perPx, fitH * perPx, 18, 26);
  const rest = Float32Array.from(geo.attributes.position.array);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] | 0;
  const { out: target, rr } = crumpleTargets(rest, seed);
  const mat = paperMaterial(tex, THREE.DoubleSide);
  mat.alphaTest = 0.5;
  // menos brillo propio que el papel del servilletero: así se ven las sombras de las arrugas
  mat.emissiveIntensity = 0.2;
  mat.normalScale.set(0.6, 0.6);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.seed = seed;
  ndc.set(((r.left + r.width / 2) / window.innerWidth) * 2 - 1, -((r.top + r.height / 2) / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  mesh.position.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, dist / raycaster.ray.direction.dot(fwd));
  mesh.quaternion.copy(camera.quaternion);
  mesh.rotateZ(THREE.MathUtils.degToRad(-1.5));
  scene.add(mesh);
  return {
    mesh, geo, rest, target, rr, seed, perPx, t: 0, k: 0,
    size: Math.max(fitW, fitH) * perPx,
    base: mesh.position.clone(), baseQ: mesh.quaternion.clone(),
  };
}

function setCrumple(paper, t, k) {
  const { geo, rest, target, rr, size, seed } = paper;
  paper.t = t;
  paper.k = k;
  const pos = geo.attributes.position.array;
  const squeeze = 1 - 0.12 * k;
  for (let i = 0; i < rr.length; i++) {
    // los bordes se doblan antes que el centro; mientras se aprieta, el papel se ondula
    const ti = THREE.MathUtils.clamp(t * 1.3 - rr[i] * 0.3, 0, 1);
    const e = ti * ti * (3 - 2 * ti);
    const j = i * 3, x = rest[j], y = rest[j + 1];
    const wave = Math.sin(e * Math.PI) * size * 0.05 * Math.sin(x * 1.7 + y * 2.3 + seed);
    // arrugas de arrastrar: crestas cruzadas, más marcadas hacia los bordes
    const ridge = k * size * 0.065 * (0.4 + rr[i]) *
      (Math.sin(x * 2.1 + seed) * Math.cos(y * 1.7 - seed) + 0.6 * Math.abs(Math.sin(x * 4.3 - y * 3.1 + seed * 2)) - 0.3);
    pos[j] = (x + (target[j] - x) * e) * (e < 1 ? squeeze : 1);
    pos[j + 1] = (y + (target[j + 1] - y) * e) * (e < 1 ? squeeze : 1);
    pos[j + 2] = rest[j + 2] + (target[j + 2] - rest[j + 2]) * e + wave + ridge * (1 - e);
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

// de donde esté (lisa o a medio arrugar) hasta bola, y al suelo
function finishCrumple(paper) {
  const left = 1 - paper.t;
  sound.crumple(0.6 * left);
  const o = { t: paper.t, k: paper.k };
  gsap.to(o, {
    t: 1, k: 0, duration: 0.6 * left + 0.05, ease: 'none',
    onUpdate: () => { setCrumple(paper, o.t, o.k); paper.mesh.rotateZ(0.012); },
    onComplete: () => throwBall(paper.mesh),
  });
}

// tiro con parábola hasta un hueco del suelo, a izquierda o derecha (nunca delante de la ventana)
function throwBall(mesh) {
  const side = Math.random() < 0.5 ? -1 : 1;
  const land = new THREE.Vector3(side * (5.8 + Math.random() * 1.8), BALL_R, -3 + Math.random() * 8);
  mesh.position.y = Math.max(mesh.position.y, BALL_R + 2);
  const tau = THREE.MathUtils.clamp(mesh.position.distanceTo(land) / 55, 0.45, 0.8);
  const v = land.clone().sub(mesh.position).addScaledVector(UP, 0.5 * BALL_G * tau * tau).divideScalar(tau);
  const w = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).setLength(8 + Math.random() * 8);
  addBall(mesh, v, w);
  sound.toss();
}

function crumpleAndThrow(el) {
  const paper = paperFromCard(el);
  if (paper) finishCrumple(paper);
}

// ---------- Física de las bolas ----------
// choque con el servilletero: una caja maciza que gira con él
const local = new THREE.Vector3(), closest = new THREE.Vector3(), lv = new THREE.Vector3(), nrm = new THREE.Vector3();
function hitDispenser(b) {
  const ry = dispenser.rotation.y;
  local.copy(b.mesh.position).applyAxisAngle(UP, -ry);
  closest.set(
    THREE.MathUtils.clamp(local.x, -W / 2, W / 2),
    THREE.MathUtils.clamp(local.y, 0, TOP),
    THREE.MathUtils.clamp(local.z, -D / 2 - 0.03, D / 2 + 0.03),
  );
  nrm.subVectors(local, closest);
  const d = nrm.length();
  if (d >= b.r) return false;
  if (d < 1e-4) {
    // el centro ya está dentro: sale por la cara más cercana
    const px = W / 2 - Math.abs(local.x), pz = D / 2 - Math.abs(local.z), py = TOP - local.y;
    if (py < px && py < pz) nrm.set(0, 1, 0);
    else if (px < pz) nrm.set(Math.sign(local.x) || 1, 0, 0);
    else nrm.set(0, 0, Math.sign(local.z) || 1);
    local.copy(closest).addScaledVector(nrm, b.r);
  } else {
    nrm.divideScalar(d);
    local.addScaledVector(nrm, b.r - d);
  }
  b.mesh.position.copy(local.applyAxisAngle(UP, ry));
  lv.copy(b.v).applyAxisAngle(UP, -ry);
  const vn = lv.dot(nrm);
  if (vn < 0) lv.addScaledVector(nrm, -1.3 * vn);
  b.v.copy(lv.applyAxisAngle(UP, ry));
  return true;
}

// el punto más bajo de la bola tal como está girada: apoya en el suelo por ahí, sin hundirse
const tmpV = new THREE.Vector3();
function lowest(b) {
  const a = b.mesh.geometry.attributes.position.array, q = b.mesh.quaternion;
  let min = Infinity;
  for (let i = 0; i < a.length; i += 9) min = Math.min(min, tmpV.set(a[i], a[i + 1], a[i + 2]).applyQuaternion(q).y);
  return min;
}

// el papel que cuelga del servilletero también es sólido para las bolas
function hitSheets(b) {
  for (const f of Object.values(faces)) {
    if (f.settled || !f.front.visible) continue;
    const c = f.group.worldToLocal(tmpV.copy(b.mesh.position));
    const p = f.sheet.pos;
    for (let i = 0; i < N; i += 2) {
      const dx = c.x - p[i * 3], dy = c.y - p[i * 3 + 1], dz = c.z - p[i * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= b.r * b.r || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), s = (b.r - d) / d;
      c.x += dx * s; c.y += dy * s; c.z += dz * s;
      b.asleep = false;
    }
    b.mesh.position.copy(f.group.localToWorld(c));
  }
}

const dq = new THREE.Quaternion(), axis = new THREE.Vector3(), sep = new THREE.Vector3();
function stepBalls(dt) {
  let slept = false;
  for (const b of balls) {
    if (b.asleep) {
      // si el servilletero gira encima de una bola, la empuja
      if (hitDispenser(b)) b.asleep = false;
      continue;
    }
    const p = b.mesh.position;
    b.v.y -= BALL_G * dt;
    p.addScaledVector(b.v, dt);
    b.ground = false;
    const low = lowest(b);
    if (p.y + low < 0) {
      p.y = -low;
      if (b.v.y < -60) {
        sound.thud(-b.v.y);
        // el papel arrugado no rebota ni rueda mucho: cada bote se come casi todo el impulso
        b.v.x *= 0.35; b.v.z *= 0.35;
      }
      b.v.y = b.v.y < -40 ? -b.v.y * 0.3 : 0;
      b.ground = true;
    }
    if (b.ground) {
      // rueda frenando por el roce del papel
      const k = Math.exp(-7 * dt);
      b.v.x *= k; b.v.z *= k;
      b.w.set(b.v.z, 0, -b.v.x).divideScalar(b.r);
    }
    hitDispenser(b);
    hitSheets(b);
    // que no se salgan de lo que se ve
    if (Math.abs(p.x) > 8.5) { p.x = Math.sign(p.x) * 8.5; b.v.x *= -0.3; }
    if (p.z < -10 || p.z > 8) { p.z = THREE.MathUtils.clamp(p.z, -10, 8); b.v.z *= -0.3; }
    const wl = b.w.length();
    if (wl > 1e-3) b.mesh.quaternion.premultiply(dq.setFromAxisAngle(axis.copy(b.w).divideScalar(wl), wl * dt));
    if (b.ground && b.v.lengthSq() < 2) { b.asleep = true; b.v.set(0, 0, 0); slept = true; }
  }
  // bola contra bola: no se meten una en otra
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], b = balls[j];
      if (a.asleep && b.asleep) continue;
      sep.subVectors(b.mesh.position, a.mesh.position);
      const d = sep.length(), min = a.r + b.r;
      if (d >= min || d < 1e-4) continue;
      sep.divideScalar(d);
      // la que está quieta pesa más: la que llega es la que se aparta
      const wa = a.asleep ? 0.2 : 0.5, wb = b.asleep ? 0.2 : 0.5, sum = wa + wb;
      a.mesh.position.addScaledVector(sep, -(min - d) * wa / sum);
      b.mesh.position.addScaledVector(sep, (min - d) * wb / sum);
      const rel = b.v.dot(sep) - a.v.dot(sep);
      if (rel < 0) { a.v.addScaledVector(sep, rel * 0.6); b.v.addScaledVector(sep, -rel * 0.6); }
      a.asleep = b.asleep = false;
    }
  }
  if (slept) saveFloor();
}
restoreFloor();

// ---------- Revelado ----------
const reveal = $('reveal');
const napkinImg = $('napkinImg');
const napkinCanvas = $('napkinCanvas');
const source = $('source');
let current = null; // la servilleta que hay en la mesa
let shareFile = null;

// adónde lleva el botón: la noticia en la web del periódico, o la del anunciante
function linkFor(item) {
  if (item.kind === 'news') return { href: item.news.url, text: `Leer en ${item.news.fuente}`, rel: 'noopener' };
  if (item.kind === 'ad' && item.ad.url) return { href: item.ad.url, text: item.ad.cta || item.ad.marca, rel: 'sponsored noopener' };
  return null;
}

const LABEL = {
  news: (i) => `${i.news.titular} — ${i.news.fuente}`,
  ad: (i) => `Publicidad: ${i.ad.texto} — ${i.ad.marca}`,
  empty: () => 'Espere a que el personal reponga las servilletas. Gracias por su paciencia.',
};

async function showReveal(item) {
  current = item;
  gsap.killTweensOf(['#revealBg', '.actions', '#close', '#napkinCard']);
  reveal.classList.remove('leaving');
  if (item.kind === 'quote') {
    napkinImg.src = item.quote.napkin;
    napkinImg.alt = `“${item.quote.quote}” — ${item.quote.author}`;
    try { await napkinImg.decode(); } catch {}
  } else {
    await paintNapkin(napkinCanvas, item, { logo: inkLogo });
    napkinCanvas.setAttribute('aria-label', LABEL[item.kind](item));
  }
  napkinImg.hidden = item.kind !== 'quote';
  napkinCanvas.hidden = item.kind === 'quote';
  const link = linkFor(item);
  source.hidden = !link;
  if (link) {
    source.href = link.href;
    source.rel = link.rel;
    $('sourceLabel').textContent = link.text;
  }
  // la imagen para compartir se prepara ya: en iPhone, navigator.share tiene que ir pegado al toque
  shareFile = null;
  storyBlob(item).then((blob) => { if (current === item) shareFile = new File([blob], fileName(item), { type: 'image/jpeg' }); });

  reveal.hidden = false;
  gsap.fromTo('#revealBg', { opacity: 0 }, { opacity: 1, duration: 0.4 });
  gsap.fromTo('#napkinCard',
    { opacity: 0, scale: 0.6, rotateX: 40, rotateZ: 8, x: 0, y: 120 },
    { opacity: 1, scale: 1, rotateX: 0, rotateZ: -1.5, y: 0, duration: 0.9, ease: 'back.out(1.2)' });
  gsap.fromTo(['.actions', '#close'], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, delay: 0.5 });
  onboard.revealed();
}

// Al salir, la servilleta se arruga y va al suelo. Ya se puede sacar otra desde el primer instante.
// paper: la servilleta 3D si ya se estaba arrastrando (y arrugando) con el dedo.
function hideReveal(paper = null) {
  if (reveal.hidden || reveal.classList.contains('leaving')) return;
  reveal.classList.add('leaving');
  busy = false;
  updateUI();
  gsap.killTweensOf('#napkinCard');
  gsap.set('#napkinCard', { opacity: 0 });
  if (paper) { unlift(); finishCrumple(paper); } else crumpleAndThrow(activeEl());
  onboard.thrown();
  gsap.to(['#revealBg', '.actions', '#close'], {
    opacity: 0, duration: 0.25,
    onComplete: () => {
      reveal.hidden = true;
      reveal.classList.remove('leaving');
      canvas.classList.remove('lifted');
    },
  });
}
$('close').addEventListener('click', () => hideReveal());
$('revealBg').addEventListener('click', () => hideReveal());
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !reveal.hidden) hideReveal(); });

// Deslizar la servilleta hacia abajo la tira, igual que cerrar. Mientras se arrastra es ya la
// servilleta 3D (el lienzo se pone encima del velo azul y se esconde lo demás), así que se va
// arrugando bajo el dedo. Si no llega, se alisa y vuelve a su sitio.
const card = $('napkinCard');
const activeEl = () => (current.kind === 'quote' ? napkinImg : napkinCanvas);
const lifted = [];
function lift(keep) {
  for (const o of scene.children) if (o !== keep && !o.isLight && o.visible) { o.visible = false; lifted.push(o); }
  canvas.classList.add('lifted');
}
function unlift() {
  for (const o of lifted) o.visible = true;
  lifted.length = 0;
}

let swipe = null;
const camUp = new THREE.Vector3(), camRight = new THREE.Vector3();
card.addEventListener('pointerdown', (e) => {
  if (reveal.hidden || reveal.classList.contains('leaving') || swipe) return;
  gsap.killTweensOf(card);
  gsap.set(card, { opacity: 1, scale: 1, rotateX: 0, rotateZ: -1.5, x: 0, y: 0 });
  swipe = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dy: 0, v: 0, t: performance.now(), paper: null };
  try { card.setPointerCapture(e.pointerId); } catch {}
  card.classList.add('dragging');
});
card.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const raw = e.clientY - swipe.y0, dx = (e.clientX - swipe.x0) * 0.35;
  if (!swipe.paper) {
    if (Math.hypot(dx, raw) < 6) return;
    swipe.paper = paperFromCard(activeEl());
    if (!swipe.paper) return;
    lift(swipe.paper.mesh);
    gsap.set(card, { opacity: 0 });
    camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  }
  const now = performance.now();
  const dy = raw > 0 ? raw : raw * 0.2; // hacia arriba cuesta
  swipe.v = (dy - swipe.dy) / Math.max(1, now - swipe.t);
  swipe.dy = dy;
  swipe.t = now;
  const P = swipe.paper;
  P.mesh.position.copy(P.base).addScaledVector(camUp, -dy * P.perPx).addScaledVector(camRight, dx * P.perPx);
  P.mesh.quaternion.copy(P.baseQ);
  P.mesh.rotateX(-Math.max(0, dy) * 0.0012);
  P.mesh.rotateZ(-dx * 0.002);
  const k = THREE.MathUtils.clamp(dy / 280, 0, 1);
  sound.wrinkle(k - P.k);
  setCrumple(P, 0, k);
});
function endSwipe(e) {
  if (!swipe || e.pointerId !== swipe.id) return;
  const { dy, v, paper: P } = swipe;
  swipe = null;
  card.classList.remove('dragging');
  if (!P) return; // un toque, sin arrastrar
  if (dy > 110 || (dy > 30 && v > 0.6)) { hideReveal(P); return; }
  // se alisa y vuelve a su sitio; entonces se cambia otra vez por la de la pantalla
  const from = P.mesh.position.clone(), q0 = P.mesh.quaternion.clone(), o = { u: 0 };
  gsap.to(o, {
    u: 1, duration: 0.35, ease: 'back.out(1.6)',
    onUpdate: () => {
      P.mesh.position.lerpVectors(from, P.base, o.u);
      P.mesh.quaternion.slerpQuaternions(q0, P.baseQ, Math.min(1, o.u));
      setCrumple(P, 0, P.k * (1 - Math.min(1, o.u)));
    },
    onComplete: () => {
      disposeBall(P.mesh);
      unlift();
      canvas.classList.remove('lifted');
      gsap.set(card, { opacity: 1 });
    },
  });
}
card.addEventListener('pointerup', endSwipe);
card.addEventListener('pointercancel', endSwipe);

// ---------- Onboarding ----------
// La primera visita: bienvenida, un dedo que enseña el gesto sobre la solapa,
// el aviso de deslizar para tirar la servilleta y, al final, una nota sobre las bolas del suelo.
const onboard = (() => {
  const KEY = 'cafecita.onboarding.v1';
  let step = 'done';
  try { if (localStorage.getItem(KEY) !== 'done') step = 'welcome'; } catch {}
  const hand = $('hand'), welcome = $('welcome'), coach = $('coachSwipe'), toast = $('toast');
  let loop = null;

  // un dedo que pulsa, recorre los puntos y se levanta; points() se recalcula en cada vuelta
  function demo(points) {
    stopDemo();
    const run = () => {
      const [p0, ...rest] = points();
      hand.hidden = false;
      loop = gsap.timeline({ onComplete: () => { loop = gsap.delayedCall(0.8, run); } })
        .set(hand, { x: p0[0], y: p0[1], opacity: 0, scale: 1.5 })
        .to(hand, { opacity: 1, scale: 1, duration: 0.3, ease: 'power2.out' });
      for (const [x, y, d] of rest) loop.to(hand, { x, y, duration: d, ease: 'power1.inOut' });
      loop.to(hand, { opacity: 0, scale: 1.3, duration: 0.25 });
    };
    run();
  }
  function stopDemo() {
    loop?.kill();
    loop = null;
    gsap.killTweensOf(hand);
    hand.hidden = true;
  }

  // dónde está la solapa de la servilleta que mira a cámara, en píxeles
  function flapOnScreen() {
    const p = facingFace().group.localToWorld(new THREE.Vector3(0, WIN.bottom + 1.3, PLATE_OUT)).project(camera);
    return [(p.x + 1) / 2 * window.innerWidth, (1 - p.y) / 2 * window.innerHeight];
  }
  function showPull() {
    step = 'pull';
    demo(() => {
      const [x, y] = flapOnScreen(), u = window.innerHeight / 100;
      return [[x, y], [x, y - 9 * u, 0.55], [x, y + 16 * u, 0.7]];
    });
  }
  function finish() {
    step = 'done';
    try { localStorage.setItem(KEY, 'done'); } catch {}
  }

  $('welcomeGo').addEventListener('click', () => {
    gsap.to(welcome, { opacity: 0, duration: 0.3, onComplete: () => { welcome.hidden = true; } });
    showPull();
  });

  return {
    // en cuanto se ve el servilletero
    start() {
      if (step !== 'welcome') return;
      welcome.hidden = false;
      gsap.fromTo(welcome, { opacity: 0 }, { opacity: 1, duration: 0.4 });
      gsap.fromTo('.welcome-card', { y: 24 }, { y: 0, duration: 0.6, ease: 'back.out(1.4)' });
    },
    grabbed() { if (step === 'pull') stopDemo(); },
    released() { if (step === 'pull') gsap.delayedCall(1.2, () => { if (step === 'pull' && !drag) showPull(); }); },
    revealed() {
      if (step !== 'pull') return;
      step = 'swipe';
      stopDemo();
      coach.hidden = false;
      gsap.fromTo(coach, { opacity: 0 }, { opacity: 1, duration: 0.4, delay: 1 });
      gsap.delayedCall(1, () => {
        if (step !== 'swipe') return;
        demo(() => {
          const r = card.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height * 0.45;
          return [[x, y], [x, y + r.height * 0.4, 0.6]];
        });
      });
    },
    thrown() {
      if (step !== 'swipe') return;
      stopDemo();
      coach.hidden = true;
      finish();
      toast.textContent = 'Las bolas se quedan en el suelo hasta mañana. Entre las noticias se esconden dos citas al día.';
      toast.hidden = false;
      gsap.timeline()
        .fromTo(toast, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, delay: 0.8 })
        .to(toast, { opacity: 0, duration: 0.4, delay: 4.5, onComplete: () => { toast.hidden = true; } });
    },
  };
})();

$('sound').addEventListener('click', () => {
  sound.setOn(!sound.isOn());
  sound.unlock();
  updateUI();
});

// Lo que se comparte es la story (servilleta sobre azul + marca)
const slug = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function fileName(item) {
  const name = item.kind === 'quote' ? item.quote.author
    : item.kind === 'news' ? `${item.news.fuente} ${item.news.titular.split(' ').slice(0, 6).join(' ')}`
    : item.kind === 'ad' ? item.ad.marca : 'reponiendo';
  return `cafecita-${today()}-${slug(name)}.jpg`;
}
const storyBlob = (item) => (item.kind === 'quote'
  ? fetch(item.quote.story).then((r) => r.blob())
  : paintStory(napkinCanvas, paperLogo));

function saveFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// con hoja de compartir (móvil) se comparte la imagen; sin ella (escritorio), se descarga
$('share').addEventListener('click', async () => {
  const item = current;
  const file = shareFile || new File([await storyBlob(item)], fileName(item), { type: 'image/jpeg' });
  const text = item.kind === 'news' ? `${item.news.titular} (${item.news.fuente}) ${item.news.url}` : 'Gracias por su visita.';
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Mi servilleta', text }); } catch {}
  } else {
    saveFile(file);
  }
});

// ---------- Bucle ----------
const clock = new THREE.Clock();
const SUB = 1 / 120;
let acc = 0, lastFacing = null, nextHint = 2.5;
let t = 0;
function frame(dt) {
  t += dt;
  if (!drag || drag.mode !== 'rotate') rot += (rotTarget - rot) * (1 - Math.exp(-dt * 7));
  dispenser.rotation.y = rot + parallax;

  const face = facingFace();
  if (face !== lastFacing) { lastFacing = face; updateUI(); }

  // invita a tirar: de vez en cuando la solapa de abajo se despega un poco
  if (!drag && !busy && face.settled && t > nextHint) {
    nextHint = t + 3.2;
    face.settled = false;
    const sheet = face.sheet;
    for (let i = 0; i < N; i++) {
      const y = sheet.rest[i * 3 + 1];
      if (sheet.mode[i] === FREE && y < WIN.bottom + 2.2) sheet.prev[i * 3 + 2] -= 0.05 * (1 - (y - WIN.bottom) / 2.2);
    }
    gsap.delayedCall(1.6, () => { if (!drag || drag.face !== face) face.settled = true; });
  }

  acc += dt;
  while (acc >= SUB) {
    acc -= SUB;
    for (const f of Object.values(faces)) {
      if (f.settled || !f.front.visible || f.tween?.isActive()) continue;
      // las bolas, en las coordenadas de esta cara
      f.sheet.obstacles = balls.map((b) => {
        const c = f.group.worldToLocal(b.mesh.position.clone());
        return { x: c.x, y: c.y, z: c.z, r: b.r, r2: b.r * b.r };
      });
      f.sheet.step(SUB, f.sheet.grabTarget ? 0 : 160);
    }
    stepBalls(SUB);
  }
  // el roce suena según lo rápido que sale el papel por la boca (y un poco según se dobla)
  if (drag?.mode === 'pull' && !busy && dt > 0) {
    const sheet = drag.face.sheet;
    const now = { slide: sheet.slide, p: sheet.grabTarget?.clone() };
    if (drag.last) {
      const bend = now.p && drag.last.p ? now.p.distanceTo(drag.last.p) : 0;
      sound.rub((now.slide - drag.last.slide + bend * 0.3) / dt);
    }
    drag.last = now;
  }

  for (const f of Object.values(faces)) {
    if (!f.front.visible) continue;
    syncGeometry(f);
    if (drag?.face === f && !busy && !f.sheet.heldTop) extract(f);
  }

  renderer.render(scene, camera);
}
function tick() {
  frame(Math.min(clock.getDelta(), 0.05));
  requestAnimationFrame(tick);
}
updateUI();
tick();
