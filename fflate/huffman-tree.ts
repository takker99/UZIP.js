import { u16, u8 } from "./shorthands.ts";

/** empty */
const et = /*#__PURE__*/ new u8(0);

const makeRev = () => {
  const rev = new u16(32768);

  for (let i = 0; i < 32768; ++i) {
    // reverse table algorithm from SO
    let x = ((i & 0xAAAA) >> 1) | ((i & 0x5555) << 1);
    x = ((x & 0xCCCC) >> 2) | ((x & 0x3333) << 2);
    x = ((x & 0xF0F0) >> 4) | ((x & 0x0F0F) << 4);
    rev[i] = (((x & 0xFF00) >> 8) | ((x & 0x00FF) << 8)) >> 1;
  }
  return rev;
};

/** map of value to reverse (assuming 16 bits) */
const rev = /*#__PURE__*/ makeRev();

/** create huffman tree from u8 "map": index -> code length for code index
 *
 * mb (max bits) must be at most 15
 *
 * TODO: optimize/split up?
 */
export const hMap = (cd: Uint8Array, maxBits: number, r: 0 | 1) => {
  const s = cd.length;
  // index
  let i = 0;
  // u16 "map": index -> # of codes with bit length = index
  const l = new u16(maxBits);
  // length of cd must be 288 (total # of codes)
  for (; i < s; ++i) {
    if (cd[i]) ++l[cd[i] - 1];
  }
  // u16 "map": index -> minimum code for bit length = index
  const le = new u16(maxBits);
  for (i = 1; i < maxBits; ++i) {
    le[i] = (le[i - 1] + l[i - 1]) << 1;
  }
  let co: Uint16Array;
  if (r) {
    // u16 "map": index -> number of actual bits, symbol for code
    co = new u16(1 << maxBits);
    // bits to remove for reverser
    const rvb = 15 - maxBits;
    for (i = 0; i < s; ++i) {
      // ignore 0 lengths
      if (cd[i]) {
        // num encoding both symbol and bits read
        const sv = (i << 4) | cd[i];
        // free bits
        const r = maxBits - cd[i];
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

/** fixed length tree */
export const flt = new u8(288).fill(8, 0, 144).fill(9, 144, 256)
  .fill(7, 256, 280).fill(8, 280, 288);
/** fixed distance tree */
export const fdt = new u8(32).fill(5);
/** fixed length map */
export const flm = /*#__PURE__*/ hMap(flt, 9, 0);
export const flrm = /*#__PURE__*/ hMap(flt, 9, 1);
/** fixed distance map */
export const fdm = /*#__PURE__*/ hMap(fdt, 5, 0),
  fdrm = /*#__PURE__*/ hMap(fdt, 5, 1);

export type HuffNode = {
  // symbol
  s: number;
  // frequency
  f: number;
  // left child
  l?: HuffNode;
  // right child
  r?: HuffNode;
};

/** creates code lengths from a frequency table */
export const hTree = (d: Uint16Array, mb: number) => {
  // Need extra info to make a tree
  const t: HuffNode[] = [];
  for (let i = 0; i < d.length; ++i) {
    if (d[i]) t.push({ s: i, f: d[i] });
  }
  const s = t.length;
  const t2 = t.slice();
  if (!s) return { t: et, l: 0 };
  if (s == 1) {
    const v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort((a, b) => a.f - b.f);
  // after i2 reaches last ind, will be stopped
  // freq must be greater than largest possible number of symbols
  t.push({ s: -1, f: 25001 });
  let l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  // efficient algorithm from UZIP.js
  // i0 is lookbehind, i2 is lookahead - after processing two low-freq
  // symbols that combined have high freq, will start processing i2 (high-freq,
  // non-composite) symbols instead
  // see https://reddit.com/r/photopea/comments/ikekht/uzipjs_questions/
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i2].f ? i0++ : i2++];
    r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  let maxSym = t2[0].s;
  for (let i = 1; i < s; ++i) {
    if (t2[i].s > maxSym) maxSym = t2[i].s;
  }
  // code lengths
  const tr = new u16(maxSym + 1);
  // max bits in tree
  let mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    // more algorithms from UZIP.js
    // TODO: find out how this code works (debt)
    //  ind    debt
    let i = 0, dt = 0;
    //    left            cost
    const lft = mbt - mb, cst = 1 << lft;
    t2.sort((a, b) => tr[b.s] - tr[a.s] || a.f - b.f);
    for (; i < s; ++i) {
      const i2 = t2[i].s;
      if (tr[i2] > mb) {
        dt += cst - (1 << (mbt - tr[i2]));
        tr[i2] = mb;
      } else break;
    }
    dt >>= lft;
    while (dt > 0) {
      const i2 = t2[i].s;
      if (tr[i2] < mb) dt -= 1 << (mb - tr[i2]++ - 1);
      else ++i;
    }
    for (; i >= 0 && dt; --i) {
      const i2 = t2[i].s;
      if (tr[i2] == mb) {
        --tr[i2];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
/** get the max length and assign length codes */
export const ln = (n: HuffNode, l: Uint16Array, d: number): number => {
  return n.s == -1
    ? Math.max(ln(n.l!, l, d + 1), ln(n.r!, l, d + 1))
    : (l[n.s] = d);
};

/** length codes generation */
export const lc = (c: Uint8Array) => {
  let s = c.length;
  // Note that the semicolon was intentional
  while (s && !c[--s]);
  const cl = new u16(++s);
  //  ind      num         streak
  let cli = 0, cln = c[0], cls = 1;
  const w = (v: number) => {
    cl[cli++] = v;
  };
  for (let i = 1; i <= s; ++i) {
    if (c[i] == cln && i != s) {
      ++cls;
    } else {
      if (!cln && cls > 2) {
        for (; cls > 138; cls -= 138) w(32754);
        if (cls > 2) {
          w(cls > 10 ? ((cls - 11) << 5) | 28690 : ((cls - 3) << 5) | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (; cls > 6; cls -= 6) w(8304);
        if (cls > 2) w(((cls - 3) << 5) | 8208), cls = 0;
      }
      while (cls--) w(cln);
      cls = 1;
      cln = c[i];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};

/** calculate the length of output from tree, code lengths */
export const clen = (cf: Uint16Array, cl: Uint8Array) => {
  let l = 0;
  for (let i = 0; i < cl.length; ++i) l += cf[i] * cl[i];
  return l;
};
