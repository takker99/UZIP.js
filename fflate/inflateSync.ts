import { bits, bits16, shft, slc } from "./bytes.ts";
import { flrm, fdrm, clim, hMap, fleb, fl, fd, fdeb } from "./constants.ts";
import { err } from "./error.ts";
import { max } from "./max.ts";
import { u8 } from "./shorthands.ts";


/**
 * Options for decompressing a DEFLATE stream
 */
export interface InflateStreamOptions {
  /**
   * The dictionary used to compress the original data. If no dictionary was used during compression, this option has no effect.
   *
   * Supplying the wrong dictionary during decompression usually yields corrupt output or causes an invalid distance error.
   */
  dictionary?: Uint8Array;
}

/**
 * Options for decompressing DEFLATE data
 */
export interface InflateOptions extends InflateStreamOptions {
  /**
   * The buffer into which to write the decompressed data. Saves memory if you know the decompressed size in advance.
   *
   * Note that if the decompression result is larger than the size of this buffer, it will be truncated to fit.
   */
  out?: Uint8Array;
}

/**
 * Expands DEFLATE data with no wrapper
 * @param data The data to decompress
 * @param opts The decompression options
 * @returns The decompressed version of the data
 */
export const inflateSync = (
  data: Uint8Array,
  opts?: InflateOptions,
): Uint8Array =>
  inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);

// inflate state
export type InflateState = {
  // lmap
  l?: Uint16Array;
  // dmap
  d?: Uint16Array;
  // lbits
  m?: number;
  // dbits
  n?: number;
  // final
  f?: number;
  // pos
  p?: number;
  // byte
  b?: number;
  // lstchk
  i: number;
};

/** expands raw DEFLATE data */
export const inflt = (
  dat: Uint8Array,
  st: InflateState,
  buf?: Uint8Array,
  dict?: Uint8Array,
): Uint8Array => {
  // source length       dict length
  const sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l) return buf || new u8(0);
  const noBuf = !buf;
  // have to estimate size
  const resize = noBuf || st.i != 2;
  // no state
  const noSt = st.i;
  // Assumes roughly 33% compression ratio average
  buf ??= new u8(sl * 3);
  // ensure buffer can fit at least l elements
  const cbuf = (l: number) => {
    const bl = buf!.length;
    // need to increase size to fit
    if (l > bl) {
      // Double or set to necessary, whichever is greater
      const nbuf = new u8(Math.max(bl * 2, l));
      nbuf.set(buf!);
      buf = nbuf;
    }
  };
  //  last chunk         bitpos           bytes
  let final = st.f || 0,
    pos = st.p || 0,
    bt = st.b || 0,
    lm = st.l,
    dm = st.d,
    lbt = st.m,
    dbt = st.n;
  // total bits
  const tbts = sl * 8;
  do {
    if (!lm) {
      // BFINAL - this is only 1 when last chunk is next
      final = bits(dat, pos, 1);
      // type: 0 = no compression, 1 = fixed huffman, 2 = dynamic huffman
      const type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        // go to end of byte boundary
        const s = shft(pos) + 4, l = dat[s - 4] | (dat[s - 3] << 8), t = s + l;
        if (t > sl) {
          if (noSt) err(0);
          break;
        }
        // ensure size
        if (resize) cbuf(bt + l);
        // Copy over uncompressed data
        buf.set(dat.subarray(s, t), bt);
        // Get new bitpos, update byte count
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1) lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        //  literal                            lengths
        const hLit = bits(dat, pos, 31) + 257,
          hcLen = bits(dat, pos + 10, 15) + 4;
        const tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        // length+distance tree
        const ldt = new u8(tl);
        // code length tree
        const clt = new u8(19);
        for (let i = 0; i < hcLen; ++i) {
          // use index map to get real code
          clt[clim[i]] = bits(dat, pos + i * 3, 7);
        }
        pos += hcLen * 3;
        // code lengths bits
        const clb = max(clt), clbmsk = (1 << clb) - 1;
        // code lengths map
        const clm = hMap(clt, clb, 1);
        for (let i = 0; i < tl;) {
          const r = clm[bits(dat, pos, clbmsk)];
          // bits read
          pos += r & 15;
          // symbol
          const s = r >> 4;
          // code length to copy
          if (s < 16) {
            ldt[i++] = s;
          } else {
            //  copy   count
            let c = 0, n = 0;
            if (s == 16) n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
            else if (s == 17) n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18) n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--) ldt[i++] = c;
          }
        }
        //    length tree                 distance tree
        const lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        // max length bits
        lbt = max(lt);
        // max dist bits
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else err(1);
      if (pos > tbts) {
        if (noSt) err(0);
        break;
      }
    }
    // Make sure the buffer can hold this + the largest possible addition
    // Maximum chunk size (practically, theoretically infinite) is 2^17
    if (resize) cbuf(bt + 131072);
    const lms = (1 << lbt!) - 1, dms = (1 << dbt!) - 1;
    let lpos = pos;
    for (;; lpos = pos) {
      // bits read, code
      const c = lm![bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt) err(0);
        break;
      }
      if (!c) err(2);
      if (sym < 256) buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = undefined;
        break;
      } else {
        let add = sym - 254;
        // no extra bits needed if less
        if (sym > 264) {
          // index
          const i = sym - 257, b = fleb[i];
          add = bits(dat, pos, (1 << b) - 1) + fl[i];
          pos += b;
        }
        // dist
        const d = dm![bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d) err(3);
        pos += d & 15;
        let dt = fd[dsym];
        if (dsym > 3) {
          const b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt) err(0);
          break;
        }
        if (resize) cbuf(bt + 131072);
        const end = bt + add;
        if (bt < dt) {
          const shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0) err(3);
          for (; bt < dend; ++bt) buf[bt] = dict![shift + bt];
        }
        for (; bt < end; ++bt) buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm) final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  // don't reallocate for streams or user buffers
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
