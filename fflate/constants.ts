import { i32, u16, u8 } from "./shorthands.ts";

export const fixedLengthExtraBits = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */ 0,
  0,
  /* impossible */ 0,
]);

export const fixedDistanceExtraBits = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */ 0,
  0,
]);

export const codeLengthIndexMap = new u8([
  16,
  17,
  18,
  0,
  8,
  7,
  9,
  6,
  10,
  5,
  11,
  4,
  12,
  3,
  13,
  2,
  14,
  1,
  15,
]);

// get base, reverse index map from extra bits
const freb = (eb: Uint8Array, start: number) => {
  const b = new u16(31);
  for (let i = 0; i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  // numbers here are at max 18 bits
  const r = new i32(b[30]);
  for (let i = 1; i < 30; ++i) {
    for (let j = b[i]; j < b[i + 1]; ++j) {
      r[j] = ((j - b[i]) << 5) | i;
    }
  }
  return [b, r];
};

export const [fl, revfl] = /*#__PURE__*/ freb(fixedLengthExtraBits, 2);
// we can ignore the fact that the other numbers are wrong; they never happen anyway
fl[28] = 258, revfl[258] = 28;
export const [fd, revfd] = /*#__PURE__*/ freb(fixedDistanceExtraBits, 0);

export const END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE = 0x6054b50;
export const ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIGNATURE = 0x6064b50;

/** minimum size of the end of central directory record
 *
 * signature (4) + disk number (2) + disk with central directory (2) + number of entries on disk (2) + number of entries (2) + central directory size (4) + central directory offset (4) + comment length (2) = 22
 *
 * see APPNOTE.txt, section 4.3.16
 */
export const MIN_END_OF_CENTRAL_DIRECTORY_SIZE = 22;

/** minimum size of a local file header
 *
 * signature (4) + version needed to extract (2) + general purpose bit flag (2) + compression method (2) + last mod file time (2) + last mod file date (2) + crc32 (4) + compressed size (4) + uncompressed size (4) + file name length (2) + extra field length (2) = 30
 *
 * see APPNOTE.txt, section 4.3.7
 */
export const MIN_LOCAL_FILE_HEADER_SIZE = 30;
