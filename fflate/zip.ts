import { encode } from "./str-buffer.ts";
import {
  err,
  ExtraFieldTooLong,
  FilenameTooLong,
  InvalidDate,
  UnknownCompressionMethod,
} from "./error.ts";
import { mrg } from "./mrg.ts";
import {
  flatten,
  type ZipAttributes,
  type ZipOptions,
  type Zippable,
} from "./zippable.ts";
import { setUintLE } from "@takker/bytes";
import { crc32 } from "@takker/crc";
import { u8 } from "./shorthands.ts";
import {
  END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE,
  MIN_END_OF_CENTRAL_DIRECTORY_SIZE,
  MIN_LOCAL_FILE_HEADER_SIZE,
} from "./constants.ts";

/**
 * Synchronously creates a ZIP file. Prefer using `zip` for better performance
 * with more than one file.
 * @param data The directory structure for the ZIP archive
 * @param opts The main options, merged with per-file options
 * @returns The generated ZIP archive
 */
export const zip = (data: Zippable, opts?: ZipOptions): Uint8Array => {
  const files: ZipData[] = [];
  /** The offset of the next local file header */
  let o = 0;
  /** The total size of central directory file headers and local file headers */
  let tot = 0;
  for (const [fileName, file, p] of flatten(data, "", opts ?? {})) {
    const compression = p.level == 0 ? 0 : 8;
    const encodedFileName = encode(fileName);
    const encodedFileNameLength = encodedFileName.length;
    if (encodedFileNameLength > 0xffff) err(FilenameTooLong);
    const comment = p.comment;
    const encodedComment = comment ? encode(comment) : undefined;
    const encodedCommentLength = encodedComment?.length;
    const fileData = compression ? p.deflate?.(file, p) : file;
    if (!fileData) err(UnknownCompressionMethod);
    files.push(mrg(p, {
      size: file.length,
      crc: crc32(file),
      c: fileData!,
      f: encodedFileName,
      m: encodedComment,
      u: encodedFileNameLength != fileName.length ||
        (!!encodedComment && (comment?.length != encodedCommentLength)),
      o,
      compression,
    }));

    const exl = extraFieldLength(p.extra);
    const l = fileData!.length;

    // add the size of the local file header
    o += MIN_LOCAL_FILE_HEADER_SIZE +
      encodedFileNameLength + // file name length
      exl + // extra field length
      l; // file data length

    // add the size of the central directory file header and the local file header
    tot += 76 + // total minimum bytes required for a central directory file header (46 bytes) and a local file header (30 bytes)
      2 * (encodedFileNameLength + exl) + // file name length and extra field length
      (encodedCommentLength ?? 0) + // file comment length
      l; // file data length
  }
  /** The output buffer */
  const out = new u8(tot + MIN_END_OF_CENTRAL_DIRECTORY_SIZE);
  /** The offset of start of central directory with respect to the starting disk number */
  const oe = o;
  /** The total size of central directory file headers */
  const cdl = tot - o;
  for (const file of files) {
    writeZipHeader(out, file.o, file);
    const localFileHeaderSize = MIN_LOCAL_FILE_HEADER_SIZE + file.f.length +
      extraFieldLength(file.extra);
    out.set(file.c, file.o + localFileHeaderSize);
    // In this loop, `o` represents the offset of the central directory file header
    writeZipHeader(out, o, file, file.o, file.m);
    o +=
      // total minimum bytes required for a central directory file header (46 bytes) - MIN_LOCAL_FILE_HEADER_SIZE (30 bytes)
      16 +
      // the size of the local file header
      localFileHeaderSize +
      // file comment length
      (file.m?.length ?? 0);
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
  setUintLE(
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
  setUintLE(
    buffer,
    byteOffset,
    (y << 25) | ((dt.getMonth() + 1) << 21) | (dt.getDate() << 16) |
      (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1),
  ), byteOffset += 4;

  if (compressedSize != -1) {
    // write CRC-32: (4 bytes)
    // see APPNOTE.txt, section 4.4.7.
    setUintLE(buffer, byteOffset, file.crc);

    // write compressed size: (4 bytes)
    // see APPNOTE.txt, section 4.4.8.
    setUintLE(
      buffer,
      byteOffset + 4,
      compressedSize < 0 ? -compressedSize - 2 : compressedSize,
    );

    // write uncompressed size: (4 bytes)
    // see APPNOTE.txt, section 4.4.9.
    setUintLE(buffer, byteOffset + 8, file.size);
  }

  // write file name length: (2 bytes)
  // see APPNOTE.txt, section 4.4.10
  const fileNameLength = fileName.length;
  setUintLE(buffer, byteOffset + 12, fileNameLength);

  const extra = file.extra;
  const exl = extraFieldLength(extra);

  // write extra field length: (2 bytes)
  // see APPNOTE.txt, section 4.4.11
  setUintLE(buffer, byteOffset + 14, exl), byteOffset += 16;

  const commentLength = comment?.length;
  if (ce != null) {
    // These fields only exist in central directory file headers.

    // write file comment length: (2 bytes)
    // see APPNOTE.txt, section 4.4.12
    setUintLE(buffer, byteOffset, commentLength!);

    // skip disk number start: (2 bytes)
    // see APPNOTE.txt, section 4.4.13

    // skip internal file attributes: (2 bytes)
    // see APPNOTE.txt, section 4.4.14

    // write external file attributes: (4 bytes)
    // see APPNOTE.txt, section 4.4.15
    setUintLE(buffer, byteOffset + 6, file.attrs!);

    // write relative offset of local header: (4 bytes)
    // see APPNOTE.txt, section 4.4.16
    setUintLE(buffer, byteOffset + 10, ce);

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
      setUintLE(buffer, byteOffset, +k);

      // @ts-ignore: we know this is a string
      const exf = extra[k];
      const l = exf.length;

      // write Data Size: (2 bytes)
      // see APPNOTE.txt, section 4.5.1
      setUintLE(buffer, byteOffset + 2, l);

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
 * @param endOfCentralDirectoryOffset - The offset to write at
 * @param centralDirectoryCount - The total number of entries in the central directory
 * @param centralDirectorySize - The size of the central directory
 * @param centralDirectoryOffsetWithDisk - The offset of start of central directory with respect to the starting disk number
 */
const writeZipFooter = (
  buffer: Uint8Array,
  endOfCentralDirectoryOffset: number,
  centralDirectoryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffsetWithDisk: number,
): void => {
  // Signature: (4 bytes)
  setUintLE(
    buffer,
    endOfCentralDirectoryOffset,
    END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE,
  );

  // (Skip) number of this disk: (2 bytes)
  // see APPNOTE.txt, section 4.4.19.

  // (Skip) number of the disk with the start of the central directory: (2 bytes)
  // see APPNOTE.txt, section 4.4.20.

  // total number of entries in the central dir on this disk: (2 bytes)
  // see APPNOTE.txt, section 4.4.21.
  setUintLE(buffer, endOfCentralDirectoryOffset + 8, centralDirectoryCount);

  // total number of entries in the central dir: (2 bytes)
  // see APPNOTE.txt, section 4.4.22.
  setUintLE(buffer, endOfCentralDirectoryOffset + 10, centralDirectoryCount);

  // size of the central directory: (4 bytes)
  // see APPNOTE.txt, section 4.4.23.
  setUintLE(buffer, endOfCentralDirectoryOffset + 12, centralDirectorySize);

  // offset of start of central directory with respect to the starting disk number: (4 bytes)
  // see APPNOTE.txt, section 4.4.24.
  setUintLE(
    buffer,
    endOfCentralDirectoryOffset + 16,
    centralDirectoryOffsetWithDisk,
  );

  // (Skip) .ZIP file comment length: (2 bytes)
  // see APPNOTE.txt, section 4.4.25.

  // (Skip) .ZIP file comment: (variable)
  // see APPNOTE.txt, section 4.4.26.
};
