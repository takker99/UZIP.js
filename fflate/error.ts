export const UnexpectedEOF = 0;
export const InvalidBlockType = 1;
export const InvalidLengthLiteral = 2;
export const InvalidDistance = 3;
export const InvalidHeader = 4;
export const ExtraFieldTooLong = 5;
export const InvalidDate = 6;
export const FilenameTooLong = 7;
/** caused when the zip data doesn't have the end of central directory signature */
export const InvalidZipData = 7;
export const UnknownCompressionMethod = 9;

/**
 * Codes for errors generated within this library
 */

export type flateErrorCode =
  | typeof UnexpectedEOF
  | typeof InvalidBlockType
  | typeof InvalidLengthLiteral
  | typeof InvalidDistance
  | typeof InvalidHeader
  | typeof ExtraFieldTooLong
  | typeof InvalidDate
  | typeof FilenameTooLong
  | typeof InvalidZipData
  | typeof UnknownCompressionMethod;

/** error codes */
export const ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  , // determined by compression function
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "invalid zip data",
  ,
  // determined by unknown compression method
] as const;

/**
 * An error generated within this library
 */
export interface FlateError extends Error {
  /**
   * The code associated with this error
   */
  code: flateErrorCode;
}

export interface FileNameTooLongError {
  code: typeof FilenameTooLong;
  name: string;
}
export const fileNameTooLongError = (
  fileName: string,
): FileNameTooLongError => ({
  code: FilenameTooLong,
  name: fileName,
});

export interface ExtraFieldTooLongError {
  code: typeof ExtraFieldTooLong;
  name: string;
  key: number;
  value: Uint8Array;
}
export const extraFieldTooLongError = (
  fileName: string,
  key: number,
  value: Uint8Array,
): ExtraFieldTooLongError => ({
  code: ExtraFieldTooLong,
  name: fileName,
  key,
  value,
});

export interface InvalidDateError {
  code: typeof InvalidDate;
  name: string;
  mtime: Date;
}
export const invalidDateError = (
  fileName: string,
  mtime: Date,
): InvalidDateError => ({
  code: InvalidDate,
  name: fileName,
  mtime,
});

export const err = (
  ind: flateErrorCode,
  msg?: string,
): FlateError => {
  const e = new Error(msg ?? ec[ind]) as Partial<FlateError>;
  e.code = ind;
  if (Error.captureStackTrace) Error.captureStackTrace(e, err);
  return e as FlateError;
};
