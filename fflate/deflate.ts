import { shft, wbits, wbits16 } from "./bytes.ts";
import {
  codeLengthIndexMap,
  fixedDistanceExtraBits,
  fixedLengthExtraBits,
  revfd,
  revfl,
} from "./constants.ts";
import { clen, fdm, fdt, flm, flt, hMap, hTree, lc } from "./huffman-tree.ts";
import { i32, u16, u8 } from "./shorthands.ts";

export type DeflateState = {
  // head
  h?: Uint16Array;
  // prev
  p?: Uint16Array;
  // index
  i?: number;
  // end index
  z?: number;
  // wait index
  w?: number;
  // remainder byte info
  r?: number;
  // last chunk
  l: number;
};

/**
 * Options for compressing data into a DEFLATE format
 */
export interface DeflateOptions {
  /**
   * The level of compression to use, ranging from 0-9.
   *
   * 0 will store the data without compression.
   * 1 is fastest but compresses the worst, 9 is slowest but compresses the best.
   * The default level is 6.
   *
   * Typically, binary data benefits much more from higher values than text data.
   * In both cases, higher values usually take disproportionately longer than the reduction in final size that results.
   *
   * For example, a 1 MB text file could:
   * - become 1.01 MB with level 0 in 1ms
   * - become 400 kB with level 1 in 10ms
   * - become 320 kB with level 9 in 100ms
   */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /**
   * The memory level to use, ranging from 0-12. Increasing this increases speed and compression ratio at the cost of memory.
   *
   * Note that this is exponential: while level 0 uses 4 kB, level 4 uses 64 kB, level 8 uses 1 MB, and level 12 uses 16 MB.
   * It is recommended not to lower the value below 4, since that tends to hurt performance.
   * In addition, values above 8 tend to help very little on most data and can even hurt performance.
   *
   * The default value is automatically determined based on the size of the input data.
   */
  mem?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  /**
   * A buffer containing common byte sequences in the input data that can be used to significantly improve compression ratios.
   *
   * Dictionaries should be 32kB or smaller and include strings or byte sequences likely to appear in the input.
   * The decompressor must supply the same dictionary as the compressor to extract the original data.
   *
   * Dictionaries only improve aggregate compression ratio when reused across multiple small inputs. They should typically not be used otherwise.
   *
   * Avoid using dictionaries with GZIP and ZIP to maximize software compatibility.
   */
  dictionary?: Uint8Array;
}

/**
 * Compresses data with DEFLATE without any wrapper
 * @param data The data to compress
 * @param opts The compression options
 * @returns The deflated version of the data
 */
export const deflate = (
  data: Uint8Array,
  opts?: DeflateOptions,
): Uint8Array => dopt(data, opts || {}, 0, 0);

/** deflate with opts */
export const dopt = (
  dat: Uint8Array,
  opt: DeflateOptions,
  pre: number,
  post: number,
  st?: DeflateState,
): Uint8Array => {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      const dict = opt.dictionary.subarray(-32768);
      const newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(
    dat,
    opt.level == null ? 6 : opt.level,
    opt.mem == null
      ? (st.l
        ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5)
        : 20)
      : (12 + opt.mem),
    pre,
    post,
    st,
  );
};

/** compresses data into a raw DEFLATE buffer */
const dflt = (
  dat: Uint8Array,
  lvl: number,
  plvl: number,
  pre: number,
  post: number,
  st: DeflateState,
) => {
  const s = st.z || dat.length;
  const o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7000)) + post);
  // writing to this writes to the output buffer
  const w = o.subarray(pre, o.length - post);
  const lst = st.l;
  let pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos) w[0] = st.r! >> 3;
    const opt = deo[lvl - 1];
    const n = opt >> 13, c = opt & 8191;
    const msk = (1 << plvl) - 1;
    //    prev 2-byte val map    curr 2-byte val map
    const prev = st.p || new u16(32768), head = st.h || new u16(msk + 1);
    const bs1 = Math.ceil(plvl / 3), bs2 = 2 * bs1;
    const hsh = (i: number) =>
      (dat[i] ^ (dat[i + 1] << bs1) ^ (dat[i + 2] << bs2)) & msk;
    // 24576 is an arbitrary number of maximum symbols per block
    // 424 buffer for last block
    const syms = new i32(25000);
    // length/literal freq   distance freq
    const lf = new u16(288), df = new u16(32);
    //  l/lcnt  exbits  index          l/lind  waitdx          blkpos
    let lc = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (; i + 2 < s; ++i) {
      // hash value
      const hv = hsh(i);
      // index mod 32768    previous index mod
      let imod = i & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      // We always should modify head and prev, but only add symbols if
      // this data is not yet processed ("wait" for wait index)
      if (wi <= i) {
        // bytes remaining
        const rem = s - i;
        if ((lc > 7000 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
          li = lc = eb = 0, bs = i;
          for (let j = 0; j < 286; ++j) lf[j] = 0;
          for (let j = 0; j < 30; ++j) df[j] = 0;
        }
        //  len    dist   chain
        let l = 2, d = 0, ch = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i - dif)) {
          const maxn = Math.min(n, rem) - 1;
          const maxd = Math.min(32767, i);
          // max possible length
          // not capped at dif because decompressors implement "rolling" index population
          const ml = Math.min(258, rem);
          while (dif <= maxd && --ch && imod != pimod) {
            if (dat[i + l] == dat[i + l - dif]) {
              let nl = 0;
              for (; nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl);
              if (nl > l) {
                l = nl, d = dif;
                // break out early when we reach "nice" (we are satisfied enough)
                if (nl > maxn) break;
                // now, find the rarest 2-byte sequence within this
                // length of literals and search for that instead.
                // Much faster than just using the start
                const mmd = Math.min(dif, nl - 2);
                let md = 0;
                for (let j = 0; j < mmd; ++j) {
                  const ti = i - dif + j & 32767;
                  const pti = prev[ti];
                  const cd = ti - pti & 32767;
                  if (cd > md) md = cd, pimod = ti;
                }
              }
            }
            // check the previous match
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        // d will be nonzero only when a match was found
        if (d) {
          // store both dist and len data in one int32
          // Make sure this is recognized as a len/dist with 28th bit (2^28)
          syms[li++] = 268435456 | (revfl[l] << 18) | revfd[d];
          const lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fixedLengthExtraBits[lin] + fixedDistanceExtraBits[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i + l;
          ++lc;
        } else {
          syms[li++] = dat[i];
          ++lf[dat[i]];
        }
      }
    }
    for (i = Math.max(i, wi); i < s; ++i) {
      syms[li++] = dat[i];
      ++lf[dat[i]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
    if (!lst) {
      st.r = (pos & 7) | w[(pos / 8) | 0] << 3;
      // shft(pos) now 1 less if pos & 7 != 0
      pos -= 7;
      st.h = head, st.p = prev, st.i = i, st.w = wi;
    }
  } else {
    for (let i = st.w || 0; i < s + lst; i += 65535) {
      // end
      let e = i + 65535;
      if (e >= s) {
        // write final block
        w[(pos / 8) | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i, e));
    }
    st.i = s;
  }
  return o.slice(0, pre + shft(pos) + post);
};

// deflate options (nice << 13) | chain
const deo = /*#__PURE__*/ new i32([
  65540,
  131080,
  131088,
  131104,
  262176,
  1048704,
  1048832,
  2114560,
  2117632,
]);

/** writes a fixed block
 *
 * @returns the new bit pos
 */
const wfblk = (out: Uint8Array, pos: number, dat: Uint8Array): number => {
  // no need to write 00 as type: TypedArray defaults to 0
  const s = dat.length;
  const o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (let i = 0; i < s; ++i) out[o + i + 4] = dat[i];
  return (o + 4 + s) * 8;
};

/** writes a block */
const wblk = (
  dat: Uint8Array,
  out: Uint8Array,
  final: number,
  syms: Int32Array,
  lf: Uint16Array,
  df: Uint16Array,
  eb: number,
  li: number,
  bs: number,
  bl: number,
  p: number,
) => {
  wbits(out, p++, final);
  ++lf[256];
  const { t: dlt, l: mlb } = hTree(lf, 15);
  const { t: ddt, l: mdb } = hTree(df, 15);
  const { c: lclt, n: nlc } = lc(dlt);
  const { c: lcdt, n: ndc } = lc(ddt);
  const lcfreq = new u16(19);
  for (let i = 0; i < lclt.length; ++i) ++lcfreq[lclt[i] & 31];
  for (let i = 0; i < lcdt.length; ++i) ++lcfreq[lcdt[i] & 31];
  const { t: lct, l: mlcb } = hTree(lcfreq, 7);
  let nlcc = 19;
  for (; nlcc > 4 && !lct[codeLengthIndexMap[nlcc - 1]]; --nlcc);
  const flen = (bl + 5) << 3;
  const ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  const dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc +
    clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen) {
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  }
  let lm: Uint16Array, ll: Uint8Array, dm: Uint16Array, dl: Uint8Array;
  wbits(out, p, 1 + (dtlen < ftlen as unknown as number)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    const llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (let i = 0; i < nlcc; ++i) {
      wbits(out, p + 3 * i, lct[codeLengthIndexMap[i]]);
    }
    p += 3 * nlcc;
    const lcts = [lclt, lcdt];
    for (let it = 0; it < 2; ++it) {
      const clct = lcts[it];
      for (let i = 0; i < clct.length; ++i) {
        const len = clct[i] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15) wbits(out, p, (clct[i] >> 5) & 127), p += clct[i] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (let i = 0; i < li; ++i) {
    const sym = syms[i];
    if (sym > 255) {
      const len = (sym >> 18) & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7) {
        wbits(out, p, (sym >> 23) & 31), p += fixedLengthExtraBits[len];
      }
      const dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3) {
        wbits16(out, p, (sym >> 5) & 8191), p += fixedDistanceExtraBits[dst];
      }
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
