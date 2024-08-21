/**
 * Decode a zip file and extracts its contents.
 * @param zip the zip file data.
 * @param onlyNames If true, only the names of the files will be returned.
 * @returns A record object containing the extracted files, where the keys are the file names and the values are either the file data or an object with the properties `size` and `csize`.
 */
export async function* decode(
  zip: Readonly<InputType>,
): AsyncGenerator<Entry, void, void> {
  const buffer = await new Response(zip).arrayBuffer();

  const view = new DataView(buffer);

  let eocd = buffer.byteLength - 4;
  while (view.getUint32(eocd, true) !== 0x06054b50) eocd--;

  let o = eocd;
  o += 4; // sign  = 0x06054b50
  o += 4; // disks = 0;
  const cnu = view.getUint16(o, true);
  o += 2;
  //   const cnt = readUshort(data, o);
  o += 2;

  //   const csize = readUint(data, o);
  o += 4;
  const coffs = view.getUint32(o, true);
  o += 4;

  o = coffs;
  for (let i = 0; i < cnu; i++) {
    // const sign = readUint(data, o);
    o += 4;
    o += 4; // versions;
    o += 4; // flag + compr
    o += 4; // time

    // const crc32 = readUint(data, o);
    o += 4;
    const csize = view.getUint32(o, true);
    o += 4;
    const usize = view.getUint32(o, true);
    o += 4;

    const nl = view.getUint16(o, true);
    o += 2;
    const el = view.getUint16(o, true);
    o += 2;
    const cl = view.getUint16(o, true);
    o += 2;
    o += 8; // disk, attribs

    const roff = view.getUint32(o, true);
    o += 4;
    o += nl + el + cl;

    yield readLocal(view, roff, csize, usize);
  }
}

export interface Entry {
  name: string;
  csize: number;
  usize: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
  file: () => Promise<File>;
  text: () => Promise<string>;
}

export type InputType = BufferSource | Blob | ReadableStream<Uint8Array>;

const readLocal = (
  view: Readonly<DataView>,
  o: number,
  csize: number,
  usize: number,
): Entry => {
  //   const sign = readUint(data, o);
  o += 4;
  //   const ver = readUshort(data, o);
  o += 2;
  //   const gpflg = readUshort(data, o);
  o += 2;
  //if((gpflg&8)!=0) throw "unknown sizes";
  const cmpr = view.getUint16(o, true);
  o += 2;

  //   const time = readUint(data, o);
  o += 4;

  //   const crc32 = readUint(data, o);
  o += 4;
  //var csize = readUint(data, o);  o+=4;
  //var usize = readUint(data, o);  o+=4;
  o += 8;

  const nlen = view.getUint16(o, true);
  o += 2;
  const elen = view.getUint16(o, true);
  o += 2;
  const name = new TextDecoder().decode(
    new Uint8Array(view.buffer, view.byteOffset + o, nlen),
  );
  o += nlen; //console.log(name);
  o += elen;

  const file = new Uint8Array(view.buffer, view.byteOffset + o, csize);
  if (cmpr == 0) {
    return makeEntry(name, csize, usize, file, true);
  } else if (cmpr == 8) {
    return makeEntry(name, csize, usize, file, false);
  } else throw "unknown compression method: " + cmpr;
};

const makeEntry = (
  name: string,
  csize: number,
  usize: number,
  compressed: Uint8Array,
  noCompression: boolean,
): Entry => {
  if (noCompression) {
    return {
      name,
      csize,
      usize,
      arrayBuffer: () => Promise.resolve(compressed),
      file: () => Promise.resolve(new File([compressed], name)),
      text: () => Promise.resolve(new TextDecoder().decode(compressed)),
    };
  }

  let decompressed: ArrayBuffer | undefined;
  const decompress = async () => {
    decompressed ??= await inflateRaw(compressed);
    return decompressed;
  };

  return {
    name,
    csize,
    usize,
    arrayBuffer: decompress,
    file: async () => new File([await decompress()], name),
    text: async () => new TextDecoder().decode(await decompress()),
  };
};

interface FileInZip {
  cpr: boolean;
  usize: number;
  crc: number;
  file: Uint8Array;
}

/**
 * Compresses an object where the keys represent file names and the values represent data, and creates a zip file.
 *
 * @param files - The object containing the data to be compressed.
 * @param noCompression - Optional. If set to true, compression will be disabled. Default is false.
 * @returns The compressed data
 */
export const encode = async (
  files: Readonly<Record<string, InputType>>,
  noCompression?: boolean,
): Promise<ArrayBuffer> => {
  noCompression ??= false;
  const zpd: Record<string, Promise<FileInZip>> = Object.fromEntries(
    [...Object.entries(files)].map(
      ([key, buf]) => {
        const cpr = !noNeed(key) && !noCompression;
        const file = (async () => {
          const buffer = buf instanceof Uint8Array
            ? buf
            : new Uint8Array(await new Response(buf).arrayBuffer());
          return {
            cpr: cpr,
            usize: buffer.byteLength,
            crc: crc(buffer, 0, buffer.length),
            file: (cpr ? await deflateRaw(buf) : buffer),
          };
        })();

        return [key, file];
      },
    ),
  );

  let tot = 0;
  for (const p in zpd) {
    tot += (await zpd[p]).file.length + 30 + 46 +
      2 * (new TextEncoder().encode(p)).length;
  }
  tot += 22;

  const view = new DataView(new ArrayBuffer(tot));
  let o = 0;
  const fof = [];

  for (const p in zpd) {
    const file = zpd[p];
    fof.push(o);
    o = writeHeader(view, o, p, await file, 0);
  }
  let i = 0;
  const ioff = o;
  for (const p in zpd) {
    const file = zpd[p];
    fof.push(o);
    o = writeHeader(view, o, p, await file, 1, fof[i++]);
  }
  const csize = o - ioff;

  view.setUint32(o, 0x06054b50, true);
  o += 4;
  o += 4; // disks
  view.setUint32(o, i, true);
  o += 2;
  view.setUint32(o, i, true);
  o += 2; // number of c d records
  view.setUint32(o, csize, true);
  o += 4;
  view.setUint32(o, ioff, true);
  o += 4;
  o += 2;
  return view.buffer;
};

/** no need to compress .PNG, .ZIP, .JPEG ....*/
const noNeed = (fn: string) => {
  const ext = fn.split(".").pop()!.toLowerCase();
  return ["png", "jpg", "jpeg", "zip"].includes(ext);
};

const writeHeader = (
  view: DataView,
  o: number,
  p: string,
  obj: FileInZip,
  t: 0 | 1,
  roff?: number,
) => {
  const file = obj.file;

  view.setUint32(o, t == 0 ? 0x04034b50 : 0x02014b50, true);
  o += 4; // sign
  if (t == 1) o += 2; // ver made by
  view.setUint16(o, 20, true);
  o += 2; // ver
  view.setUint16(o, 0, true);
  o += 2; // gflip
  view.setUint16(o, obj.cpr ? 8 : 0, true);
  o += 2; // cmpr

  view.setUint32(o, 0, true);
  o += 4; // time
  view.setUint32(o, obj.crc, true);
  o += 4; // crc32
  view.setUint32(o, file.length, true);
  o += 4; // csize
  view.setUint32(o, obj.usize, true);
  o += 4; // usize

  const pBuf = new TextEncoder().encode(p);
  view.setUint16(o, pBuf.length, true);
  o += 2; // nlen
  view.setUint16(o, 0, true);
  o += 2; // elen

  if (t == 1) {
    o += 2; // comment length
    o += 2; // disk number
    o += 6; // attributes
    view.setUint32(o, roff!, true);
    o += 4; // usize
  }
  const buffer = new Uint8Array(view.buffer, view.byteOffset);
  buffer.set(pBuf, o);
  o += pBuf.length;
  if (t == 0) {
    buffer.set(file, o);
    o += file.length;
  }
  return o;
};

const crc = (b: Uint8Array, o: number, l: number) =>
  update(0xffffffff, b, o, l) ^ 0xffffffff;

const table = (() => {
  const tab = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    tab[n] = c;
  }
  return tab;
})();

const update = (c: number, buf: Uint8Array, off: number, len: number) => {
  for (let i = 0; i < len; i++) {
    c = table[(c ^ buf[off + i]) & 0xff] ^ (c >>> 8);
  }
  return c;
};
const inflateRaw = (
  buffer: Blob | BufferSource | ReadableStream<Uint8Array>,
) =>
  new Response(
    new Response(buffer).body!.pipeThrough(
      new DecompressionStream("deflate-raw"),
    ),
  ).arrayBuffer();

const deflateRaw = async (
  buffer: Blob | BufferSource | ReadableStream<Uint8Array>,
) =>
  new Uint8Array(
    await new Response(
      new Response(buffer).body!.pipeThrough(
        new CompressionStream("deflate-raw"),
      ),
    ).arrayBuffer(),
  );
