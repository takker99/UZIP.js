/**
 * Codes for errors generated within this library
 */

export const FlateErrorCode = {
  UnexpectedEOF: 0,
  InvalidBlockType: 1,
  InvalidLengthLiteral: 2,
  InvalidDistance: 3,
  StreamFinished: 4,
  NoStreamHandler: 5,
  InvalidHeader: 6,
  NoCallback: 7,
  InvalidUTF8: 8,
  ExtraFieldTooLong: 9,
  InvalidDate: 10,
  FilenameTooLong: 11,
  StreamFinishing: 12,
  InvalidZipData: 13,
  UnknownCompressionMethod: 14,
} as const;

/** error codes */
export const ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  , // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data",
  // determined by unknown compression method
];

/**
 * An error generated within this library
 */
export interface FlateError extends Error {
  /**
   * The code associated with this error
   */
  code: number;
}

export const err = (ind: number, msg?: string | 0, nt?: 1): FlateError => {
  const e: Partial<FlateError> = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace) Error.captureStackTrace(e, err);
  if (!nt) throw e;
  return e as FlateError;
};
