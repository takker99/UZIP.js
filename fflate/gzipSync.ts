import { setUint } from "./bytes.ts";
import * as crcTs from "./crc32.ts";
import { type DeflateOptions, dopt } from "./deflate.ts";

/*
 * Options for compressing data into a GZIP format
 */
export interface GzipOptions extends DeflateOptions {
  /**
   * When the file was last modified. Defaults to the current time.
   * Set this to 0 to avoid revealing a modification date entirely.
   */
  mtime?: Date | string | number;
  /**
   * The filename of the data. If the `gunzip` command is used to decompress the data, it will output a file
   * with this name instead of the name of the compressed file.
   */
  filename?: string;
}

/**
 * Compresses data with GZIP
 * @param data The data to compress
 * @param opts The compression options
 * @returns The gzipped version of the data
 */

export const gzipSync = (data: Uint8Array, opts?: GzipOptions): Uint8Array => {
  if (!opts) opts = {};
  const c = crcTs.crc32(data), l = data.length;
  const d = dopt(data, opts, gzhl(opts), 8), s = d.length;
  return gzh(d, opts), setUint(d, s - 8, c), setUint(d, s - 4, l), d;
};

/** gzip header */
export const gzh = (c: Uint8Array, o: GzipOptions): void => {
  const fn = o.filename;
  c[0] = 31,
    c[1] = 139,
    c[2] = 8,
    c[8] = (o.level ?? 0) < 2 ? 4 : o.level == 9 ? 2 : 0,
    c[9] = 3; // assume Unix
  if (o.mtime != 0) {
    setUint(
      c,
      4,
      Math.floor(
        (new Date(
          o.mtime as (string | number) || Date.now(),
        ) as unknown as number) / 1000,
      ),
    );
  }
  if (fn) {
    c[3] = 8;
    for (let i = 0; i <= fn.length; ++i) c[i + 10] = fn.charCodeAt(i);
  }
};

/** gzip header length */
export const gzhl = (o: GzipOptions): number =>
  10 + (o.filename ? o.filename.length + 1 : 0);
