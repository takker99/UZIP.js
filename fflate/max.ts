/** find max of array */
export const max = (a: Uint8Array | number[]): number => {
  let m = a[0];
  for (let i = 1; i < a.length; ++i) {
    if (a[i] > m) m = a[i];
  }
  return m;
};
