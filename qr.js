// ---------- Códigos QR, sin librerías ----------
// Lo justo para los enlaces de los bares (cafecita.app/<bar>/?o=…): modo byte (UTF-8),
// corrección de errores M (aguanta ~15 % de daño: una pegatina con una mancha sigue leyéndose)
// o H (~30 %: deja tapar el centro con el aspa) y versiones 1 a 6, así que no hace falta el
// bloque de versión.
// Sigue la norma ISO/IEC 18004: Reed-Solomon sobre GF(256), patrones fijos, colocación en
// zigzag y la máscara con menos penalización.

// por versión (1…6): codewords totales y, por nivel de corrección, los de corrección por bloque y los bloques
const RAW = [0, 26, 44, 70, 100, 134, 172];
const NIVELES = {
  M: { bits: 0b00, ecc: [0, 10, 16, 26, 18, 24, 16], blocks: [0, 1, 1, 1, 2, 2, 4] },
  H: { bits: 0b10, ecc: [0, 17, 28, 22, 16, 22, 28], blocks: [0, 1, 1, 2, 4, 4, 4] },
};
const datos = (v, n) => RAW[v] - n.ecc[v] * n.blocks[v];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

// GF(256) con el polinomio 0x11D
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const res = new Array(degree).fill(0);
  res[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < res.length; j++) {
      res[j] = gfMul(res[j], root);
      if (j + 1 < res.length) res[j] ^= res[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return res;
}
function rsRemainder(data, divisor) {
  const res = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ res.shift();
    res.push(0);
    divisor.forEach((coef, i) => { res[i] ^= gfMul(coef, factor); });
  }
  return res;
}

// los datos: modo byte, longitud, bytes, terminador y relleno, y luego la corrección por bloques
function codewords(bytes, ver, nivel) {
  const ECC = nivel.ecc[ver], BLOCKS = nivel.blocks[ver], dataLen = datos(ver, nivel);
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataLen * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad);
  // los bloques cortos van primero; los largos (versión 5 con H) llevan un codeword más
  const short = Math.floor(dataLen / BLOCKS), largos = dataLen % BLOCKS, div = rsDivisor(ECC), blocks = [];
  for (let b = 0, at = 0; b < BLOCKS; b++) {
    const len = short + (b >= BLOCKS - largos ? 1 : 0), d = data.slice(at, at + len);
    at += len;
    blocks.push({ d, e: rsRemainder(d, div) });
  }
  const out = [];
  for (let i = 0; i <= short; i++) for (const bl of blocks) if (i < bl.d.length) out.push(bl.d[i]);
  for (let i = 0; i < ECC; i++) for (const bl of blocks) out.push(bl.e[i]);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function build(ver, words, mask, nivel) {
  const size = 17 + 4 * ver;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const pos = ALIGN[ver];
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // la información de formato (el nivel de corrección y la máscara), con su BCH, en sus dos copias
  const data = (nivel.bits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const f = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((f >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
  // los datos, en zigzag de dos columnas desde abajo a la derecha
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
      if (fn[y][x] || k >= words.length * 8) continue;
      m[y][x] = ((words[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
      k++;
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
  return m;
}

// penalización de la norma: tiradas largas, bloques 2×2, falsos buscadores y equilibrio de oscuro
function penalty(m) {
  const n = m.length;
  let p = 0, dark = 0;
  const lines = [];
  for (let i = 0; i < n; i++) {
    lines.push(m[i].map((d) => (d ? 1 : 0)).join(''));
    lines.push(m.map((row) => (row[i] ? 1 : 0)).join(''));
  }
  for (const l of lines) {
    for (const run of l.match(/0+|1+/g)) if (run.length >= 5) p += run.length - 2;
    for (const pat of ['10111010000', '00001011101']) for (let i = l.indexOf(pat); i >= 0; i = l.indexOf(pat, i + 1)) p += 40;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) dark++;
    if (y < n - 1 && x < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  }
  return p + Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
}

// La matriz del QR para un texto (true = módulo oscuro), o null si no cabe con ese nivel
export function qrMatrix(text, ec = 'M') {
  const nivel = NIVELES[ec], bytes = [...new TextEncoder().encode(text)];
  const ver = [1, 2, 3, 4, 5, 6].find((v) => datos(v, nivel) - 2 >= bytes.length);
  if (!ver) {
    if (ec === 'M') throw new Error('QR: el enlace es demasiado largo');
    return null;
  }
  const words = codewords(bytes, ver, nivel);
  let best = null, bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = build(ver, words, mask, nivel), p = penalty(m);
    if (p < bestP) { bestP = p; best = m; }
  }
  return best;
}

// El QR como SVG de un color, con su margen (4 módulos, lo que pide la norma).
// centro: el dibujo (cuadro de -32 a 32) que va en un hueco en el centro; para eso el QR se
// hace con corrección H y el hueco no pasa de un 7 % de los módulos. Si el enlace no cabe con H,
// sale sin dibujo.
export function qrSvg(text, color = '#000', { centro = null } = {}) {
  const mH = centro ? qrMatrix(text, 'H') : null, m = mH || qrMatrix(text), n = m.length, q = 4;
  let k = 0;
  if (mH) { k = Math.round(n * .26); if (k % 2 === 0) k++; }
  const h0 = (n - k) / 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (k && x >= h0 && x < h0 + k && y >= h0 && y < h0 + k) continue;
    if (m[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
  }
  const dibujo = k ? `<svg x="${h0 + q + .5}" y="${h0 + q + .5}" width="${k - 1}" height="${k - 1}" viewBox="-32 -32 64 64" overflow="hidden"><g fill="${color}" color="${color}">${centro}</g></svg>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" role="img"><path fill="${color}" shape-rendering="crispEdges" d="${d}"/>${dibujo}</svg>`;
}
