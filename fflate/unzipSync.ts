import { inflateSync } from "./inflateSync.ts";
import { slzh, zh } from "./zip.ts";
import { err } from "./error.ts";
import { b2, b4, slc } from "./bytes.ts";
import { u8 } from "./shorthands.ts";

/**
 * An unzipped archive. The full path of each file is used as the key,
 * and the file is the value
 */
export interface Unzipped {
  [path: string]: Uint8Array;
}

/**
 * Information about a file to be extracted from a ZIP archive
 */
export interface UnzipFileInfo {
  /**
   * The name of the file
   */
  name: string;

  /**
   * The compressed size of the file
   */
  size: number;

  /**
   * The original size of the file
   */
  originalSize: number;

  /**
   * The compression format for the data stream. This number is determined by
   * the spec in PKZIP's APPNOTE.txt, section 4.4.5. For example, 0 = no
   * compression, 8 = deflate, 14 = LZMA. If the filter function returns true
   * but this value is not 8, the unzip function will throw.
   */
  compression: number;
}

/**
 * A filter for files to be extracted during the unzipping process
 * @param file The info for the current file being processed
 * @returns Whether or not to extract the current file
 */
export type UnzipFileFilter = (file: UnzipFileInfo) => boolean;

/**
 * Synchronously decompresses a ZIP archive. Prefer using `unzip` for better
 * performance with more than one file.
 * @param data The raw compressed ZIP file
 * @param opts The ZIP extraction options
 * @returns The decompressed files
 */

/**
 * Options for expanding a ZIP archive
 */
export interface UnzipOptions {
  /**
   * A filter function to extract only certain files from a ZIP archive
   */
  filter?: UnzipFileFilter;
}

export const unzipSync = (data: Uint8Array, opts?: UnzipOptions) => {
  const files: Unzipped = {};
  let e = data.length - 22;
  for (; b4(data, e) != 0x6054B50; --e) {
    if (!e || data.length - e > 65558) err(13);
  }
  let c = b2(data, e + 8);
  if (!c) return {};
  let o = b4(data, e + 16);
  let z = o == 4294967295 || c == 65535;
  if (z) {
    const ze = b4(data, e - 12);
    z = b4(data, ze) == 0x6064B50;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  const fltr = opts && opts.filter;
  for (let i = 0; i < c; ++i) {
    const [c, sc, su, fn, no, off] = zh(data, o, z), b = slzh(data, off);
    o = no;
    if (
      !fltr || fltr({
        name: fn,
        size: sc,
        originalSize: su,
        compression: c,
      })
    ) {
      if (!c) files[fn] = slc(data, b, b + sc);
      else if (c == 8) {
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      } else err(14, "unknown compression type " + c);
    }
  }
  return files;
};
