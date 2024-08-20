import { strToU8 } from "./buffer.ts";
import { err } from "./error.ts";
import { mrg } from "./mrg.ts";
import {
  type FlatZippable,
  fltn,
  type ZipOptions,
  type Zippable,
} from "./zippable.ts";
import { deflateSync } from "./deflateSync.ts";
import { crc } from "./crc.ts";
import { u8 } from "./shorthands.ts";
import { exfl, wzf, wzh, type ZHF } from "./zip.ts";

/**
 * Synchronously creates a ZIP file. Prefer using `zip` for better performance
 * with more than one file.
 * @param data The directory structure for the ZIP archive
 * @param opts The main options, merged with per-file options
 * @returns The generated ZIP archive
 */
export const zipSync = (data: Zippable, opts?: ZipOptions): Uint8Array => {
  if (!opts) opts = {};
  const r: FlatZippable<false> = {};
  const files: ZipDat[] = [];
  fltn(data, "", r, opts);
  let o = 0;
  let tot = 0;
  for (const fn in r) {
    const [file, p] = r[fn];
    const compression = p.level == 0 ? 0 : 8;
    const f = strToU8(fn), s = f.length;
    const com = p.comment,
      m = com ? strToU8(com) : undefined,
      ms = m && m.length;
    const exl = exfl(p.extra);
    if (s > 65535) err(11);
    const d = compression ? deflateSync(file, p) : file, l = d.length;
    const c = crc();
    c.p(file);
    files.push(mrg(p, {
      size: file.length,
      crc: c.d(),
      c: d,
      f,
      m,
      u: s != fn.length || (m != undefined && (com?.length != ms)),
      o,
      compression,
    }));
    o += 30 + s + exl + l;
    tot += 76 + 2 * (s + exl) + (ms || 0) + l;
  }
  const out = new u8(tot + 22), oe = o, cdl = tot - o;
  for (let i = 0; i < files.length; ++i) {
    const f = files[i];
    wzh(out, f.o, f, f.f, f.u, f.c.length);
    const badd = 30 + f.f.length + exfl(f.extra);
    out.set(f.c, f.o + badd);
    wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m),
      o += 16 + badd + (f.m ? f.m.length : 0);
  }
  wzf(out, o, files.length, cdl, oe);
  return out;
};

type AsyncZipDat = ZHF & {
  // compressed data
  c: Uint8Array;
  // filename
  f: Uint8Array;
  // comment
  m?: Uint8Array;
  // unicode
  u: boolean;
};

export type ZipDat = AsyncZipDat & {
  // offset
  o: number;
};
