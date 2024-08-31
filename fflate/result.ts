/** A utility for representing [Result types](https://en.wikipedia.org/wiki/Result_type)
 *
 * @module
 */

/**
 * [Result type](https://en.wikipedia.org/wiki/Result_type)
 *
 * This object layout is almost the same as [option-t](https://github.com/option-t/option-t) except for the following differences:
 * - The `val` property only exists in {@linkcode Ok}.
 * - The `err` property only exists in {@linkcode Err}.
 */
export type Result<T, E> = Ok<T> | Err<E>;

/**
 * Represents a successful result `T`.
 *
 * This object layout is almost the same as [option-t](https://github.com/option-t/option-t) except for not including the `err` property.
 */
export interface Ok<out T> {
  /**
   * Whether the result is successful.
   */
  ok: true;
  /**
   * The successful information.
   */
  val: T;
}

/**
 * Represents a failed information `E`.
 *
 * This object layout is almost the same as [option-t](https://github.com/option-t/option-t) except for not including the `val` property.
 */
export interface Err<out E> {
  /**
   * Whether the result is successful.
   */
  ok: false;
  /**
   * The failed information.
   */
  err: E;
}

/**
 * Creates an {@linkcode Ok} object with `val`.
 *
 * @param val - The value to be wrapped in the Ok object.
 * @returns An {@linkcode Ok} object containing `val`.
 */
export const createOk = <T>(val: T): Ok<T> => ({ ok: true, val });
/**
 * Creates an {@linkcode Err} object with `err`.
 *
 * @param err - The error to be wrapped in the Err object.
 * @returns An {@linkcode Err} object containing `err`.
 */
export const createErr = <E>(err: E): Err<E> => ({ ok: false, err });

/**
 * Checks if the result is {@linkcode Ok}.
 *
 * @param result - The result to check.
 * @returns A boolean indicating if the result is {@linkcode Ok}.
 */
export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;
/**
 * Checks if the result is {@linkcode Err}.
 *
 * @param result - The result to check.
 * @returns A boolean indicating if the result is {@linkcode Err}.
 */
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> =>
  !result.ok;

/** Unwraps the value from {@linkcode Ok}.
 *
 * @param result - The {@linkcode Ok} result to unwrap.
 * @returns The unwrapped value.
 */
export const unwrapOk = <T>(result: Ok<T>): T => result.val;
/** Unwraps the error from {@linkcode Err}.
 *
 * @param result - The {@linkcode Err} result to unwrap.
 * @returns The unwrapped error.
 */
export const unwrapErr = <E>(result: Err<E>): E => result.err;

/**
 * Force to unwrap the value from {@linkcode Result}.
 * If the result is not {@linkcode Ok}, it throws {@linkcode Error} with an optional error message.
 *
 * @param  result - The result to be checked.
 * @param  msg - An optional error message to be included in the thrown error.
 * @returns  - The value of the result if it is Ok.
 * @throws {Error} - If the result is not Ok.
 */
export const expectOk = <T>(result: Result<T, unknown>, msg?: string): T => {
  if (isOk(result)) return result.val;
  throw new Error(msg);
};
