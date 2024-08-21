import { inflate } from "./inflate.ts";
import { err, InvalidZipData, UnknownCompressionMethod } from "./error.ts";
import { getUint16, getUint32, getUint64 } from "./bytes.ts";
import { u8 } from "./shorthands.ts";
import { decode } from "./str-buffer.ts";
import {
  END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE,
  MIN_END_OF_CENTRAL_DIRECTORY_SIZE,
  ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE,
} from "./constants.ts";

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

export const unzip = (data: Uint8Array, opts?: UnzipOptions): Unzipped => {
  const files: Unzipped = {};
  let e = data.length - MIN_END_OF_CENTRAL_DIRECTORY_SIZE;
  for (; getUint32(data, e) != END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE; --e) {
    // 0x10000 + 22 = 0x10016
    // 22 = 0x16
    if (!e || data.length - e > 0x10016) err(InvalidZipData);
  }

  // read total number of entries in the central dir on this disk: (2 bytes)
  // see APPNOTE.txt, section 4.4.21
  let c = getUint16(data, e + 8);
  if (!c) return {};

  // read offset of start of central directory with respect to the starting disk number: (4 bytes)
  // see APPNOTE.txt, section 4.4.24
  let o = getUint32(data, e + 16);

  /** whether the archive is in ZIP64 format */
  let z = o == 0xffffffff || c == 0xffff;
  if (z) {
    // read relative offset of the zip64 end of central directory record] (8 bytes)
    // see APPNOTE.txt, section 4.3.15
    const ze = getUint32(data, e - 12);
    z = getUint32(data, ze) == ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE;
    if (z) {
      // read total number of entries in the central dir on this disk: (8 bytes)
      // see APPNOTE.txt, section 4.4.21
      c = getUint32(data, ze + 32);

      // read offset of start of central directory with respect to the starting disk number: (8 bytes)
      // see APPNOTE.txt, section 4.4.24
      o = getUint32(data, ze + 48);
    }
  }
  const fltr = opts?.filter;
  for (let i = 0; i < c; ++i) {
    const [c, sc, su, fn, no, off] = readZipHeader(data, o, z),
      b = skipLocalFileHeader(data, off);
    o = no;
    if (
      fltr?.({
        name: fn,
        size: sc,
        originalSize: su,
        compression: c,
      })
    ) {
      if (!c) files[fn] = data.slice(b, b + sc);
      else if (c == 8) {
        files[fn] = inflate(data.subarray(b, b + sc), { out: new u8(su) });
      } else err(UnknownCompressionMethod, "unknown compression type " + c);
    }
  }
  return files;
};

/** skip a local file header
 *
 * see APPNOTE.txt section 4.3.7
 *
 * @param buffer - the buffer
 * @param byteOffset - the byte offset
 * @returns the new byte offset
 */
const skipLocalFileHeader = (buffer: Uint8Array, byteOffset: number): number =>
  byteOffset +
  30 +
  // file name length: (2 bytes)
  // see APPNOTE.txt section 4.4.10
  getUint16(buffer, byteOffset + 26) +
  // extra field length: (2 bytes)
  // see APPNOTE.txt section 4.4.11
  getUint16(buffer, byteOffset + 28);

/** read a central directory fle header
 *
 * see APPNOTE.txt section 4.3.12
 *
 * @param buffer - the buffer
 * @param byteOffset - the byte offset
 * @param isZip64 - whether the archive is in ZIP64 format
 */
const readZipHeader = (
  buffer: Uint8Array,
  byteOffset: number,
  isZip64: boolean,
): [number, number, number, string, number, number] => {
  /** file name length: (2 bytes)
   *
   * see APPNOTE.txt section 4.4.10
   */
  const fileNameLength = getUint16(buffer, byteOffset + 28);

  /** file name: (variable size)
   *
   * see APPNOTE.txt section 4.4.17
   */
  const fileName = decode(
    buffer.subarray(byteOffset + 46, byteOffset + 46 + fileNameLength),
    !(getUint16(buffer, byteOffset + 8) & 2048),
  );

  const es = byteOffset + 47 + fileNameLength;

  /** compressed size: (4 bytes)
   *
   * see APPNOTE.txt section 4.4.8
   */
  const bs = getUint32(buffer, byteOffset + 20);

  const [sc, su, off] = isZip64 && bs == 0xffffffff
    ? readZip64ExtraField(buffer, es)
    : [
      bs,
      // read uncompressed size: (4 bytes)
      // see APPNOTE.txt section 4.4.9
      getUint32(buffer, byteOffset + 24),
      // read relative offset of local header: (4 bytes)
      // see APPNOTE.txt section 4.4.16
      getUint32(buffer, byteOffset + 42),
    ];
  return [
    // read compression method: (2 bytes)
    // see APPNOTE.txt section 4.4.5
    getUint16(buffer, byteOffset + 10),
    sc,
    su,
    fileName,
    es +
    // read extra field length: (2 bytes)
    // see APPNOTE.txt section 4.4.11
    getUint16(buffer, byteOffset + 30) +
    // rad file comment length: (2 bytes)
    // see APPNOTE.txt section 4.4.12
    getUint16(buffer, byteOffset + 32),
    off,
  ];
};

/** read zip64 extra field */
const readZip64ExtraField = (
  buffer: Uint8Array,
  byteOffset: number,
): [number, number, number] => {
  for (
    ;
    getUint16(buffer, byteOffset) != 1;
    byteOffset += 4 + getUint16(buffer, byteOffset + 2)
  );
  return [
    // read compressed size: (8 bytes)
    // see APPNOTE.txt section 4.4.8
    getUint64(buffer, byteOffset + 12),
    // read uncompressed size: (8 bytes)
    // see APPNOTE.txt section 4.4.9
    getUint64(buffer, byteOffset + 4),
    getUint64(buffer, byteOffset + 20),
  ];
};
