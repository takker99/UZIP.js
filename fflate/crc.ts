/**  crc checking module
 *
 * @module
 */

export type CRCV = {
  p(d: Uint8Array): void;
  d(): number;
};

/** CRC32 table */
export const crct = /*#__PURE__*/ (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; ++i) {
    let c = i, k = 9;
    while (--k) c = ((c & 1) && -306674912) ^ (c >>> 1);
    t[i] = c;
  }
  return t;
})();

/** CRC32 */
export const crc = (): CRCV => {
  let c = -1;
  return {
    p(d) {
      // closures have awful performance
      let cr = c;
      for (let i = 0; i < d.length; ++i) {
        cr = crct[(cr & 255) ^ d[i]] ^ (cr >>> 8);
      }
      c = cr;
    },
    d() {
      return ~c;
    },
  };
};

/** Adler32 */
export const adler = (): CRCV => {
  let a = 1, b = 0;
  return {
    p(d) {
      // closures have awful performance
      let n = a, m = b;
      const l = d.length | 0;
      for (let i = 0; i != l;) {
        const e = Math.min(i + 2655, l);
        for (; i < e; ++i) m += n += d[i];
        n = (n & 65535) + 15 * (n >> 16), m = (m & 65535) + 15 * (m >> 16);
      }
      a = n, b = m;
    },
    d() {
      a %= 65521, b %= 65521;
      return (a & 255) << 24 | (a & 0xFF00) << 8 | (b & 255) << 8 | (b >> 8);
    },
  };
};
