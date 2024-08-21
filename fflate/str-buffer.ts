import { u8 } from "./shorthands.ts";

const te = /*#__PURE__*/ new TextEncoder();

/**
 * Converts a string into a Uint8Array for use with compression/decompression methods
 * @param str The string to encode
 * @param latin1 Whether or not to interpret the data as Latin-1. This should
 *               not need to be true unless decoding a binary string.
 * @returns The string encoded in UTF-8/Latin-1 binary
 */

export const encode = (str: string, latin1?: boolean): Uint8Array => {
  if (latin1) {
    const ar = new u8(str.length);
    for (let i = 0; i < str.length; ++i) ar[i] = str.charCodeAt(i);
    return ar;
  }
  return te.encode(str);
};

const td = /*#__PURE__*/ new TextDecoder();

/**
 * Converts a Uint8Array to a string
 * @param dat The data to decode to string
 * @param latin1 Whether or not to interpret the data as Latin-1. This should
 *               not need to be true unless encoding to binary string.
 * @returns The original UTF-8/Latin-1 string
 */

export const decode = (dat: Uint8Array, latin1?: boolean): string => {
  if (latin1) {
    let r = "";
    for (let i = 0; i < dat.length; i += 16384) {
      r += String.fromCharCode(...dat.subarray(i, i + 16384));
    }
    return r;
  }
  return td.decode(dat);
};
