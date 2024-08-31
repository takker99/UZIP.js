import { encode } from "./str-buffer.ts";
import {
  type ExtraFieldTooLongError,
  extraFieldTooLongError,
  type FileNameTooLongError,
  fileNameTooLongError,
  type InvalidDateError,
  invalidDateError,
} from "./error.ts";
import {
  type CompressionMethodNumber,
  compressionNameToNumber,
  flatten,
  type ZipOptions,
  type Zippable,
} from "./zippable.ts";
import { setUintLE } from "@takker/bytes";
import { crc32 } from "@takker/crc";
import { u8 } from "./shorthands.ts";
import {
  CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE,
  END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE,
  LOCAL_FILE_HEADER_SIGNATURE,
  MIN_END_OF_CENTRAL_DIRECTORY_SIZE,
  MIN_LOCAL_FILE_HEADER_SIZE,
} from "./constants.ts";
import { createErr, createOk, isErr, type Result, unwrapOk } from "./result.ts";

/**
 * Synchronously creates a ZIP file. Prefer using `zip` for better performance
 * with more than one file.
 * @param data The directory structure for the ZIP archive
 * @param opts The main options, merged with per-file options
 * @returns The generated ZIP archive
 */
export const zip = (
  data: Zippable,
  opts?: ZipOptions,
): Result<
  Uint8Array,
  FileNameTooLongError | ExtraFieldTooLongError | InvalidDateError
> => {
  const files: ZipData[] = [];
  /** The offset of the next local file header */
  let o = 0;
  /** The total size of central directory file headers and local file headers */
  let tot = 0;
  for (const [fileName, file, p] of flatten(data, opts)) {
    const encodedFileName = encode(fileName);
    const encodedFileNameLength = encodedFileName.length;
    if (encodedFileNameLength > 0xffff) {
      return createErr(fileNameTooLongError(fileName));
    }
    const comment = p.comment;
    const encodedComment = comment ? encode(comment) : undefined;
    const encodedCommentLength = encodedComment?.length;
    const [compressionMethod, compress] = p.compression ?? [];
    const fileData = compress?.(file) ?? file;
    const compressedSize = fileData.length;
    const res = getExtraFieldLength(fileName, p.extra);
    if (isErr(res)) return res;
    const extraFieldLength = unwrapOk(res);
    files.push([
      o,
      fileData,
      encodedFileNameLength != fileName.length ||
      (!!encodedComment && (comment?.length != encodedCommentLength)),
      0,
      compressionMethod ? compressionNameToNumber[compressionMethod] : 0,
      p.mtime,
      crc32(file),
      compressedSize,
      file.length,
      encodedFileName,
      fileName,
      p.extra,
      extraFieldLength,
      p.attrs,
      p.os,
      encodedComment,
    ]);

    // add the size of the local file header
    o += MIN_LOCAL_FILE_HEADER_SIZE +
      encodedFileNameLength + // file name length
      extraFieldLength + // extra field length
      compressedSize; // file data length

    // add the size of the central directory file header and the local file header
    tot += 76 + // total minimum bytes required for a central directory file header (46 bytes) and a local file header (30 bytes)
      2 * (encodedFileNameLength + extraFieldLength) + // file name length and extra field length
      (encodedCommentLength ?? 0) + // file comment length
      compressedSize; // file data length
  }
  const zipComment = opts?.comment;
  const encodedZipComment = zipComment ? encode(zipComment) : undefined;
  const encodedZipCommentLength = encodedZipComment?.length ?? 0;
  /** The output buffer */
  const out = new u8(
    tot + MIN_END_OF_CENTRAL_DIRECTORY_SIZE + encodedZipCommentLength,
  );
  /** The offset of start of central directory with respect to the starting disk number */
  const oe = o;
  /** The total size of central directory file headers */
  const cdl = tot - o;
  for (const [offset, fileData, ...metadata] of files) {
    const res = writeZipHeader(out, offset, ...metadata);
    if (isErr(res)) return res;
    const fileDataOffset = unwrapOk(res);
    out.set(fileData, fileDataOffset);
    // In this loop, `o` represents the offset of the central directory file header
    writeZipHeader(out, o, ...metadata, offset);
    o +=
      // total minimum bytes required for a central directory file header (46 bytes) - MIN_LOCAL_FILE_HEADER_SIZE (30 bytes)
      16 +
      // the size of the local file header
      fileDataOffset - offset +
      // file comment length
      (metadata[13]?.length ?? 0);
  }
  writeEndOfCentralDirectory(
    out,
    o,
    files.length,
    cdl,
    oe,
    encodedZipComment,
    encodedZipCommentLength,
  );
  return createOk(out);
};

type ZipData = [
  // 0. offset of local file header
  number,
  // 1. compressed data
  Uint8Array,
  // 2. unicode
  boolean,
  // 3. flag
  number,
  // 4. compression method
  CompressionMethodNumber | 0,
  // 5. mtime
  Date | undefined,
  // 6. CRC-32
  number,
  // 7. compressed size
  number,
  // 8. uncompressed size
  number,
  // 9. filename
  Uint8Array,
  // 10. filename (string)
  string,
  // 11. extra
  Record<number, Uint8Array> | undefined,
  // 12. extra field length
  number,
  // 13. external file attributes
  number | undefined,
  // 14. os
  number | undefined,
  // 15. comment
  Uint8Array | undefined,
];

/** calculate extra field length
 *
 * see APPNOTE.txt, section 4.4.11
 *
 * @param extra - The extra field to calculate the length of
 * @returns The total length of the extra fields
 */
const getExtraFieldLength = (
  fileName: string,
  extra?: Record<number, Uint8Array>,
): Result<number, ExtraFieldTooLongError> => {
  if (!extra) return createOk(0);
  let le = 0;
  for (const k in extra) {
    const l = extra[k].length;
    // @ts-ignore k must be a number
    if (l > 0xffff) createErr(extraFieldTooLongError(fileName, k, extra[k]));
    // add the data size (`l`), the size of an ID field (2 bytes), and the size of a data size field (2 bytes)
    // see APPNOTE.txt, section 4.5.1
    le += l + 4;
  }
  return createOk(le);
};

/** write zip header
 *
 * This function writes a local file header or a central directory file header.
 * The specification for the former is described in PKZIP's APPNOTE.txt, section 4.3.7.
 * The one for the latter is described in PKZIP's APPNOTE.txt, section 4.3.12.
 *
 * @param buffer - The buffer to write to
 * @param byteOffset - The offset to write at
 * @param comment - The file comment (only for central directory file headers, see APPNOTE.txt, section 4.4.18)
 * @param localHeaderOffset - The relative offset of the local header (only for central directory file headers, see APPNOTE.txt, section 4.4.16)
 * @returns The new byte offset
 */
const writeZipHeader = (
  buffer: Uint8Array,
  byteOffset: number,
  unicode: boolean,
  flag: number,
  compressionMethod: CompressionMethodNumber | 0,
  mtime: Date | undefined,
  crc: number,
  compressedSize: number,
  uncompressedSize: number,
  fileName: Uint8Array,
  fileNameStr: string,
  extra: Record<number, Uint8Array> | undefined,
  extraFieldLength: number,
  externalFileAttributes?: number,
  os?: number,
  comment?: Uint8Array,
  localHeaderOffset?: number,
): Result<number, InvalidDateError> => {
  // write the signature (4 bytes)
  setUintLE(
    buffer,
    byteOffset,
    localHeaderOffset != null
      ? CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE
      : LOCAL_FILE_HEADER_SIGNATURE,
  );

  // write version made by: (2 bytes)
  // this field only exists in central directory file headers
  // see APPNOTE.txt, section 4.4.2.
  if (localHeaderOffset != null) buffer[byteOffset += 4] = os!, byteOffset += 2;
  else byteOffset += 4;

  // write the version needed to extract: (2 bytes)
  // see APPNOTE.txt, section 4.4.3.
  //
  // 20 represents version 2.0, which supports as follows:
  // - File is a volume label
  // - File is a folder (directory)
  // - File is compressed using Deflate compression
  // - File is encrypted using traditional PKWARE encryption
  buffer[byteOffset] = 20;
  byteOffset += 2;

  // write general purpose bit flag: (2 bytes)
  // see APPNOTE.txt, section 4.4.4.
  buffer[byteOffset++] = (flag << 1) | (compressedSize < 0 ? 8 : 0);
  // Bit 11: language encoding
  buffer[byteOffset++] = unicode ? 8 : 0;

  // write compression method: (2 bytes)
  // see APPNOTE.txt, section 4.4.5.
  setUintLE(buffer, byteOffset, compressionMethod);

  // write date and time fields: (2 bytes each)
  // see APPNOTE.txt, section 4.4.6.
  const dt = mtime ?? new Date();
  const y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119) return createErr(invalidDateError(fileNameStr, dt));
  setUintLE(
    buffer,
    byteOffset += 2,
    (y << 25) | ((dt.getMonth() + 1) << 21) | (dt.getDate() << 16) |
      (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1),
  ), byteOffset += 4;

  if (compressedSize != -1) {
    // write CRC-32: (4 bytes)
    // see APPNOTE.txt, section 4.4.7.
    setUintLE(buffer, byteOffset, crc);

    // write compressed size: (4 bytes)
    // see APPNOTE.txt, section 4.4.8.
    setUintLE(
      buffer,
      byteOffset + 4,
      compressedSize < 0 ? -compressedSize - 2 : compressedSize,
    );

    // write uncompressed size: (4 bytes)
    // see APPNOTE.txt, section 4.4.9.
    setUintLE(buffer, byteOffset + 8, uncompressedSize);
  }

  // write file name length: (2 bytes)
  // see APPNOTE.txt, section 4.4.10
  const fileNameLength = fileName.length;
  setUintLE(buffer, byteOffset + 12, fileNameLength);

  // write extra field length: (2 bytes)
  // see APPNOTE.txt, section 4.4.11
  setUintLE(buffer, byteOffset + 14, extraFieldLength), byteOffset += 16;

  const commentLength = comment?.length;
  if (localHeaderOffset != null) {
    // These fields only exist in central directory file headers.

    // write file comment length: (2 bytes)
    // see APPNOTE.txt, section 4.4.12
    if (commentLength) setUintLE(buffer, byteOffset, commentLength);

    // skip disk number start: (2 bytes)
    // see APPNOTE.txt, section 4.4.13

    // skip internal file attributes: (2 bytes)
    // see APPNOTE.txt, section 4.4.14

    // write external file attributes: (4 bytes)
    // see APPNOTE.txt, section 4.4.15
    if (externalFileAttributes) {
      setUintLE(buffer, byteOffset + 6, externalFileAttributes);
    }

    // write relative offset of local header: (4 bytes)
    // see APPNOTE.txt, section 4.4.16
    setUintLE(buffer, byteOffset + 10, localHeaderOffset);

    byteOffset += 14;
  }

  // write file name: (Variable)
  // see APPNOTE.txt, section 4.4.17
  buffer.set(fileName, byteOffset);
  byteOffset += fileNameLength;

  // write extra field: (Variable)
  // see APPNOTE.txt, section 4.4.28
  if (extraFieldLength) {
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
  return createOk(byteOffset);
};

/** write end of central directory
 *
 * This structure is described in PKZIP's APPNOTE.txt, section 4.3.16.
 *
 * @param buffer - The buffer to write to
 * @param endOfCentralDirectoryOffset - The offset to write at
 * @param centralDirectoryCount - The total number of entries in the central directory
 * @param centralDirectorySize - The size of the central directory
 * @param centralDirectoryOffsetWithDisk - The offset of start of central directory with respect to the starting disk number
 * @param comment - The .ZIP file comment
 * @param commentLength - The .ZIP file comment length
 */
const writeEndOfCentralDirectory = (
  buffer: Uint8Array,
  endOfCentralDirectoryOffset: number,
  centralDirectoryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffsetWithDisk: number,
  comment?: Uint8Array,
  commentLength?: number,
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

  if (comment && commentLength) {
    // .ZIP file comment length: (2 bytes)
    // see APPNOTE.txt, section 4.4.25.
    setUintLE(buffer, endOfCentralDirectoryOffset + 20, commentLength);

    // .ZIP file comment: (variable)
    // see APPNOTE.txt, section 4.4.26.
    buffer.set(comment, endOfCentralDirectoryOffset + 22);
  }
};
