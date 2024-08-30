import type { DeflateOptions } from "./deflate.ts";
import type { GzipOptions } from "./gzip.ts";
import { mrg } from "./mrg.ts";
import { u8 } from "./shorthands.ts";

/**
 * Attributes for files added to a ZIP archive object
 */
export interface ZipAttributes {
  /**
   * The operating system of origin for this file. The value is defined
   * by PKZIP's APPNOTE.txt, section 4.4.2.2. For example, 0 (the default)
   * is MS/DOS, 3 is Unix, 19 is macOS.
   */
  os?: number;

  /**
   * The file's attributes. These are traditionally somewhat complicated
   * and platform-dependent, so using them is scarcely necessary. However,
   * here is a representation of what this is, bit by bit:
   *
   * `TTTTugtrwxrwxrwx0000000000ADVSHR`
   *
   * TTTT = file type (rarely useful)
   *
   * u = setuid, g = setgid, t = sticky
   *
   * rwx = user permissions, rwx = group permissions, rwx = other permissions
   *
   * 0000000000 = unused
   *
   * A = archive, D = directory, V = volume label, S = system file, H = hidden, R = read-only
   *
   * If you want to set the Unix permissions, for instance, just bit shift by 16, e.g. 0o644 << 16.
   * Note that attributes usually only work in conjunction with the `os` setting: you must use
   * `os` = 3 (Unix) if you want to set Unix permissions
   */
  attrs?: number;

  /**
   * Extra metadata to add to the file. This field is defined by PKZIP's APPNOTE.txt,
   * section 4.4.28. At most 65,535 bytes may be used in each ID. The ID must be an
   * integer between 0 and 65,535, inclusive.
   *
   * This field is incredibly rare and almost never needed except for compliance with
   * proprietary standards and software.
   */
  extra?: Record<number, Uint8Array>;

  /**
   * The comment to attach to the file. This field is defined by PKZIP's APPNOTE.txt,
   * section 4.4.26. The comment must be at most 65,535 bytes long UTF-8 encoded. This
   * field is not read by consumer software.
   */
  comment?: string;

  /**
   * When the file was last modified. Defaults to the current time.
   */
  mtime?: GzipOptions["mtime"];

  compression?: CompressionMethod | [CompressionMethod, Compressor];
}

/** data compresser
 *
 * @param data The data to compress
 * @param opts The compression options
 * @returns The deflated version of the data
 */
export type Compressor = (
  data: Uint8Array,
  options?: DeflateOptions,
) => Uint8Array;

export const compressionNameToNumber = {
  deflate: 8,
  lzma: 14,
  zstd: 93,
} as const;
export type CompressionMethod = keyof typeof compressionNameToNumber;
export type CompressionMethodNumber = keyof typeof compressionNumberToName;
export const compressionNumberToName = {
  8: "deflate",
  14: "lzma",
  93: "zstd",
} as const;

export type CompressionMethodMap = Partial<
  Record<CompressionMethod, Compressor>
>;

/**
 * Options for creating a ZIP archive
 */
export interface ZipOptions
  extends DeflateOptions, Omit<ZipAttributes, "compression"> {
  compressionMethods?: CompressionMethodMap;
}

export interface FlattenedZipOptions
  extends Omit<ZipOptions, "compressionMethods"> {
  compression?: [CompressionMethod, Compressor];
}

/**
 * A file that can be used to create a ZIP archive
 */
export type ZippableFile = Uint8Array | Zippable | [
  Uint8Array | Zippable,
  ZipAttributes,
];

/**
 * The complete directory structure of a ZIPpable archive
 */
export interface Zippable {
  [path: string]: ZippableFile;
}

/** flatten a directory structure */
export function* flatten(
  directory: Zippable,
  path: string,
  globalOptions: ZipOptions,
): Generator<[string, Uint8Array, FlattenedZipOptions], void, unknown> {
  for (const k in directory) {
    let val = directory[k],
      n = path + k,
      op: FlattenedZipOptions = globalOptions;
    if (Array.isArray(val)) {
      let { compression, ...rest } = val[1];
      val = val[0];
      if (typeof compression === "string") {
        const compresser = globalOptions.compressionMethods?.[compression];
        if (!compresser) {
          throw new Error(`Compression method ${compression} not found`);
        }
        compression = [compression, compresser];
      }
      op = {...globalOptions, ...rest, compression};
    }
    if (val instanceof u8) {
      yield [n, val, op];
    } else {
      yield [n += "/", new u8(), op];
      yield* flatten(val, n, globalOptions);
    }
  }
}
