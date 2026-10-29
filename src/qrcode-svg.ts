/**
 * [INPUT]: Bounded UTF-8 URI string (1..271 bytes, e.g. local RFC1918 socks5:// bridge link).
 * [OUTPUT]: Deterministic ISO/IEC 18004 QR Code boolean matrix and compact SVG path data (offline, zero network).
 * [POS]: Pure in-memory QR encoder for mobile proxy bridge onboarding; stores and transmits nothing.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */

type VersionSpec = {
  version: number;
  ecPerBlock: number;
  g1Blocks: number;
  g1Data: number;
  g2Blocks: number;
  g2Data: number;
  align: readonly number[];
};

// ISO/IEC 18004 Table 9 (Error Correction Level L, Versions 1..10)
const VERSION_SPECS_L: readonly VersionSpec[] = [
  {version: 1, ecPerBlock: 7, g1Blocks: 1, g1Data: 19, g2Blocks: 0, g2Data: 0, align: []},
  {version: 2, ecPerBlock: 10, g1Blocks: 1, g1Data: 34, g2Blocks: 0, g2Data: 0, align: [6, 18]},
  {version: 3, ecPerBlock: 15, g1Blocks: 1, g1Data: 55, g2Blocks: 0, g2Data: 0, align: [6, 22]},
  {version: 4, ecPerBlock: 20, g1Blocks: 1, g1Data: 80, g2Blocks: 0, g2Data: 0, align: [6, 26]},
  {version: 5, ecPerBlock: 26, g1Blocks: 1, g1Data: 108, g2Blocks: 0, g2Data: 0, align: [6, 30]},
  {version: 6, ecPerBlock: 18, g1Blocks: 2, g1Data: 68, g2Blocks: 0, g2Data: 0, align: [6, 34]},
  {version: 7, ecPerBlock: 20, g1Blocks: 2, g1Data: 78, g2Blocks: 0, g2Data: 0, align: [6, 22, 38]},
  {version: 8, ecPerBlock: 24, g1Blocks: 2, g1Data: 97, g2Blocks: 0, g2Data: 0, align: [6, 24, 42]},
  {version: 9, ecPerBlock: 30, g1Blocks: 2, g1Data: 116, g2Blocks: 0, g2Data: 0, align: [6, 26, 46]},
  {version: 10, ecPerBlock: 18, g1Blocks: 2, g1Data: 68, g2Blocks: 2, g2Data: 69, align: [6, 28, 50]},
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGeneratorPoly(degree);
  const rem = new Uint8Array(degree);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[degree - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < degree; j++) rem[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return rem;
}

function totalDataCodewords(spec: VersionSpec): number {
  return spec.g1Blocks * spec.g1Data + spec.g2Blocks * spec.g2Data;
}

function selectSpec(byteLen: number): VersionSpec {
  for (const spec of VERSION_SPECS_L) {
    const countBits = spec.version <= 9 ? 8 : 16;
    const capacityBits = totalDataCodewords(spec) * 8;
    if (4 + countBits + byteLen * 8 <= capacityBits) return spec;
  }
  throw new Error('QR payload exceeds V10-L capacity');
}

function buildCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const dataCapacity = totalDataCodewords(spec);
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  // Byte mode indicator = 0100
  pushBits(0b0100, 4);
  pushBits(bytes.length, spec.version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = dataCapacity * 8;
  const terminator = Math.min(4, maxBits - bits.length);
  pushBits(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(dataCapacity);
  const filled = bits.length / 8;
  for (let i = 0; i < filled; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
    dataBytes[i] = v;
  }
  const pads = [0xec, 0x11];
  for (let i = filled; i < dataCapacity; i++) dataBytes[i] = pads[(i - filled) & 1];

  const blocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < spec.g1Blocks; i++) {
    const slice = dataBytes.subarray(offset, offset + spec.g1Data);
    offset += spec.g1Data;
    blocks.push(slice);
    eccBlocks.push(rsRemainder(slice, spec.ecPerBlock));
  }
  for (let i = 0; i < spec.g2Blocks; i++) {
    const slice = dataBytes.subarray(offset, offset + spec.g2Data);
    offset += spec.g2Data;
    blocks.push(slice);
    eccBlocks.push(rsRemainder(slice, spec.ecPerBlock));
  }

  const maxDataLen = Math.max(spec.g1Data, spec.g2Data);
  const out: number[] = [];
  for (let col = 0; col < maxDataLen; col++) {
    for (const blk of blocks) if (col < blk.length) out.push(blk[col]);
  }
  for (let col = 0; col < spec.ecPerBlock; col++) {
    for (const ec of eccBlocks) out.push(ec[col]);
  }
  return new Uint8Array(out);
}

function formatBitsL(mask: number): number {
  // ECC Level L = 01
  const data = (0b01 << 3) | (mask & 0b111);
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) & 1 ? 0x537 : 0);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) & 1 ? 0x1f25 : 0);
  return (version << 12) | rem;
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function drawFormatInfo(modules: boolean[][], isFunc: boolean[][], mask: number) {
  const size = modules.length;
  const bits = formatBitsL(mask);
  const set = (r: number, c: number, bitIdx: number) => {
    modules[r][c] = ((bits >>> bitIdx) & 1) === 1;
    isFunc[r][c] = true;
  };
  for (let i = 0; i <= 5; i++) set(8, i, i);
  set(8, 7, 6);
  set(8, 8, 7);
  set(7, 8, 8);
  for (let i = 9; i < 15; i++) set(14 - i, 8, i);

  for (let i = 0; i < 8; i++) set(8, size - 1 - i, i);
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, i);
  modules[size - 8][8] = true;
  isFunc[size - 8][8] = true;
}

function penaltyScore(m: boolean[][]): number {
  const n = m.length;
  let score = 0;

  const linePenalty = (get: (i: number) => boolean) => {
    let runColor = get(0);
    let runLen = 1;
    for (let i = 1; i < n; i++) {
      const c = get(i);
      if (c === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runColor = c;
        runLen = 1;
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);

    for (let i = 0; i <= n - 7; i++) {
      if (get(i) && !get(i + 1) && get(i + 2) && get(i + 3) && get(i + 4) && !get(i + 5) && get(i + 6)) {
        const leftWhite = i >= 4 && !get(i - 1) && !get(i - 2) && !get(i - 3) && !get(i - 4);
        const rightWhite = i + 10 < n && !get(i + 7) && !get(i + 8) && !get(i + 9) && !get(i + 10);
        if (leftWhite || rightWhite) score += 40;
      }
    }
  };

  for (let r = 0; r < n; r++) linePenalty(c => m[r][c]);
  for (let c = 0; c < n; c++) linePenalty(r => m[r][c]);

  let dark = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) dark++;
      if (r < n - 1 && c < n - 1) {
        const v = m[r][c];
        if (m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v) score += 3;
      }
    }
  }
  const total = n * n;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  if (k > 0) score += k * 10;
  return score;
}

export function encodeQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) throw new Error('QR payload empty');
  const spec = selectSpec(bytes.length);
  const codewords = buildCodewords(bytes, spec);
  const size = spec.version * 4 + 17;

  const baseModules: boolean[][] = Array.from({length: size}, () => Array<boolean>(size).fill(false));
  const isFunc: boolean[][] = Array.from({length: size}, () => Array<boolean>(size).fill(false));

  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      baseModules[r][c] = dark;
      isFunc[r][c] = true;
    }
  };

  const drawFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(top + dr, left + dc, inOuter && (onBorder || inCore));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  for (const r of spec.align) {
    for (const c of spec.align) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunc(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  drawFormatInfo(baseModules, isFunc, 0);

  if (spec.version >= 7) {
    const vBits = versionBits(spec.version);
    for (let i = 0; i < 18; i++) {
      const dark = ((vBits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(b, a, dark);
      setFunc(a, b, dark);
    }
  }

  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!isFunc[r][c] && bitIdx < totalBits) {
          const byte = codewords[bitIdx >>> 3];
          baseModules[r][c] = ((byte >>> (7 - (bitIdx & 7))) & 1) === 1;
          bitIdx++;
        }
      }
    }
  }

  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestMatrix = baseModules;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = baseModules.map((row, r) =>
      row.map((val, c) => (isFunc[r][c] ? val : val !== maskBit(mask, r, c))),
    );
    drawFormatInfo(candidate, isFunc.map(row => [...row]), mask);
    const score = penaltyScore(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestMatrix = candidate;
    }
  }
  void bestMask;
  return bestMatrix;
}

export function renderQrSvgPath(matrix: readonly (readonly boolean[])[], quietZone = 2): {
  viewBoxSize: number;
  path: string;
} {
  const n = matrix.length;
  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        parts.push(`M${c + quietZone} ${r + quietZone}h1v1h-1z`);
      }
    }
  }
  return {viewBoxSize: n + quietZone * 2, path: parts.join('')};
}
