import { err, InvalidHeader } from "./error.ts";
import { type InflateStreamOptions, inflt } from "./inflate.ts";
import { u8 } from "./shorthands.ts";

/**
 * Options for decompressing GZIP data
 */
export interface GunzipOptions extends InflateStreamOptions {
  /**
   * The buffer into which to write the decompressed data. GZIP already encodes the output size, so providing this doesn't save memory.
   *
   * Note that if the decompression result is larger than the size of this buffer, it will be truncated to fit.
   */
  out?: Uint8Array;
}

/**
 * Expands GZIP data
 * @param data The data to decompress
 * @param opts The decompression options
 * @returns The decompressed version of the data
 */

export const gunzipSync = (
  data: Uint8Array,
  opts?: GunzipOptions,
): Uint8Array => {
  const st = gzs(data);
  if (st + 8 > data.length) err(InvalidHeader, "invalid gzip data");
  return inflt(
    data.subarray(st, -8),
    { i: 2 },
    opts && opts.out || new u8(gzl(data)),
    opts && opts.dictionary,
  );
};
// gzip footer: -8 to -4 = CRC, -4 to -0 is length
// gzip start

export const gzs = (d: Uint8Array): number => {
  if (d[0] != 31 || d[1] != 139 || d[2] != 8) {
    err(InvalidHeader, "invalid gzip data");
  }
  const flg = d[3];
  let st = 10;
  if (flg & 4) st += (d[10] | d[11] << 8) + 2;
  for (
    let zs = (flg >> 3 & 1) + (flg >> 4 & 1);
    zs > 0;
    zs -= !d[st++] as unknown as number
  );
  return st + (flg & 2);
};
// gzip length

export const gzl = (d: Uint8Array): number => {
  const l = d.length;
  return (d[l - 4] | d[l - 3] << 8 | d[l - 2] << 16 | d[l - 1] << 24) >>> 0;
};
