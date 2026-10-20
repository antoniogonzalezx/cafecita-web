// ---------- Sonido de servilleta ----------
// Sintetizado con Web Audio, sin ficheros: el roce del papel contra el inox mientras se tira,
// los crujidos de la fibra, el «fsss» al sacarla, el «tic» del muelle colocando la siguiente
// y, al acabar, arrugarla y tirarla al suelo.
// El navegador solo deja sonar después de un gesto: unlock() va en el primer toque.
const KEY = 'cafecita.sonido';
let on = true;
try { on = localStorage.getItem(KEY) !== 'off'; } catch {}

let ctx = null, out = null, noise = null, rubbing = null;

export const isOn = () => on;
export function setOn(v) {
  on = v;
  try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch {}
  if (!v) rubStop();
}

export function unlock() {
  if (!on) return;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    // un compresor suave para que los chasquidos juntos no saturen
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

const ready = () => on && ctx && ctx.state === 'running';

function filter(type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function burst(when, dur, nodes, level) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(level, when + Math.min(0.012, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0005, when + dur);
  nodes.reduce((a, n) => a.connect(n), src).connect(g).connect(out);
  src.start(when, Math.random() * 1.5, dur + 0.05);
  return src;
}

// un crujido de fibra: chasquido muy corto y agudo
function crackle(level, when = ctx.currentTime) {
  burst(when, 0.006 + Math.random() * 0.02, [filter('highpass', 2400 + Math.random() * 3600, 0.9)], level);
}

// el muelle aprieta la siguiente servilleta contra la chapa: un «tic» de inox, muy flojo
function tink(when, level = 1) {
  for (const [f, a, d] of [[2950, 0.035, 0.14], [4420, 0.02, 0.09], [6870, 0.01, 0.05]]) {
    const o = ctx.createOscillator();
    o.frequency.value = f * (0.98 + Math.random() * 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(a * level, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + d);
    o.connect(g).connect(out);
    o.start(when);
    o.stop(when + d + 0.02);
  }
}

// al abrir la solapa, el papel se despega con un par de crujidos
export function grab() {
  if (!ready()) return;
  const t = ctx.currentTime;
  crackle(0.25, t);
  crackle(0.15, t + 0.03 + Math.random() * 0.04);
}

// roce continuo mientras se tira: sube con la velocidad del papel
export function rubStart() {
  if (!ready()) return;
  rubStop();
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const hp = filter('highpass', 900);
  const bp = filter('bandpass', 2400, 0.6);
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(hp).connect(bp).connect(g).connect(out);
  src.start(0, Math.random() * 1.5);
  rubbing = { src, bp, g };
}

// v: cm/s que se mueve el papel
export function rub(v) {
  if (!rubbing || !ready()) return;
  const k = Math.min(1, Math.max(0, v) / 45);
  const t = ctx.currentTime;
  rubbing.g.gain.setTargetAtTime(0.4 * k * k, t, 0.035);
  rubbing.bp.frequency.setTargetAtTime(1700 + 3200 * k, t, 0.05);
  if (Math.random() < k * 0.3) crackle(0.08 + 0.3 * k);
}

export function rubStop() {
  if (!rubbing) return;
  const { src, g } = rubbing;
  rubbing = null;
  const t = ctx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setTargetAtTime(0, t, 0.04);
  src.stop(t + 0.3);
}

// la servilleta sale del todo: «fsss» que se abre a agudos, crujidos y el muelle
export function pull() {
  if (!ready()) return;
  rubStop();
  const t = ctx.currentTime;
  const bp = filter('bandpass', 1100, 0.9);
  bp.frequency.setValueAtTime(1100, t);
  bp.frequency.exponentialRampToValueAtTime(5200, t + 0.16);
  burst(t, 0.28, [filter('highpass', 600), bp], 0.55);
  for (let i = 0; i < 5; i++) crackle(0.2 + Math.random() * 0.3, t + Math.random() * 0.13);
  tink(t + 0.34);
}

// soltada a medias: se vuelve a meter con un roce suave
export function tuck() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.05;
  burst(t, 0.32, [filter('bandpass', 1500, 0.5), filter('lowpass', 3200)], 0.14);
  tink(t + 0.6, 0.6);
}

// arrugar la servilleta: una ráfaga de crujidos que se aprieta y se apaga, sobre un «crunch» grave
export function crumple(dur = 0.6) {
  if (!ready()) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 48; i++) {
    const u = Math.random();
    crackle(0.1 + Math.random() * 0.3 * (1 - u * 0.6), t + dur * Math.pow(u, 0.85));
  }
  for (const [at, len, f] of [[0, 0.22, 900], [0.18, 0.2, 1300], [0.36, 0.24, 1000]]) {
    burst(t + at, len, [filter('bandpass', f, 0.7)], 0.14);
  }
}

// la bola sale volando de la mano
export function toss() {
  if (!ready()) return;
  burst(ctx.currentTime, 0.16, [filter('bandpass', 700, 0.6)], 0.08);
}

// la bola toca el suelo: golpe sordo de papel, más fuerte cuanto más rápido cae
let lastThud = 0;
export function thud(v) {
  if (!ready() || ctx.currentTime - lastThud < 0.04) return;
  const t = lastThud = ctx.currentTime;
  const k = Math.min(1, v / 500);
  burst(t, 0.08, [filter('lowpass', 700 + 900 * k)], 0.45 * k);
  crackle(0.12 * k, t + 0.01);
  if (k > 0.5) crackle(0.08 * k, t + 0.03);
}

// arrugar un poco al arrastrar la servilleta: crujidos según cuánto se ha arrugado de más
export function wrinkle(dk) {
  if (!ready() || dk <= 0) return;
  const t = ctx.currentTime, n = Math.floor(dk * 60 + Math.random());
  for (let i = 0; i < n; i++) crackle(0.06 + Math.random() * 0.18, t + Math.random() * 0.06);
}
