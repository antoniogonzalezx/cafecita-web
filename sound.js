// ---------- Sonido de servilleta ----------
// Sintetizado con Web Audio, sin ficheros: el roce del papel mientras se tira, los crujidos de
// la fibra, el «fsss» al sacarla y, al acabar, arrugarla y tirarla al suelo.
// Todo suave: suena el papel, nunca el servilletero (es papel contra inox, no metal contra metal).
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
    out.gain.value = 0.55;
    // sin agudos cortantes: el papel de servilleta es blando
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 6000;
    out.connect(soft).connect(comp).connect(ctx.destination);
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

function burst(when, dur, nodes, level, attack = 0.012) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(level, when + Math.min(attack, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0005, when + dur);
  nodes.reduce((a, n) => a.connect(n), src).connect(g).connect(out);
  src.start(when, Math.random() * 1.5, dur + 0.05);
  return src;
}

// un crujido de fibra: chasquido corto, más papel que chispa
function crackle(level, when = ctx.currentTime) {
  burst(when, 0.01 + Math.random() * 0.02, [filter('bandpass', 1600 + Math.random() * 2000, 0.8)], level);
}

// al abrir la solapa, el papel se despega con un par de crujidos
export function grab() {
  if (!ready()) return;
  const t = ctx.currentTime;
  crackle(0.1, t);
  crackle(0.06, t + 0.03 + Math.random() * 0.04);
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
  rubbing.g.gain.setTargetAtTime(0.22 * k * k, t, 0.035);
  rubbing.bp.frequency.setTargetAtTime(1400 + 2200 * k, t, 0.05);
  if (Math.random() < k * 0.25) crackle(0.03 + 0.09 * k);
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

// la servilleta sale del todo: un «fsss» suave y unos pocos crujidos
export function pull() {
  if (!ready()) return;
  rubStop();
  const t = ctx.currentTime;
  const bp = filter('bandpass', 1000, 0.8);
  bp.frequency.setValueAtTime(1000, t);
  bp.frequency.exponentialRampToValueAtTime(3200, t + 0.18);
  burst(t, 0.3, [filter('highpass', 500), bp], 0.26, 0.03);
  for (let i = 0; i < 4; i++) crackle(0.05 + Math.random() * 0.08, t + Math.random() * 0.14);
}

// soltada a medias: se vuelve a meter con un roce suave
export function tuck() {
  if (!ready()) return;
  burst(ctx.currentTime + 0.05, 0.32, [filter('bandpass', 1300, 0.5), filter('lowpass', 2600)], 0.08, 0.05);
}

// arrugar la servilleta: crujidos que se aprietan y se apagan, sobre un «crunch» blando
export function crumple(dur = 0.6) {
  if (!ready()) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 26; i++) {
    const u = Math.random();
    crackle(0.03 + Math.random() * 0.08 * (1 - u * 0.6), t + dur * Math.pow(u, 0.85));
  }
  for (const [at, len, f] of [[0, 0.24, 700], [0.18, 0.22, 950], [0.36, 0.26, 800]]) {
    burst(t + at, len, [filter('bandpass', f, 0.6), filter('lowpass', 2200)], 0.06, 0.04);
  }
}

// doblar la servilleta: dos pliegues, uno detrás de otro
export function fold() {
  if (!ready()) return;
  const t = ctx.currentTime;
  for (const at of [0.1, 0.55]) {
    burst(t + at, 0.14, [filter('bandpass', 1600, 0.7)], 0.09, 0.02);
    for (let i = 0; i < 3; i++) crackle(0.04 + Math.random() * 0.06, t + at + Math.random() * 0.06);
  }
}

// la bola sale volando de la mano
export function toss() {
  if (!ready()) return;
  burst(ctx.currentTime, 0.18, [filter('bandpass', 600, 0.5)], 0.04, 0.04);
}

// la bola cae (al suelo o contra el servilletero): golpe acolchado de papel, sin chasquido,
// más fuerte cuanto más rápido llega pero siempre flojo
let lastThud = 0;
export function thud(v) {
  if (!ready() || ctx.currentTime - lastThud < 0.06) return;
  const t = lastThud = ctx.currentTime;
  const k = Math.min(1, v / 500);
  burst(t, 0.16, [filter('lowpass', 280 + 260 * k, 0.5)], 0.2 * k, 0.025);
  if (k > 0.6) crackle(0.02 * k, t + 0.02);
}

// arrugar un poco al arrastrar la servilleta: crujidos según cuánto se ha arrugado de más
export function wrinkle(dk) {
  if (!ready() || dk <= 0) return;
  const t = ctx.currentTime, n = Math.floor(dk * 30 + Math.random());
  for (let i = 0; i < n; i++) crackle(0.025 + Math.random() * 0.06, t + Math.random() * 0.08);
}
