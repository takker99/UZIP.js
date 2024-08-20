/** Walmart object spread */
export const mrg = <A, B>(a: A, b: B): A & B => {
  const o = {} as Record<string, unknown>;
  for (const k in a) o[k] = a[k];
  for (const k in b) o[k] = b[k];
  return o as A & B;
};
