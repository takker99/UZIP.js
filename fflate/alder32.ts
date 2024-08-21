/** Adler32 */

export const alder32 = (data: Uint8Array): number => {
  let a = 1, b = 0;
  for (const byte of data) {
    a += byte;
    b += a;
  }
  a %= 65521;
  b %= 65521;
  return (b << 16) | a;
};
