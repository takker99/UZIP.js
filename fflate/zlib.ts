import { setUint } from "./bytes.ts";
import { alder32 } from "./alder32.ts";
import { type DeflateOptions, dopt } from "./deflate.ts";

/**
 * Options for compressing data into a Zlib format
 */
export interface ZlibOptions extends DeflateOptions {}

/**
 * Compress data with Zlib
 * @param data The data to compress
 * @param opts The compression options
 * @returns The zlib-compressed version of the data
 */

export const zlib = (data: Uint8Array, opts?: ZlibOptions): Uint8Array => {
  if (!opts) opts = {};
  const a = alder32(data);
  const d = dopt(data, opts, opts.dictionary ? 6 : 2, 4);
  return zlh(d, opts), setUint(d, d.length - 4, a), d;
};

/** zlib header */
const zlh = (c: Uint8Array, o: ZlibOptions): void => {
  const lv = o.level ?? 0, fl = lv == 0 ? 0 : lv < 6 ? 1 : lv == 9 ? 3 : 2;
  // @ts-ignore why?
  c[0] = 120, c[1] = (fl << 6) | (o.dictionary && 32);
  c[1] |= 31 - ((c[0] << 8) | c[1]) % 31;
  if (o.dictionary) {
    setUint(c, 2, alder32(o.dictionary));
  }
};
