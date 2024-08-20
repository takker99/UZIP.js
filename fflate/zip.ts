/**
 * The following is a port of the `zip` module from the fflate library.
 * @module
 */

import { strFromU8 } from "./buffer.ts";
import { b2, b4, b8, wbytes } from "./bytes.ts";
import { err, type FlateError } from "./error.ts";
import type { ZipAttributes } from "./zippable.ts";

/**
 * A terminable compression/decompression process
 */
export interface AsyncTerminable {
  /**
   * Terminates the worker thread immediately. The callback will not be called.
   */
  (): void;
}

/**
 * Handler for asynchronous data (de)compression streams
 * @param err Any error that occurred
 * @param data The data output from the stream processor
 * @param final Whether this is the final block
 */
export type AsyncFlateStreamHandler = (
  err: FlateError | null,
  data: Uint8Array,
  final: boolean,
) => void;

/** skip local zip header */
export const slzh = (d: Uint8Array, b: number): number =>
  b + 30 + b2(d, b + 26) + b2(d, b + 28);

/** read zip header */
export const zh = (
  d: Uint8Array,
  b: number,
  z: boolean,
): [number, number, number, string, number, number] => {
  const fnl = b2(d, b + 28),
    fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)),
    es = b + 46 + fnl,
    bs = b4(d, b + 20);
  const [sc, su, off] = z && bs == 4294967295
    ? z64e(d, es)
    : [bs, b4(d, b + 24), b4(d, b + 42)];
  return [
    b2(d, b + 10),
    sc,
    su,
    fn,
    es + b2(d, b + 30) + b2(d, b + 32),
    off,
  ];
};

/** read zip64 extra field */
export const z64e = (d: Uint8Array, b: number): [number, number, number] => {
  for (; b2(d, b) != 1; b += 4 + b2(d, b + 2));
  return [b8(d, b + 12), b8(d, b + 4), b8(d, b + 20)];
};

/**
 * A stream that can be used to create a file in a ZIP archive
 */
export interface ZipInputFile extends ZipAttributes {
  /**
   * The filename to associate with the data provided to this stream. If you
   * want a file in a subdirectory, use forward slashes as a separator (e.g.
   * `directory/filename.ext`). This will still work on Windows.
   */
  filename: string;

  /**
   * The size of the file in bytes. This attribute may be invalid after
   * the file is added to the ZIP archive; it must be correct only before the
   * stream completes.
   *
   * If you don't want to have to compute this yourself, consider extending the
   * ZipPassThrough class and overriding its process() method, or using one of
   * ZipDeflate or AsyncZipDeflate.
   */
  size: number;

  /**
   * A CRC of the original file contents. This attribute may be invalid after
   * the file is added to the ZIP archive; it must be correct only before the
   * stream completes.
   *
   * If you don't want to have to generate this yourself, consider extending the
   * ZipPassThrough class and overriding its process() method, or using one of
   * ZipDeflate or AsyncZipDeflate.
   */
  crc: number;

  /**
   * The compression format for the data stream. This number is determined by
   * the spec in PKZIP's APPNOTE.txt, section 4.4.5. For example, 0 = no
   * compression, 8 = deflate, 14 = LZMA
   */
  compression: number;

  /**
   * Bits 1 and 2 of the general purpose bit flag, specified in PKZIP's
   * APPNOTE.txt, section 4.4.4. Should be between 0 and 3. This is unlikely
   * to be necessary.
   */
  flag?: number;

  /**
   * The handler to be called when data is added. After passing this stream to
   * the ZIP file object, this handler will always be defined. To call it:
   *
   * `stream.ondata(error, chunk, final)`
   *
   * error = any error that occurred (null if there was no error)
   *
   * chunk = a Uint8Array of the data that was added (null if there was an
   * error)
   *
   * final = boolean, whether this is the final chunk in the stream
   */
  ondata?: AsyncFlateStreamHandler;

  /**
   * A method called when the stream is no longer needed, for clean-up
   * purposes. This will not always be called after the stream completes,
   * so you may wish to call this.terminate() after the final chunk is
   * processed if you have clean-up logic.
   */
  terminate?: AsyncTerminable;
}

/** zip header file */
export type ZHF = Omit<ZipInputFile, "terminate" | "ondata" | "filename">;

/** extra field length */
export const exfl = (ex?: ZHF["extra"]): number => {
  let le = 0;
  if (ex) {
    for (const k in ex) {
      const l = ex[k].length;
      if (l > 65535) err(9);
      le += l + 4;
    }
  }
  return le;
};

/** write zip header */
export const wzh = (
  d: Uint8Array,
  b: number,
  f: ZHF,
  fn: Uint8Array,
  u: boolean,
  c: number,
  ce?: number,
  co?: Uint8Array,
): number => {
  const fl = fn.length, ex = f.extra, col = co && co.length;
  const exl = exfl(ex);
  wbytes(d, b, ce != null ? 0x2014B50 : 0x4034B50), b += 4;
  if (ce != null) d[b++] = 20, d[b++] = f.os!;
  d[b] = 20, b += 2; // spec compliance? what's that?
  d[b++] = (f.flag! << 1) | (c < 0 ? 8 : 0), d[b++] = u ? 8 : 0;
  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
  const dt = new Date(f.mtime == null ? Date.now() : f.mtime),
    y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119) err(10);
  wbytes(
    d,
    b,
    (y << 25) | ((dt.getMonth() + 1) << 21) | (dt.getDate() << 16) |
      (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1),
  ), b += 4;
  if (c != -1) {
    wbytes(d, b, f.crc);
    wbytes(d, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d, b + 8, f.size);
  }
  wbytes(d, b + 12, fl);
  wbytes(d, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d, b, col!);
    wbytes(d, b + 6, f.attrs!);
    wbytes(d, b + 10, ce), b += 14;
  }
  d.set(fn, b);
  b += fl;
  if (exl) {
    for (const k in ex) {
      // @ts-ignore: we know this is a string
      const exf = ex[k], l = exf.length;
      wbytes(d, b, +k);
      wbytes(d, b + 2, l);
      d.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col) d.set(co, b), b += col;
  return b;
};

/** write zip footer (end of central directory) */
export const wzf = (
  o: Uint8Array,
  b: number,
  c: number,
  d: number,
  e: number,
): void => {
  wbytes(o, b, 0x6054B50); // skip disk
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d);
  wbytes(o, b + 16, e);
};
