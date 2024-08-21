/** Walmart object spread */
export const mrg = <A, B>(a: A, b: B): A & B => ({ ...a, ...b });
