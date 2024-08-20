/**
 * Byte Utilities
 * @module
 */
import { u8 } from "./shorthands.ts";

/** read 2 bytes */
export const b2 = (d: Uint8Array, b: number): number => d[b] | (d[b + 1] << 8);

/** read 4 bytes */

export const b4 = (d: Uint8Array, b: number): number =>
  (d[b] | (d[b + 1] << 8) | (d[b + 2] << 16) | (d[b + 3] << 24)) >>> 0;
/** read 8 bytes */
export const b8 = (d: Uint8Array, b: number): number =>
  b4(d, b) + (b4(d, b + 4) * 4294967296);

/** write bytes */
export const wbytes = (d: Uint8Array, b: number, v: number): void => {
  for (; v; ++b) d[b] = v, v >>>= 8;
};

/** read d, starting at bit p and mask with m */
export const bits = (d: Uint8Array, p: number, m: number): number => {
  const o = (p / 8) | 0;
  return ((d[o] | (d[o + 1] << 8)) >> (p & 7)) & m;
};

/** starting at p, write the minimum number of bits that can hold v to d */
export const wbits = (d: Uint8Array, p: number, v: number): void => {
  v <<= p & 7;
  const o = (p / 8) | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};

/** starting at p, write the minimum number of bits (>8) that can hold v to d */
export const wbits16 = (d: Uint8Array, p: number, v: number): void => {
  v <<= p & 7;
  const o = (p / 8) | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};

/** read d, starting at bit p continuing for at least 16 bits */
export const bits16 = (d: Uint8Array, p: number): number => {
  const o = (p / 8) | 0;
  return ((d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)) >> (p & 7));
};

/** get end of byte */
export const shft = (p: number): number => ((p + 7) / 8) | 0;

/** typed array slice - allows garbage collector to free original reference,
 *
 * while being more compatible than .slice
 */
export const slc = (v: Uint8Array, s: number, e?: number): Uint8Array => {
  if (s == null || s < 0) s = 0;
  if (e == null || e > v.length) e = v.length;
  // can't use .constructor in case user-supplied
  return new u8(v.subarray(s, e));
};