import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gsap } from 'gsap';

// ---------- Medidas (cm aprox.) ----------
const W = 8.6;      // ancho de la cara abierta
const H = 11;       // alto
const D = 9;        // fondo (entre las dos caras con servilletas)
const T = 0.08;     // grosor de chapa
const LIFT = 0.16;  // patitas
const BASE_ROT = 0.5;
const NAPKIN_Z = D / 2 - 0.42;
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

// ---------- Render ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
// estudio fotográfico claro: degradado + softboxes, para que el inox se vea satinado
function studioEnv() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = vP.y * 0.5 + 0.5; vec3 floorC = vec3(0.16, 0.19, 0.75); gl_FragColor = vec4(mix(floorC, vec3(0.9), smoothstep(0.25, 0.9, h)), 1.0); }',
    })
  ));
  const box = (w, h, x, y, z, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.material.color.setScalar(k);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  box(10, 40, -26, 8, 14, 1.6);
  box(8, 30, 24, 6, 18, 1.1);
  box(24, 24, 0, 34, 0, 1.3);
  box(12, 20, 4, 6, 30, 0.8);
  return env;
}
scene.environment = pmrem.fromScene(studioEnv(), 0.03).texture;

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 200);
const target = new THREE.Vector3(0, H * 0.4, 0);

const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(-9, 20, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
key.shadow.bias = -0.0004;
key.shadow.radius = 6;
scene.add(key);
scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe1fb, 0.7));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ color: 0x0c0e2e, opacity: 0.22 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------- Texturas ----------
function brushedTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#6e6e6e';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1600; i++) {
    const v = (90 + Math.random() * 40) | 0;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.18})`;
    g.fillRect(Math.random() * 512, 0, Math.random() * 1.4 + 0.3, 512);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

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

// Cara visible de la servilleta doblada dentro del servilletero
function foldedNapkinTexture() {
  const w = 512, h = 664;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  fibers(g, w, h, 900, 0.06);
  grain(g, w, h, 7);
  // pliegue horizontal
  const fy = h * 0.66;
  const fold = g.createLinearGradient(0, fy - 8, 0, fy + 8);
  fold.addColorStop(0, 'rgba(0,0,0,0)');
  fold.addColorStop(0.45, 'rgba(90,80,60,0.07)');
  fold.addColorStop(0.55, 'rgba(255,255,255,0.6)');
  fold.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fold;
  g.fillRect(0, fy - 8, w, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- Materiales ----------
const brushed = brushedTexture();
const metal = new THREE.MeshPhysicalMaterial({
  color: '#e4e7eb',
  metalness: 1,
  roughness: 0.4,
  roughnessMap: brushed,
  anisotropy: 0.5,
  anisotropyRotation: Math.PI / 2,
  envMapIntensity: 1,
});
const paperFlat = new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.95, emissive: '#ffffff', emissiveIntensity: 0.34 });
const foldedTex = foldedNapkinTexture();

// ---------- Servilletero ----------
const dispenser = new THREE.Group();
scene.add(dispenser);
const body = new THREE.Group();
body.position.y = LIFT;
dispenser.add(body);

const proceduralMetal = [];
function add(geo, mat, x, y, z, parent = body) {
  const m = new THREE.Mesh(geo, mat);
  if (mat === metal) proceduralMetal.push(m);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// sombra de contacto
const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(W * 256 / 144, D * 256 / 144),
  new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.55 })
);
contact.rotation.x = -Math.PI / 2;
contact.position.y = 0.01;
dispenser.add(contact);

// laterales cerrados, techo y base
add(new RoundedBoxGeometry(T * 2, H, D, 2, 0.04), metal, -W / 2 + T, H / 2, 0);
add(new RoundedBoxGeometry(T * 2, H, D, 2, 0.04), metal, W / 2 - T, H / 2, 0);
add(new RoundedBoxGeometry(W, T * 2, D, 2, 0.04), metal, 0, H - T, 0);
add(new RoundedBoxGeometry(W, T * 2, D, 2, 0.04), metal, 0, T, 0);
// chapa central
add(new THREE.BoxGeometry(W - 0.3, H - 0.3, 0.05), metal, 0, H / 2, 0);
// patitas
const footGeo = new THREE.CylinderGeometry(0.22, 0.26, LIFT, 16);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(footGeo, metal, sx * (W / 2 - 0.7), -LIFT / 2, sz * (D / 2 - 0.7));

function makeTab() {
  const h = 1.15, wOut = W - 1.25, wIn = W - 3.4;
  const shape = new THREE.Shape();
  shape.moveTo(-wOut / 2, 0);
  shape.lineTo(wOut / 2, 0);
  shape.lineTo(wIn / 2, -h);
  shape.lineTo(-wIn / 2, -h);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.03, bevelSegments: 2 });
}
const tabGeo = makeTab();
const lipGeo = new RoundedBoxGeometry(0.62, H - 0.1, T * 2, 2, 0.04);

const faces = {};
const pickables = [];

for (const [id, s] of [['A', 1], ['B', -1]]) {
  const face = new THREE.Group();
  face.rotation.y = s > 0 ? 0 : Math.PI;
  body.add(face);

  // pestañas laterales
  for (const sx of [-1, 1]) add(lipGeo, metal, sx * (W / 2 - 0.31), H / 2, D / 2 - T, face);

  // pestañas superior e inferior, dobladas hacia dentro
  for (const sy of [1, -1]) {
    const tilt = new THREE.Group();
    tilt.position.set(0, sy > 0 ? H - 0.02 : 0.02, D / 2 - 0.03);
    tilt.rotation.x = sy * 0.25;
    face.add(tilt);
    const tab = add(tabGeo, metal, 0, 0, 0, tilt);
    tab.rotation.z = sy > 0 ? 0 : Math.PI;
  }

  // taco de servilletas (crece desde la chapa central)
  const stackDepth = NAPKIN_Z - 0.06;
  const stackGeo = new THREE.BoxGeometry(W - 0.45, H - 0.5, stackDepth);
  stackGeo.translate(0, 0, stackDepth / 2);
  const stack = add(stackGeo, paperFlat, 0, H / 2, 0.04, face);

  // servilleta que se puede sacar
  const geo = new THREE.PlaneGeometry(W - 0.5, H - 0.5, 30, 40);
  const mat = new THREE.MeshStandardMaterial({ map: foldedTex, roughness: 0.92, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.34 });
  const napkin = add(geo, mat, 0, H / 2, NAPKIN_Z, face);
  pickables.push(napkin);

  faces[id] = { id, s, group: face, napkin, stack, base: Float32Array.from(geo.attributes.position.array) };

  if (state.taken[id]) {
    napkin.visible = false;
    stack.visible = false;
  }
}
body.traverse((o) => { if (o.isMesh && !pickables.includes(o)) pickables.push(o); });

// Deforma la servilleta: p = cuánto se ha tirado, (gx, gy) = punto agarrado
function deform(face, p, gx, gy, dirX = 0, dirY = 0, free = 0) {
  const pos = face.napkin.geometry.attributes.position;
  const base = face.base;
  const sigma = 1.1 + p * 1.6;
  const hw = (W - 0.5) / 2, hh = (H - 0.5) / 2;
  for (let i = 0; i < pos.count; i++) {
    const x0 = base[i * 3], y0 = base[i * 3 + 1];
    const dx = x0 - gx, dy = y0 - gy;
    // los bordes quedan sujetos por las pestañas
    const pin = Math.min(1, (hw - Math.abs(x0)) / 1.1) * Math.min(1, (hh - Math.abs(y0)) / 1.6);
    let w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)) * pin;
    w += (1 - w) * free;
    const pinch = p * 0.35 * w * (1 - free);
    const crumple = Math.sin(x0 * 3.1 + y0 * 1.7) * Math.sin(y0 * 2.3 - x0 * 1.1) * 0.14 * p * w;
    pos.setXYZ(
      i,
      x0 - dx * pinch * 0.5 + dirX * p * 1.5 * w,
      y0 - dy * pinch * 0.5 + dirY * p * 1.5 * w,
      p * 5.5 * w + free * 6 + crumple
    );
  }
  pos.needsUpdate = true;
  face.napkin.geometry.computeVertexNormals();
}

// ---------- Modelo de Blender ----------
new GLTFLoader().load('models/servilletero.glb', (gltf) => {
  for (const m of proceduralMetal) m.parent.remove(m);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = metal;
    o.castShadow = o.receiveShadow = true;
    pickables.push(o);
  });
  dispenser.add(gltf.scene);
}, undefined, () => { /* sin modelo: se queda el procedural */ });

// ---------- Cámara ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const distV = (H * 2.15) / 2 / Math.tan(half);
  const distH = (W * 1.75) / 2 / (Math.tan(half) * camera.aspect);
  const dist = Math.max(distV, distH);
  const el = THREE.MathUtils.degToRad(15);
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
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(e) {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(pickables, false).find((h) => h.object.visible);
  const face = facingFace();
  if (hit && (hit.object === face.napkin || hit.object === face.stack) && !state.taken[face.id]) return { face, point: hit.point };
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  if (busy) return;
  const hit = pick(e);
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  if (hit) {
    const local = hit.face.napkin.worldToLocal(hit.point.clone());
    gsap.killTweensOf(hit.face.springObj || {});
    drag = { mode: 'pull', face: hit.face, gx: local.x, gy: local.y, sx: e.clientX, sy: e.clientY, p: 0, dirX: 0, dirY: 0 };
    canvas.style.cursor = 'grabbing';
  } else {
    drag = { mode: 'rotate', lastX: e.clientX };
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (e.pointerType === 'mouse') {
      canvas.style.cursor = !busy && pick(e) ? 'grab' : 'default';
      parallax = ((e.clientX / window.innerWidth) - 0.5) * 0.12;
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
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  const dist = Math.hypot(dx, dy);
  drag.p = dist / (0.26 * Math.min(window.innerWidth, window.innerHeight));
  if (dist > 0) { drag.dirX = dx / dist; drag.dirY = -dy / dist; }
  deform(drag.face, Math.min(drag.p, 1), drag.gx, drag.gy, drag.dirX, drag.dirY);
  if (drag.p >= 1) extract(drag);
});

function endDrag() {
  if (!drag) return;
  if (drag.mode === 'rotate') {
    rotTarget = BASE_ROT + Math.round((rot - BASE_ROT) / Math.PI) * Math.PI;
  } else {
    // vuelve a su sitio con efecto muelle
    const d = drag;
    const o = (d.face.springObj = { p: Math.min(d.p, 1) });
    gsap.to(o, {
      p: 0, duration: 0.8, ease: 'elastic.out(1, 0.35)',
      onUpdate: () => deform(d.face, o.p, d.gx, d.gy, d.dirX, d.dirY),
    });
  }
  drag = null;
  canvas.style.cursor = 'default';
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function extract(d) {
  drag = null;
  busy = true;
  canvas.style.cursor = 'default';
  const { face } = d;
  state.taken[face.id] = true;
  saveState();
  if (navigator.vibrate) navigator.vibrate(18);

  face.napkin.material.transparent = true;
  const o = { p: 1, free: 0 };
  gsap.to(o, {
    p: 1.4, free: 1, duration: 0.5, ease: 'power2.in',
    onUpdate: () => deform(face, o.p, d.gx, d.gy, d.dirX, d.dirY, o.free),
  });
  gsap.to(face.napkin.material, { opacity: 0, duration: 0.2, delay: 0.32 });
  gsap.to(face.stack.scale, {
    z: 0.001, duration: 0.7, delay: 0.25, ease: 'power3.inOut',
    onComplete: () => { face.stack.visible = false; face.napkin.visible = false; },
  });
  gsap.delayedCall(0.38, () => showReveal(face.id));
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
    { opacity: 0, scale: 0.45, rotateX: 65, rotateZ: -10, y: 80 },
    { opacity: 1, scale: 1, rotateX: 0, rotateZ: -1.5, y: 0, duration: 1, ease: 'back.out(1.3)' });
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
const slug = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
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
let lastFacing = null;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (!drag || drag.mode !== 'rotate') rot += (rotTarget - rot) * (1 - Math.exp(-dt * 7));
  dispenser.rotation.y = rot + parallax;

  const face = facingFace();
  if (face !== lastFacing) { lastFacing = face; updateUI(); }

  // invita a tirar: la servilleta "respira" un poco
  if (!drag && !busy && !state.taken[face.id] && !gsap.isTweening(face.springObj || {})) {
    const breath = Math.max(0, Math.sin(t * 2.4)) ** 3 * 0.05;
    deform(face, breath, 0, 0.4);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
updateUI();
tick();
