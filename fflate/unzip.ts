import { inflate } from "./inflate.ts";
import { err, InvalidZipData, UnknownCompressionMethod } from "./error.ts";
import { getUint16, getUint32, getUint64 } from "./bytes.ts";
import { u8 } from "./shorthands.ts";
import { decode } from "./str-buffer.ts";
import {
  END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE,
  MIN_END_OF_CENTRAL_DIRECTORY_SIZE,
  MIN_LOCAL_FILE_HEADER_SIZE,
  ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE,
} from "./constants.ts";

/**
 * An unzipped archive. The full path of each file is used as the key,
 * and the file is the value
 */
export interface Unzipped {
  /** The files in the archive
   *
   * Each key is the full path of the file, and the value is the file itself.
   */
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
 * Options for expanding a ZIP archive
 */
export interface UnzipOptions {
  /**
   * A filter function to extract only certain files from a ZIP archive
   */
  filter?: UnzipFileFilter;
}

/**
 * Synchronously decompresses a ZIP archive. Prefer using `unzip` for better
 * performance with more than one file.
 * @param data The raw compressed ZIP file
 * @param opts The ZIP extraction options
 * @returns The decompressed files
 */
export const unzip = (data: Uint8Array, opts?: UnzipOptions): Unzipped => {
  const files: Unzipped = {};
  let e = data.length - MIN_END_OF_CENTRAL_DIRECTORY_SIZE;
  for (; getUint32(data, e) != END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE; --e) {
    // 0x10000 + 22 = 0x10016
    // 22 = 0x16
    if (!e || data.length - e > 0x10016) err(InvalidZipData);
  }

  /** The total number of entries in the central directory on this disk
   *
   * the size is 2 bytes if the archive is not in ZIP64 format, and 8 bytes otherwise
   *
   * see APPNOTE.txt, section 4.4.21
   */
  let centralDirectoryCount = getUint16(data, e + 8);
  if (!centralDirectoryCount) return {};

  /** The offset of start of central directory with respect to the starting disk number
   *
   * the size is 2 bytes if the archive is not in ZIP64 format, and 8 bytes otherwise
   *
   * see APPNOTE.txt, section 4.4.24
   */
  let centralDirectoryOffset = getUint32(data, e + 16);

  /** whether the archive is in ZIP64 format */
  let isZip64 = centralDirectoryOffset == 0xffffffff ||
    centralDirectoryCount == 0xffff;
  if (isZip64) {
    /** relative offset of the zip64 end of central directory record (8 bytes)
     *
     * see APPNOTE.txt, section 4.3.15
     */
    const zip64EndOfCentralDirectoryRecordOffset = getUint32(data, e - 12);
    isZip64 = getUint32(data, zip64EndOfCentralDirectoryRecordOffset) ==
      ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE;
    if (isZip64) {
      // read total number of entries in the central dir on this disk: (8 bytes)
      // see APPNOTE.txt, section 4.4.21
      centralDirectoryCount = getUint32(
        data,
        zip64EndOfCentralDirectoryRecordOffset + 32,
      );

      // read offset of start of central directory with respect to the starting disk number: (8 bytes)
      // see APPNOTE.txt, section 4.4.24
      centralDirectoryOffset = getUint32(
        data,
        zip64EndOfCentralDirectoryRecordOffset + 48,
      );
    }
  }
  const fltr = opts?.filter;
  for (let _ = 0; _ < centralDirectoryCount; ++_) {
    const [
      compressionMethod,
      compressedSize,
      uncompressedSize,
      fileName,
      nextOffset,
      localFileHeaderOffset,
    ] = readZipHeader(
      data,
      centralDirectoryOffset,
      isZip64,
    );
    centralDirectoryOffset = nextOffset;
    if (
      !fltr?.({
        name: fileName,
        size: compressedSize,
        originalSize: uncompressedSize,
        compression: compressionMethod,
      })
    ) {
      continue;
    }
    const fileDataOffset = getFileDataOffset(data, localFileHeaderOffset);
    if (!compressionMethod) {
      files[fileName] = data.slice(
        fileDataOffset,
        fileDataOffset + compressedSize,
      );
    } else if (compressionMethod == 8) {
      files[fileName] = inflate(
        data.subarray(fileDataOffset, fileDataOffset + compressedSize),
        { out: new u8(uncompressedSize) },
      );
    } else {err(
        UnknownCompressionMethod,
        "unknown compression type " + compressionMethod,
      );}
  }
  return files;
};

/** get a file data offset
 *
 * see APPNOTE.txt section 4.3.7
 *
 * @param buffer - the buffer
 * @param LocalFileHeaderOffset - the offset of the local file header
 * @returns the offset of the file data
 */
const getFileDataOffset = (buffer: Uint8Array, LocalFileHeaderOffset: number): number =>
  LocalFileHeaderOffset +
  MIN_LOCAL_FILE_HEADER_SIZE +
  // file name length: (2 bytes)
  // see APPNOTE.txt section 4.4.10
  getUint16(buffer, LocalFileHeaderOffset + 26) +
  // extra field length: (2 bytes)
  // see APPNOTE.txt section 4.4.11
  getUint16(buffer, LocalFileHeaderOffset + 28);

/** read a central directory file header
 *
 * see APPNOTE.txt section 4.3.12
 *
 * @param buffer - the buffer
 * @param centralDirectoryOffset - the offset of the central directory file header
 * @param isZip64 - whether the archive is in ZIP64 format
 * @returns the tuple containing:
 * 1. the compression method
 * 2. the compressed size
 * 3. the uncompressed size
 * 4. the file name
 * 5. the offset of the next central directory file header
 * 6. the relative offset of local header
 */
const readZipHeader = (
  buffer: Uint8Array,
  centralDirectoryOffset: number,
  isZip64: boolean,
): [number, number, number, string, number, number] => {
  /** file name length: (2 bytes)
   *
   * see APPNOTE.txt section 4.4.10
   */
  const fileNameLength = getUint16(buffer, centralDirectoryOffset + 28);

  /** file name: (variable size)
   *
   * see APPNOTE.txt section 4.4.17
   */
  const fileName = decode(
    buffer.subarray(centralDirectoryOffset + 46, centralDirectoryOffset + 46 + fileNameLength),
    !(getUint16(buffer, centralDirectoryOffset + 8) & 2048),
  );

  const extraFieldOffset = centralDirectoryOffset +
    46 + // total minimum bytes required for a central directory file header (46 bytes)
    fileNameLength;

  /** compressed size: (4 bytes)
   *
   * see APPNOTE.txt section 4.4.8
   */
  const compressedSize32 = getUint32(buffer, centralDirectoryOffset + 20);

  const [compressedSize, uncompressedSize, localFileHeaderOffset] =
    isZip64 && compressedSize32 == 0xffffffff
      ? readZip64ExtraField(buffer, extraFieldOffset)
      : [
        compressedSize32,
        // read uncompressed size: (4 bytes)
        // see APPNOTE.txt section 4.4.9
        getUint32(buffer, centralDirectoryOffset + 24),
        // read relative offset of local header: (4 bytes)
        // see APPNOTE.txt section 4.4.16
        getUint32(buffer, centralDirectoryOffset + 42),
      ];
  return [
    // read compression method: (2 bytes)
    // see APPNOTE.txt section 4.4.5
    getUint16(buffer, centralDirectoryOffset + 10),
    compressedSize,
    uncompressedSize,
    fileName,
    extraFieldOffset +
    // read extra field length: (2 bytes)
    // see APPNOTE.txt section 4.4.11
    getUint16(buffer, centralDirectoryOffset + 30) +
    // rad file comment length: (2 bytes)
    // see APPNOTE.txt section 4.4.12
    getUint16(buffer, centralDirectoryOffset + 32),
    localFileHeaderOffset,
  ];
};

/** read part of a Zip64 extended information extra field
 *
 * This is located in an extra field
 *
 * see APPNOTE.txt section 4.5.3
 *
 * @param buffer - the buffer
 * @param extraFieldOffset - the offset of the extra field
 * @returns the tuple containing:
 * 1. the compressed size
 * 2. the uncompressed size
 * 3. the relative offset of local header
 */
const readZip64ExtraField = (
  buffer: Uint8Array,
  extraFieldOffset: number,
): [number, number, number] => {
  for (
    ;
    getUint16(buffer, extraFieldOffset) != 1;
    extraFieldOffset += 4 + getUint16(buffer, extraFieldOffset + 2)
  );
  return [
    // read compressed size: (8 bytes)
    // see APPNOTE.txt section 4.4.8
    getUint64(buffer, extraFieldOffset + 12),
    // read uncompressed size: (8 bytes)
    // see APPNOTE.txt section 4.4.9
    getUint64(buffer, extraFieldOffset + 4),
    // read relative offset of local header: (8 bytes)
    // see APPNOTE.txt section 4.4.16
    getUint64(buffer, extraFieldOffset + 20),
  ];
};
