/**  crc checking module
 *
 * @module
 */

const makeCRC32Table = () => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; ++i) {
    let c = i, k = 9;
    while (--k) c = (c & 1 ? 0xedb88320 : 0) ^ (c >>> 1);
    t[i] = c;
  }
  return t;
};

/** CRC32 table */
export const CRC32Table = /*#__PURE__*/ makeCRC32Table();

/**
 * Calculates the CRC32 checksum for the given data.
 *
 * @param data - The input data as a Uint8Array.
 * @returns The CRC32 checksum as a number.
 */
export const crc32 = (data: Uint8Array): number => {
  let crc = -1;
  for (const byte of data) {
    crc = CRC32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return ~crc;
};
