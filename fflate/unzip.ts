import { type InvalidZipDataError, invalidZipDataError } from "./error.ts";
import { decode } from "./str-buffer.ts";
import {
  END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE,
  MIN_END_OF_CENTRAL_DIRECTORY_SIZE,
  MIN_LOCAL_FILE_HEADER_SIZE,
  ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE,
} from "./constants.ts";
import { getUint16LE, getUint32LE, getUint64LE } from "@takker/bytes";
import { createErr, createOk, type Result } from "./result.ts";

/**
 *  A file extracted from a ZIP archive
 */
export interface UnzipFile extends UnzipFileInfo {
  /**
   * The data of the file
   *
   * This is compressed if {@linkcode UnzipFileInfo.compression} is not 0.
   */
  data: Uint8Array;
}

/**
 * Information about a file to be extracted from a ZIP archive
 */
export interface UnzipFileInfo {
  /**
   * The full path of the file
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
 *
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
export const unzip = (
  data: Uint8Array,
  opts?: UnzipOptions,
): Result<Generator<UnzipFile, void, unknown>, InvalidZipDataError> => {
  let e = data.length - MIN_END_OF_CENTRAL_DIRECTORY_SIZE;
  for (
    ;
    getUint32LE(data, e) != END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE;
    --e
  ) {
    // 0x10000 + 22 = 0x10016
    // 22 = 0x16
    if (!e || data.length - e > 0x10016) {
      return createErr(invalidZipDataError());
    }
  }

  return createOk(function* () {
    /** The total number of entries in the central directory on this disk
     *
     * the size is 2 bytes if the archive is not in ZIP64 format, and 8 bytes otherwise
     *
     * see APPNOTE.txt, section 4.4.21
     */
    let centralDirectoryCount = getUint16LE(data, e + 8);
    if (!centralDirectoryCount) return;

    /** The offset of start of central directory with respect to the starting disk number
     *
     * the size is 2 bytes if the archive is not in ZIP64 format, and 8 bytes otherwise
     *
     * see APPNOTE.txt, section 4.4.24
     */
    let centralDirectoryOffset = getUint32LE(data, e + 16);

    /** whether the archive is in ZIP64 format */
    let isZip64 = centralDirectoryOffset == 0xffffffff ||
      centralDirectoryCount == 0xffff;
    if (isZip64) {
      /** relative offset of the zip64 end of central directory record (8 bytes)
       *
       * see APPNOTE.txt, section 4.3.15
       */
      const zip64EndOfCentralDirectoryRecordOffset = getUint32LE(data, e - 12);
      isZip64 = getUint32LE(data, zip64EndOfCentralDirectoryRecordOffset) ==
        ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE;
      if (isZip64) {
        // read total number of entries in the central dir on this disk: (8 bytes)
        // see APPNOTE.txt, section 4.4.21
        centralDirectoryCount = getUint32LE(
          data,
          zip64EndOfCentralDirectoryRecordOffset + 32,
        );

        // read offset of start of central directory with respect to the starting disk number: (8 bytes)
        // see APPNOTE.txt, section 4.4.24
        centralDirectoryOffset = getUint32LE(
          data,
          zip64EndOfCentralDirectoryRecordOffset + 48,
        );
      }
    }
    for (let _ = 0; _ < centralDirectoryCount; ++_) {
      const [
        compressionMethod,
        compressedSize,
        uncompressedSize,
        fileName,
        nextOffset,
        localFileHeaderOffset,
      ] = readCentralDirectory(
        data,
        centralDirectoryOffset,
        isZip64,
      );
      centralDirectoryOffset = nextOffset;
      const file: UnzipFileInfo = {
        name: fileName,
        size: compressedSize,
        originalSize: uncompressedSize,
        compression: compressionMethod,
      };
      if (!(opts?.filter?.(file) ?? true)) continue;
      const fileDataOffset = getFileDataOffset(data, localFileHeaderOffset);
      yield {
        data: data.slice(
          fileDataOffset,
          fileDataOffset + compressedSize,
        ),
        ...file,
      };
    }
  }());
};

/** get a file data offset
 *
 * see APPNOTE.txt section 4.3.7
 *
 * @param buffer - the buffer
 * @param LocalFileHeaderOffset - the offset of the local file header
 * @returns the offset of the file data
 */
const getFileDataOffset = (
  buffer: Uint8Array,
  LocalFileHeaderOffset: number,
): number =>
  LocalFileHeaderOffset +
  MIN_LOCAL_FILE_HEADER_SIZE +
  // file name length: (2 bytes)
  // see APPNOTE.txt section 4.4.10
  getUint16LE(buffer, LocalFileHeaderOffset + 26) +
  // extra field length: (2 bytes)
  // see APPNOTE.txt section 4.4.11
  getUint16LE(buffer, LocalFileHeaderOffset + 28);

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
const readCentralDirectory = (
  buffer: Uint8Array,
  centralDirectoryOffset: number,
  isZip64: boolean,
): [number, number, number, string, number, number] => {
  /** file name length: (2 bytes)
   *
   * see APPNOTE.txt section 4.4.10
   */
  const fileNameLength = getUint16LE(buffer, centralDirectoryOffset + 28);

  /** file name: (variable size)
   *
   * see APPNOTE.txt section 4.4.17
   */
  const fileName = decode(
    buffer.subarray(
      centralDirectoryOffset + 46,
      centralDirectoryOffset + 46 + fileNameLength,
    ),
    !(getUint16LE(buffer, centralDirectoryOffset + 8) & 2048),
  );

  const extraFieldOffset = centralDirectoryOffset +
    46 + // total minimum bytes required for a central directory file header (46 bytes)
    fileNameLength;

  /** compressed size: (4 bytes)
   *
   * see APPNOTE.txt section 4.4.8
   */
  const compressedSize32 = getUint32LE(buffer, centralDirectoryOffset + 20);

  const [compressedSize, uncompressedSize, localFileHeaderOffset] =
    isZip64 && compressedSize32 == 0xffffffff
      ? readZip64ExtraField(buffer, extraFieldOffset)
      : [
        compressedSize32,
        // read uncompressed size: (4 bytes)
        // see APPNOTE.txt section 4.4.9
        getUint32LE(buffer, centralDirectoryOffset + 24),
        // read relative offset of local header: (4 bytes)
        // see APPNOTE.txt section 4.4.16
        getUint32LE(buffer, centralDirectoryOffset + 42),
      ];
  return [
    // read compression method: (2 bytes)
    // see APPNOTE.txt section 4.4.5
    getUint16LE(buffer, centralDirectoryOffset + 10),
    compressedSize,
    uncompressedSize,
    fileName,
    extraFieldOffset +
    // read extra field length: (2 bytes)
    // see APPNOTE.txt section 4.4.11
    getUint16LE(buffer, centralDirectoryOffset + 30) +
    // rad file comment length: (2 bytes)
    // see APPNOTE.txt section 4.4.12
    getUint16LE(buffer, centralDirectoryOffset + 32),
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
export const readZip64ExtraField = (
  buffer: Uint8Array,
  extraFieldOffset: number,
): [number, number, number] => {
  for (
    ;
    getUint16LE(buffer, extraFieldOffset) != 1;
    extraFieldOffset += 4 + getUint16LE(buffer, extraFieldOffset + 2)
  );
  return [
    // read compressed size: (8 bytes)
    // see APPNOTE.txt section 4.4.8
    getUint64LE(buffer, extraFieldOffset + 12),
    // read uncompressed size: (8 bytes)
    // see APPNOTE.txt section 4.4.9
    getUint64LE(buffer, extraFieldOffset + 4),
    // read relative offset of local header: (8 bytes)
    // see APPNOTE.txt section 4.4.16
    getUint64LE(buffer, extraFieldOffset + 20),
  ];
};
