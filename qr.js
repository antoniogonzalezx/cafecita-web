// ---------- Códigos QR, sin librerías ----------
// Lo justo para los enlaces de los bares (cafecita.app/<bar>/?o=…): modo byte (UTF-8),
// corrección de errores M (aguanta ~15 % de daño: una pegatina con una mancha sigue leyéndose)
// y versiones 1 a 6 (hasta 106 bytes), así que no hace falta el bloque de versión.
// Sigue la norma ISO/IEC 18004: Reed-Solomon sobre GF(256), patrones fijos, colocación en
// zigzag y la máscara con menos penalización.

// por versión (1…6), con corrección M: codewords totales, de corrección por bloque y bloques
const RAW = [0, 26, 44, 70, 100, 134, 172];
const ECC = [0, 10, 16, 26, 18, 24, 16];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4];
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
function codewords(bytes, ver) {
  const dataLen = RAW[ver] - ECC[ver] * BLOCKS[ver];
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
  // con corrección M y versiones 1…6 todos los bloques miden lo mismo
  const per = dataLen / BLOCKS[ver], div = rsDivisor(ECC[ver]), blocks = [];
  for (let b = 0; b < BLOCKS[ver]; b++) {
    const d = data.slice(b * per, (b + 1) * per);
    blocks.push({ d, e: rsRemainder(d, div) });
  }
  const out = [];
  for (let i = 0; i < per; i++) for (const bl of blocks) out.push(bl.d[i]);
  for (let i = 0; i < ECC[ver]; i++) for (const bl of blocks) out.push(bl.e[i]);
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

function build(ver, words, mask) {
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
  // la información de formato (corrección M = 00, y la máscara), con su BCH, en sus dos copias
  const data = mask;
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

// La matriz del QR para un texto: true = módulo oscuro
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const ver = [1, 2, 3, 4, 5, 6].find((v) => RAW[v] - ECC[v] * BLOCKS[v] - 2 >= bytes.length);
  if (!ver) throw new Error('QR: el enlace es demasiado largo');
  const words = codewords(bytes, ver);
  let best = null, bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = build(ver, words, mask), p = penalty(m);
    if (p < bestP) { bestP = p; best = m; }
  }
  return best;
}

// El QR como SVG de un color, con su margen (4 módulos, lo que pide la norma)
export function qrSvg(text, color = '#000') {
  const m = qrMatrix(text), n = m.length, q = 4;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" shape-rendering="crispEdges" role="img"><path fill="${color}" d="${d}"/></svg>`;
}
