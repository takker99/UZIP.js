import { encode } from "./str-buffer.ts";
import {
  err,
  ExtraFieldTooLong,
  FilenameTooLong,
  InvalidDate,
} from "./error.ts";
import { mrg } from "./mrg.ts";
import {
  flatten,
  type ZipAttributes,
  type ZipOptions,
  type Zippable,
} from "./zippable.ts";
import { deflate } from "./deflate.ts";
import * as crcTs from "./crc32.ts";
import { u8 } from "./shorthands.ts";
import { setUint } from "./bytes.ts";
import { END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE } from "./constants.ts";

/**
 * Synchronously creates a ZIP file. Prefer using `zip` for better performance
 * with more than one file.
 * @param data The directory structure for the ZIP archive
 * @param opts The main options, merged with per-file options
 * @returns The generated ZIP archive
 */
export const zip = (data: Zippable, opts?: ZipOptions): Uint8Array => {
  const r = flatten(data, "", opts ?? {});
  const files: ZipData[] = [];
  let o = 0;
  let tot = 0;
  for (const fileName in r) {
    const [file, p] = r[fileName];
    const compression = p.level == 0 ? 0 : 8;
    const encodedFileName = encode(fileName);
    const encodedFileNameLength = encodedFileName.length;
    if (encodedFileNameLength > 0xffff) err(FilenameTooLong);
    const comment = p.comment;
    const encodedComment = comment ? encode(comment) : undefined;
    const ms = encodedComment?.length;
    const exl = extraFieldLength(p.extra);
    const buffer = compression ? deflate(file, p) : file;
    const l = buffer.length;
    files.push(mrg(p, {
      size: file.length,
      crc: crcTs.crc32(file),
      c: buffer,
      f: encodedFileName,
      m: encodedComment,
      u: encodedFileNameLength != fileName.length ||
        (encodedComment != undefined && (comment?.length != ms)),
      o,
      compression,
    }));
    o += 30 + encodedFileNameLength + exl + l;
    tot += 76 + 2 * (encodedFileNameLength + exl) + (ms ?? 0) + l;
  }
  const out = new u8(tot + 22), oe = o, cdl = tot - o;
  for (let i = 0; i < files.length; ++i) {
    const f = files[i];
    writeZipHeader(out, f.o, f);
    const badd = 30 + f.f.length + extraFieldLength(f.extra);
    out.set(f.c, f.o + badd);
    writeZipHeader(out, o, f, f.o, f.m),
      o += 16 + badd + (f.m ? f.m.length : 0);
  }
  writeZipFooter(out, o, files.length, cdl, oe);
  return out;
};

interface ZipData extends ZipHeaderFile {
  /** compressed data */
  c: Uint8Array;
  /**  filename */
  f: Uint8Array;
  /** comment */
  m?: Uint8Array;
  /** unicode */
  u: boolean;
  /** offset */
  o: number;
}

/**
 * A stream that can be used to create a file in a ZIP archive
 */
interface ZipInputFile extends ZipAttributes {
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
}

/** zip header file */
interface ZipHeaderFile extends Omit<ZipInputFile, "filename"> {}

/** calculate extra field length
 *
 * see APPNOTE.txt, section 4.4.11
 *
 * @param extra - The extra field to calculate the length of
 * @returns The total length of the extra fields
 */
const extraFieldLength = (extra?: ZipHeaderFile["extra"]): number => {
  if (!extra) return 0;
  let le = 0;
  for (const k in extra) {
    const l = extra[k].length;
    if (l > 0xffff) err(ExtraFieldTooLong);
    // add the data size (`l`), the size of an ID field (2 bytes), and the size of a data size field (2 bytes)
    // see APPNOTE.txt, section 4.5.1
    le += l + 4;
  }
  return le;
};

const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

/** write zip header
 *
 * This function writes a local file header or a central directory file header.
 * The specification for the former is described in PKZIP's APPNOTE.txt, section 4.3.7.
 * The one for the latter is described in PKZIP's APPNOTE.txt, section 4.3.12.
 *
 * @param buffer - The buffer to write to
 * @param byteOffset - The offset to write at
 * @param file - The file to write
 * @param ce - The relative offset of the local header (only for central directory file headers, see APPNOTE.txt, section 4.4.16)
 * @param comment - The file comment (only for central directory file headers, see APPNOTE.txt, section 4.4.18)
 * @returns The new byte offset
 */
const writeZipHeader = (
  buffer: Uint8Array,
  byteOffset: number,
  file: ZipData,
  ce?: number,
  comment?: Uint8Array,
): number => {
  const fileName = file.f;
  const unicode = file.u;
  const compressedSize = file.c.length;

  // write the signature (4 bytes)
  setUint(
    buffer,
    byteOffset,
    ce != null
      ? CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE
      : LOCAL_FILE_HEADER_SIGNATURE,
  ), byteOffset += 4;

  // write the version needed to extract: (2 bytes)
  // see APPNOTE.txt, section 4.4.3.
  //
  // 20 represents version 2.0, which supports as follows:
  // - File is a volume label
  // - File is a folder (directory)
  // - File is compressed using Deflate compression
  // - File is encrypted using traditional PKWARE encryption
  buffer[byteOffset] = 20;

  // write version made by: (2 bytes)
  // this field only exists in central directory file headers
  // see APPNOTE.txt, section 4.4.2.
  if (ce != null) buffer[++byteOffset] = file.os!, byteOffset++;
  else byteOffset += 2;

  // write general purpose bit flag: (2 bytes)
  // see APPNOTE.txt, section 4.4.4.
  buffer[byteOffset++] = (file.flag! << 1) | (compressedSize < 0 ? 8 : 0);
  // Bit 11: language encoding
  buffer[byteOffset++] = unicode ? 8 : 0;

  // write compression method: (2 bytes)
  // see APPNOTE.txt, section 4.4.5.
  buffer[byteOffset++] = file.compression & 0xff;
  buffer[byteOffset++] = file.compression >> 8;

  // write date and time fields: (2 bytes each)
  // see APPNOTE.txt, section 4.4.6.
  const dt = new Date(file.mtime == null ? Date.now() : file.mtime),
    y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119) err(InvalidDate);
  setUint(
    buffer,
    byteOffset,
    (y << 25) | ((dt.getMonth() + 1) << 21) | (dt.getDate() << 16) |
      (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1),
  ), byteOffset += 4;

  if (compressedSize != -1) {
    // write CRC-32: (4 bytes)
    // see APPNOTE.txt, section 4.4.7.
    setUint(buffer, byteOffset, file.crc);

    // write compressed size: (4 bytes)
    // see APPNOTE.txt, section 4.4.8.
    setUint(
      buffer,
      byteOffset + 4,
      compressedSize < 0 ? -compressedSize - 2 : compressedSize,
    );

    // write uncompressed size: (4 bytes)
    // see APPNOTE.txt, section 4.4.9.
    setUint(buffer, byteOffset + 8, file.size);
  }

  // write file name length: (2 bytes)
  // see APPNOTE.txt, section 4.4.10
  const fileNameLength = fileName.length;
  setUint(buffer, byteOffset + 12, fileNameLength);

  const extra = file.extra;
  const exl = extraFieldLength(extra);

  // write extra field length: (2 bytes)
  // see APPNOTE.txt, section 4.4.11
  setUint(buffer, byteOffset + 14, exl), byteOffset += 16;

  const commentLength = comment?.length;
  if (ce != null) {
    // These fields only exist in central directory file headers.

    // write file comment length: (2 bytes)
    // see APPNOTE.txt, section 4.4.12
    setUint(buffer, byteOffset, commentLength!);

    // skip disk number start: (2 bytes)
    // see APPNOTE.txt, section 4.4.13

    // skip internal file attributes: (2 bytes)
    // see APPNOTE.txt, section 4.4.14

    // write external file attributes: (4 bytes)
    // see APPNOTE.txt, section 4.4.15
    setUint(buffer, byteOffset + 6, file.attrs!);

    // write relative offset of local header: (4 bytes)
    // see APPNOTE.txt, section 4.4.16
    setUint(buffer, byteOffset + 10, ce);

    byteOffset += 14;
  }

  // write file name: (Variable)
  // see APPNOTE.txt, section 4.4.17
  buffer.set(fileName, byteOffset);
  byteOffset += fileNameLength;

  // write extra field: (Variable)
  // see APPNOTE.txt, section 4.4.28
  if (exl) {
    // You can find the current Header ID mappings defined by PKWARE in APPNOTE.txt, from section 4.5.2 to section 4.5.19.
    // You can also find third party mappings commonly used in APPNOTE.txt, section 4.6.
    for (const k in extra) {
      // write Header ID: (2 bytes)
      // see APPNOTE.txt, section 4.5.1
      setUint(buffer, byteOffset, +k);

      // @ts-ignore: we know this is a string
      const exf = extra[k];
      const l = exf.length;

      // write Data Size: (2 bytes)
      // see APPNOTE.txt, section 4.5.1
      setUint(buffer, byteOffset + 2, l);

      // write Data: (Variable)
      buffer.set(exf, byteOffset + 4);
      byteOffset += 4 + l;
    }
  }

  // write file comment: (Variable)
  // see APPNOTE.txt, section 4.4.18
  if (commentLength) {
    buffer.set(comment, byteOffset), byteOffset += commentLength;
  }
  return byteOffset;
};

/** write zip footer (end of central directory)
 *
 * This structure is described in PKZIP's APPNOTE.txt, section 4.3.16.
 *
 * @param buffer - The buffer to write to
 * @param byteOffset - The offset to write at
 * @param c - The total number of entries in the central dir
 * @param d - The size of the central directory
 * @param e - The offset of start of central directory with respect to the starting disk number
 */
const writeZipFooter = (
  buffer: Uint8Array,
  byteOffset: number,
  c: number,
  d: number,
  e: number,
): void => {
  // Signature: (4 bytes)
  setUint(buffer, byteOffset, END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE);

  // (Skip) number of this disk: (2 bytes)
  // see APPNOTE.txt, section 4.4.19.

  // (Skip) number of the disk with the start of the central directory: (2 bytes)
  // see APPNOTE.txt, section 4.4.20.

  // total number of entries in the central dir on this disk: (2 bytes)
  // see APPNOTE.txt, section 4.4.21.
  setUint(buffer, byteOffset + 8, c);

  // total number of entries in the central dir: (2 bytes)
  // see APPNOTE.txt, section 4.4.22.
  setUint(buffer, byteOffset + 10, c);

  // size of the central directory: (4 bytes)
  // see APPNOTE.txt, section 4.4.23.
  setUint(buffer, byteOffset + 12, d);

  // offset of start of central directory with respect to the starting disk number: (4 bytes)
  // see APPNOTE.txt, section 4.4.24.
  setUint(buffer, byteOffset + 16, e);

  // (Skip) .ZIP file comment length: (2 bytes)
  // see APPNOTE.txt, section 4.4.25.

  // (Skip) .ZIP file comment: (variable)
  // see APPNOTE.txt, section 4.4.26.
};
