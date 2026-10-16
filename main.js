import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gsap } from 'gsap';

// ---------- Medidas (cm, iguales que tools/blender_servilletero.py) ----------
const W = 9.0;      // ancho
const H = 12.6;     // alto, con la tapa
const D = 8.0;      // fondo (entre las dos ventanas)
const T = 0.1;      // grosor de chapa
const LIFT = 0.35;  // gomas
const LID = 0.55, GAP = 0.05;          // tapa pulida y junta
const TOP = LIFT + H;
const BODY_TOP = TOP - LID - GAP;      // techo del cuerpo, por dentro de la tapa
const WIN = { x: W / 2 - 0.55, bottom: LIFT + 1.1, top: BODY_TOP - 1.2 };
const PLATE_IN = D / 2 - T;        // cara interior de la chapa con ventana
const PLATE_OUT = D / 2 + 0.06;    // cara exterior (con el borde enrollado)
const NAPKIN_Z = PLATE_IN - 0.05;  // el muelle aprieta el taco contra la ventana
// la servilleta cabe entera dentro: el borde de arriba queda escondido bajo el marco
const N_BOTTOM = LIFT + T + 0.2, N_TOP = BODY_TOP - 0.35;
const NW = 2 * WIN.x - 0.2, NH = N_TOP - N_BOTTOM;
const INK = '#4A6789';
const BASE_ROT = 0.55;
const PAPER = '#FBF9F4';

// ---------- Estado diario ----------
const STORE_KEY = 'cafecita.servilletero.v1';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.date === today()) return s;
  } catch {}
  return { date: today(), taken: { A: false, B: false } };
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}
let state = loadState();
// ?reset borra el límite del día (para pruebas)
if (new URLSearchParams(location.search).has('reset')) {
  state = { date: today(), taken: { A: false, B: false } };
  saveState();
  history.replaceState(null, '', location.pathname);
}

// ---------- Servilletas del día ----------
// Cada día tocan dos piezas seguidas del catálogo: una por cada lado.
const NAPKINS = await fetch('napkins.json').then((r) => r.json());
const dayNumber = Math.floor(new Date(`${state.date}T00:00:00Z`).getTime() / 86400000);
const todays = {
  A: NAPKINS[(dayNumber * 2) % NAPKINS.length],
  B: NAPKINS[(dayNumber * 2 + 1) % NAPKINS.length],
};
for (const n of Object.values(todays)) new Image().src = n.napkin;
// la solapa se rotula con la tipografía de la marca
await Promise.all([
  document.fonts.load('italic 400 80px Fraunces'),
  document.fonts.load('700 40px "Bricolage Grotesque"'),
]).catch(() => {});

// ---------- Render ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
// estudio: suelo azul, paredes grises y tiras de luz muy intensas.
// El metal necesita contraste (claros y oscuros) que reflejar, o parece plástico.
function studioEnv() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = vP.y * 0.5 + 0.5; vec3 c = mix(vec3(0.09, 0.11, 0.62), vec3(0.34, 0.35, 0.38), smoothstep(0.4, 0.5, h)); c = mix(c, vec3(1.1), smoothstep(0.6, 0.95, h)); gl_FragColor = vec4(c, 1.0); }',
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
  g.font = `700 ${Math.round(TEX_W * 0.026)}px "Bricolage Grotesque", system-ui, sans-serif`;
  g.letterSpacing = `${Math.round(TEX_W * 0.012)}px`;
  g.fillText('CAFECITA', TEX_W / 2, cy + TEX_W * 0.085);
  g.letterSpacing = '0px';
  const rule = TEX_W * 0.09;
  g.fillRect(TEX_W / 2 - TEX_W * 0.14 - rule, cy + TEX_W * 0.085 - 1, rule, 2);
  g.fillRect(TEX_W / 2 + TEX_W * 0.14, cy + TEX_W * 0.085 - 1, rule, 2);
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
    color: '#eceef1', map: brushed.color, metalness: 1, roughness: 0.34, roughnessMap: brushed.rough,
    anisotropy: 0.8, anisotropyRotation: 0,
  }),
  Cromo: new THREE.MeshPhysicalMaterial({ color: '#f5f7f9', metalness: 1, roughness: 0.04, envMapIntensity: 1.15 }),
  Grabado: new THREE.MeshPhysicalMaterial({ color: '#7d8288', metalness: 1, roughness: 0.6 }),
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
new GLTFLoader().load('models/servilletero.glb', (gltf) => {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = MATERIALS[o.material?.name] ?? MATERIALS.Inox;
    o.castShadow = o.receiveShadow = true;
    pickables.push(o);
  });
  dispenser.add(gltf.scene);
});

// ---------- Servilleta: hoja de papel simulada ----------
// Rejilla de partículas (verlet) con distancias fijas: el papel se dobla pero no se estira.
// La parte de arriba queda pillada bajo el marco y solo desliza si se tira hacia abajo;
// la de abajo (la solapa) se suelta en cuanto se agarra.
const NX = 16, NY = 24;
const N = NX * NY;
const DX = NW / (NX - 1), DY = NH / (NY - 1);
const GRAVITY = -650;   // cm/s², el papel cae "frenado" por el aire
const DRAG = 0.992;
const ITER = 14;
const FREE = 0, HELD_TOP = 1, HELD_BOTTOM = 2, GRABBED = 3;

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
        // rigidez a flexión: el papel de bar es fino pero tieso
        if (ix < NX - 2) link(i, idx(ix + 2, iy), 0.7);
        if (iy < NY - 2) link(i, idx(ix, iy + 2), 0.7);
        if (ix < NX - 3) link(i, idx(ix + 3, iy), 0.12);
        if (iy < NY - 3) link(i, idx(ix, iy + 3), 0.12);
      }
    }
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
    const p = this.pos;
    for (let i = 0; i < N; i++) {
      if (this.mode[i] !== FREE) continue;
      const j = i * 3;
      let x = p[j], y = p[j + 1], z = p[j + 2];
      const inWindow = Math.abs(x) < WIN.x - 0.06 && y > WIN.bottom + 0.06 && y < WIN.top - 0.06;
      const inFootprint = Math.abs(x) < W / 2 + 0.1 && y < TOP + 0.1;
      // la chapa con ventana: fuera del hueco, el papel se queda del lado en que está
      if (!inWindow && inFootprint && z > PLATE_IN - 0.02 && z < PLATE_OUT + 0.03) {
        z = z < (PLATE_IN + PLATE_OUT) / 2 ? PLATE_IN - 0.02 : PLATE_OUT + 0.03;
      }
      this.inside[i] = inFootprint && z < (PLATE_IN + PLATE_OUT) / 2 ? 1 : 0;
      if (this.inside[i]) {
        z = Math.max(z, NAPKIN_Z);           // el taco
        y = Math.min(y, N_TOP);              // el techo
        x = THREE.MathUtils.clamp(x, -W / 2 + T + 0.05, W / 2 - T - 0.05);
      }
      y = Math.max(y, 0.03);                 // la mesa
      p[j] = x; p[j + 1] = y; p[j + 2] = z;
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
  if (state.taken[id]) setTaken(faces[id]);
}

function setTaken(face) {
  face.front.visible = face.back.visible = false;
  face.stack.visible = false;
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
  const left = ['A', 'B'].filter((k) => !state.taken[k]).length;
  document.querySelectorAll('.dots i').forEach((el) => el.classList.toggle('taken', state.taken[el.dataset.side]));
  $('turn').hidden = left === 0;
  $('hint').classList.toggle('gone', state.taken[facingFace().id] || !!drag || busy);
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
  if (state.taken[face.id] || !face.front.visible) return null;
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

canvas.addEventListener('pointerdown', (e) => {
  if (busy) return;
  const hit = pick(e);
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  if (hit) {
    const local = hit.face.group.worldToLocal(hit.point.clone());
    gsap.killTweensOf(hit.face);
    hit.face.sheet.grab(local.x, local.y);
    hit.face.settled = false;
    drag = { mode: 'pull', face: hit.face, sx: e.clientX, sy: e.clientY, z0: hit.face.sheet.grabTarget.z, out: 0 };
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
  if (p) drag.face.sheet.grabTarget.copy(drag.face.sheet.pull(p));
});

function endDrag() {
  if (!drag) return;
  if (drag.mode === 'rotate') {
    rotTarget = BASE_ROT + Math.round((rot - BASE_ROT) / Math.PI) * Math.PI;
  } else if (!busy) {
    // se suelta a medias: el papel cae y vuelve a meterse en el servilletero
    const face = drag.face;
    face.sheet.release();
    gsap.delayedCall(0.45, () => tuckBack(face));
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
    onStart: () => { sheet.mode.fill(GRABBED); sheet.grabTarget = null; },
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
  state.taken[face.id] = true;
  saveState();
  if (navigator.vibrate) navigator.vibrate(18);
  updateUI();
  // la servilleta cuelga un momento de los dedos y se la lleva la cámara
  gsap.delayedCall(0.45, () => {
    face.sheet.release();
    if (drag && drag.face === face) drag = null;
    for (const m of [face.front, face.back]) {
      m.material.transparent = true;
      gsap.to(m.material, { opacity: 0, duration: 0.25, delay: 0.1 });
    }
    gsap.to(face.stack.scale, {
      z: 0.001, duration: 0.6, ease: 'power3.inOut',
      onComplete: () => setTaken(face),
    });
    showReveal(face.id);
  });
}

function turn() {
  if (busy) return;
  rotTarget = BASE_ROT + (Math.round((rotTarget - BASE_ROT) / Math.PI) + 1) * Math.PI;
}
$('turn').addEventListener('click', turn);

// ---------- Revelado ----------
const reveal = $('reveal');
const napkinImg = $('napkinImg');
let currentSide = 'A';

async function showReveal(id) {
  currentSide = id;
  const n = todays[id];
  napkinImg.src = n.napkin;
  napkinImg.alt = `“${n.quote}” — ${n.author}`;
  try { await napkinImg.decode(); } catch {}
  reveal.hidden = false;
  gsap.fromTo('#revealBg', { opacity: 0 }, { opacity: 1, duration: 0.4 });
  gsap.fromTo('#napkinCard',
    { opacity: 0, scale: 0.6, rotateX: 40, rotateZ: 8, y: 120 },
    { opacity: 1, scale: 1, rotateX: 0, rotateZ: -1.5, y: 0, duration: 0.9, ease: 'back.out(1.2)' });
  gsap.fromTo(['.actions', '#close'], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, delay: 0.5 });
}

function hideReveal() {
  gsap.to('#napkinCard', { opacity: 0, scale: 0.9, y: 30, duration: 0.25 });
  gsap.to(['#revealBg', '.actions', '#close'], {
    opacity: 0, duration: 0.3,
    onComplete: () => {
      reveal.hidden = true;
      busy = false;
      updateUI();
      // si queda servilleta al otro lado, el servilletero se gira solo
      const other = facingFace().id === 'A' ? 'B' : 'A';
      if (state.taken[facingFace().id] && !state.taken[other]) gsap.delayedCall(0.4, turn);
    },
  });
}
$('close').addEventListener('click', hideReveal);
$('revealBg').addEventListener('click', hideReveal);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !reveal.hidden) hideReveal(); });

// Lo que se descarga y se comparte es la story (servilleta sobre azul + @cafecita.app)
const slug = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const fileName = () => `cafecita-${state.date}-${slug(todays[currentSide].author)}.jpg`;
const storyBlob = () => fetch(todays[currentSide].story).then((r) => r.blob());

$('download').addEventListener('click', async () => {
  const url = URL.createObjectURL(await storyBlob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

if (navigator.share) {
  $('share').hidden = false;
  $('share').addEventListener('click', async () => {
    const file = new File([await storyBlob()], fileName(), { type: 'image/jpeg' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Mi servilleta de hoy' });
      else await navigator.share({ title: 'Cafecita', url: location.href });
    } catch {}
  });
}

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
  if (!drag && !busy && face.settled && !state.taken[face.id] && t > nextHint) {
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
      f.sheet.step(SUB, f.sheet.grabTarget ? 0 : 160);
    }
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
