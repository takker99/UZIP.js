import { i32, u16, u8 } from "./shorthands.ts";

// fixed length extra bits
export const fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */ 0,
  0,
  /* impossible */ 0,
]);

// fixed distance extra bits
export const fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */ 0,
  0,
]);

// code length index map
export const clim = new u8([
  16,
  17,
  18,
  0,
  8,
  7,
  9,
  6,
  10,
  5,
  11,
  4,
  12,
  3,
  13,
  2,
  14,
  1,
  15,
]);

// get base, reverse index map from extra bits
const freb = (eb: Uint8Array, start: number) => {
  const b = new u16(31);
  for (let i = 0; i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  // numbers here are at max 18 bits
  const r = new i32(b[30]);
  for (let i = 1; i < 30; ++i) {
    for (let j = b[i]; j < b[i + 1]; ++j) {
      r[j] = ((j - b[i]) << 5) | i;
    }
  }
  return { b, r };
};

const { b: fl, r: revfl } = freb(fleb, 2);
// we can ignore the fact that the other numbers are wrong; they never happen anyway
fl[28] = 258, revfl[258] = 28;
const { b: fd, r: revfd } = freb(fdeb, 0);

// map of value to reverse (assuming 16 bits)
export const rev = new u16(32768);
for (let i = 0; i < 32768; ++i) {
  // reverse table algorithm from SO
  let x = ((i & 0xAAAA) >> 1) | ((i & 0x5555) << 1);
  x = ((x & 0xCCCC) >> 2) | ((x & 0x3333) << 2);
  x = ((x & 0xF0F0) >> 4) | ((x & 0x0F0F) << 4);
  rev[i] = (((x & 0xFF00) >> 8) | ((x & 0x00FF) << 8)) >> 1;
}

// create huffman tree from u8 "map": index -> code length for code index
// mb (max bits) must be at most 15
// TODO: optimize/split up?
export const hMap = (cd: Uint8Array, mb: number, r: 0 | 1) => {
  const s = cd.length;
  // index
  let i = 0;
  // u16 "map": index -> # of codes with bit length = index
  const l = new u16(mb);
  // length of cd must be 288 (total # of codes)
  for (; i < s; ++i) {
    if (cd[i]) ++l[cd[i] - 1];
  }
  // u16 "map": index -> minimum code for bit length = index
  const le = new u16(mb);
  for (i = 1; i < mb; ++i) {
    le[i] = (le[i - 1] + l[i - 1]) << 1;
  }
  let co: Uint16Array;
  if (r) {
    // u16 "map": index -> number of actual bits, symbol for code
    co = new u16(1 << mb);
    // bits to remove for reverser
    const rvb = 15 - mb;
    for (i = 0; i < s; ++i) {
      // ignore 0 lengths
      if (cd[i]) {
        // num encoding both symbol and bits read
        const sv = (i << 4) | cd[i];
        // free bits
        const r = mb - cd[i];
        // start value
        let v = le[cd[i] - 1]++ << r;
        // m is end value
        for (const m = v | ((1 << r) - 1); v <= m; ++v) {
          // every 16 bit value starting with the code yields the same result
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        co[i] = rev[le[cd[i] - 1]++] >> (15 - cd[i]);
      }
    }
  }
  return co;
};

// fixed length tree
export const flt = new u8(288);
for (let i = 0; i < 144; ++i) flt[i] = 8;
for (let i = 144; i < 256; ++i) flt[i] = 9;
for (let i = 256; i < 280; ++i) flt[i] = 7;
for (let i = 280; i < 288; ++i) flt[i] = 8;
// fixed distance tree
export const fdt = new u8(32);
for (let i = 0; i < 32; ++i) fdt[i] = 5;
// fixed length map
export const flm = /*#__PURE__*/ hMap(flt, 9, 0),
  flrm = /*#__PURE__*/ hMap(flt, 9, 1);
// fixed distance map
export const fdm = /*#__PURE__*/ hMap(fdt, 5, 0),
  fdrm = /*#__PURE__*/ hMap(fdt, 5, 1);

export { fl, revfl ,fd,revfd};