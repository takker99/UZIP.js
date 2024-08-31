import { empty } from "./constants.ts";
import { u8 } from "./shorthands.ts";

/** Attributes for files added to a ZIP archive object */
export interface ZipAttributes {
  /**
   * The operating system of origin for this file.
   * The value is defined by PKZIP's APPNOTE.txt, section 4.4.2.2.
   *
   * According to the spec, the following values are possible:
   * | Value | OS                                           |
   * |-------|----------------------------------------------|
   * | 0     | MS-DOS and OS/2 (FAT / VFAT / FAT32 file systems) |
   * | 1     | Amiga                                        |
   * | 2     | OpenVMS                                      |
   * | 3     | Unix                                         |
   * | 4     | VM/CMS                                       |
   * | 5     | Atari ST                                     |
   * | 6     | OS/2 H.P.F.S.                                |
   * | 7     | Macintosh                                    |
   * | 8     | Z-System                                     |
   * | 9     | CP/M                                         |
   * | 10    | Windows NTFS                                 |
   * | 11    | MVS (OS/390 - Z/OS)                          |
   * | 12    | VSE                                          |
   * | 13    | Acorn Risc                                   |
   * | 14    | VFAT                                         |
   * | 15    | alternate MVS                                |
   * | 16    | BeOS                                         |
   * | 17    | Tandem                                       |
   * | 18    | OS/400                                       |
   * | 19    | OS X (Darwin)                                |
   * | ~ 225 | unused                                       |
   *
   * @default 0
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

  /** When the file was last modified. Defaults to the current time.  */
  mtime?: string | number | Date;

  /**
   * The compression method to use for this file.
   * Available methods are defined in {@linkcode CompressionMethod}.
   *
   * If you set any compression method as a string, you must also pass the mapping of the compression method to the {@linkcode Compress} to {@linkcode ZipOptions.compressionMethods}.
   *
   * You can set to `undefined` not to use any compression method.
   *
   * If you want to use a custom compression method, you can set it to a tuple of the {@linkcode CompressionMethod} and the {@linkcode Compress}.
   */
  compression?: CompressionMethod | [CompressionMethod, Compress];
}

/** data compresser
 *
 * @param data The data to compress
 * @returns The deflated version of the data
 */
export type Compress = (data: Uint8Array) => Uint8Array;

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
  Record<CompressionMethod, Compress>
>;

/**
 * Options for creating a ZIP archive
 */
export interface ZipOptions extends Omit<ZipAttributes, "compression"> {
  compressionMethods?: CompressionMethodMap;
}

export interface FlattenedZipOptions
  extends Omit<ZipAttributes, "compression"> {
  /**
   * A tuple of the {@linkcode CompressionMethod} and the {@linkcode Compress}.
   *
   * This is set to `undefined` if you don't want to compress the file.
   */
  compression?: [CompressionMethod, Compress];
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
export const flatten = (
  directory: Zippable,
  globalOptions: ZipOptions = {},
): Generator<[string, Uint8Array, FlattenedZipOptions], void, unknown> =>
  flattenImpl(directory, globalOptions, "", new Set());

export function* flattenImpl(
  directory: Zippable,
  globalOptions: ZipOptions,
  path: string,
  yieldedPath: Set<string>,
): Generator<[string, Uint8Array, FlattenedZipOptions], void, unknown> {
  for (const k in directory) {
    let val = directory[k],
      n = path + k,
      op: FlattenedZipOptions = globalOptions;
    const slashIndex = k.indexOf("/");
    if (slashIndex > -1) {
      const dir = k.slice(0, slashIndex);
      const rest = k.slice(slashIndex + 1);
      yield* flattenImpl(
        { [dir]: { [rest]: val } },
        globalOptions,
        path,
        yieldedPath,
      );
      continue;
    }

    if (Array.isArray(val)) {
      let { compression, ...rest } = val[1];
      val = val[0];
      if (!Array.isArray(compression) && compression) {
        const compresser = globalOptions.compressionMethods?.[compression];
        if (!compresser) {
          throw new Error(`Compression method ${compression} not found`);
        }
        compression = [compression, compresser];
      }
      op = { ...globalOptions, ...rest, compression };
    }
    if (val instanceof u8) {
      if (yieldedPath.has(n)) {
        throw new Error(`Duplicate file: ${n}`);
      }
      yield [n, val, op];
      yieldedPath.add(n);
    } else {
      // ignore duplicate directories
      if (!yieldedPath.has(n += "/")) {
        yield [n, empty, {}];
      }
      yieldedPath.add(n);
      yield* flattenImpl(val, op, n, yieldedPath);
    }
  }
}
