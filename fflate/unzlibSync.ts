import { type InflateOptions, inflt } from "./inflateSync.ts";
import { err } from "./error.ts";

/**
 * Options for decompressing Zlib data
 */
export interface UnzlibOptions extends InflateOptions {}

/**
 * Expands Zlib data
 * @param data The data to decompress
 * @param opts The decompression options
 * @returns The decompressed version of the data
 */
export const unzlibSync = (
  data: Uint8Array,
  opts?: UnzlibOptions,
): Uint8Array =>
  inflt(
    data.subarray(zls(data, opts && opts.dictionary), -4),
    { i: 2 },
    opts && opts.out,
    opts && opts.dictionary,
  );


/** zlib start */
export const zls = (d: Uint8Array, dict?: unknown) => {
  if ((d[0] & 15) != 8 || (d[0] >> 4) > 7 || ((d[0] << 8 | d[1]) % 31)) {
    err(6, "invalid zlib data");
  }
  if ((d[1] >> 5 & 1) == +!dict) {
    err(
      6,
      "invalid zlib data: " + (d[1] & 32 ? "need" : "unexpected") +
        " dictionary",
    );
  }
  return (d[1] >> 3 & 4) + 2;
};