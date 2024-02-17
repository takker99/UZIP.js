/**
 * Decode a zip file and extracts its contents.
 * @param zip the zip file data.
 * @param onlyNames If true, only the names of the files will be returned.
 * @returns A record object containing the extracted files, where the keys are the file names and the values are either the file data or an object with the properties `size` and `csize`.
 */
export const decode = async (
  zip: Readonly<InputType>,
  onlyNames?: boolean,
): Promise<Record<string, { size: number; csize: number } | Uint8Array>> => {
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
  const out: Record<string, { size: number; csize: number } | Uint8Array> = {};
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

    const { name, ...file } = await readLocal(
      view,
      roff,
      csize,
      usize,
      onlyNames ?? false,
    );
    out[name] = "file" in file ? file.file : file;
  }
  //console.log(out);
  return out;
};

export type InputType = BufferSource | Blob | ReadableStream<Uint8Array>;

const readLocal = async (
  view: Readonly<DataView>,
  o: number,
  csize: number,
  usize: number,
  onlyNames: boolean,
): Promise<
  { name: string; size: number; csize: number } | {
    name: string;
    file: Uint8Array;
  }
> => {
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

  if (onlyNames) return { name, size: usize, csize };

  const file = new Uint8Array(view.buffer, view.byteOffset + o, csize);
  if (cmpr == 0) {
    return { name, file: new Uint8Array(file) };
  } else if (cmpr == 8) {
    return { name, file: await inflateRaw(file) };
  } else throw "unknown compression method: " + cmpr;
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
): Promise<Uint8Array> => {
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

  const data = new Uint8Array(tot);
  let o = 0;
  const fof = [];

  for (const p in zpd) {
    const file = zpd[p];
    fof.push(o);
    o = writeHeader(data, o, p, await file, 0);
  }
  let i = 0;
  const ioff = o;
  for (const p in zpd) {
    const file = zpd[p];
    fof.push(o);
    o = writeHeader(data, o, p, await file, 1, fof[i++]);
  }
  const csize = o - ioff;

  writeUint(data, o, 0x06054b50);
  o += 4;
  o += 4; // disks
  writeUshort(data, o, i);
  o += 2;
  writeUshort(data, o, i);
  o += 2; // number of c d records
  writeUint(data, o, csize);
  o += 4;
  writeUint(data, o, ioff);
  o += 4;
  o += 2;
  return data;
};

/** no need to compress .PNG, .ZIP, .JPEG ....*/
const noNeed = (fn: string) => {
  const ext = fn.split(".").pop()!.toLowerCase();
  return ["png", "jpg", "jpeg", "zip"].includes(ext);
};

const writeHeader = (
  data: Uint8Array,
  o: number,
  p: string,
  obj: FileInZip,
  t: number,
  roff?: number,
) => {
  const file = obj.file;

  writeUint(data, o, t == 0 ? 0x04034b50 : 0x02014b50);
  o += 4; // sign
  if (t == 1) o += 2; // ver made by
  writeUshort(data, o, 20);
  o += 2; // ver
  writeUshort(data, o, 0);
  o += 2; // gflip
  writeUshort(data, o, obj.cpr ? 8 : 0);
  o += 2; // cmpr

  writeUint(data, o, 0);
  o += 4; // time
  writeUint(data, o, obj.crc);
  o += 4; // crc32
  writeUint(data, o, file.length);
  o += 4; // csize
  writeUint(data, o, obj.usize);
  o += 4; // usize

  const pBuf = new TextEncoder().encode(p);
  writeUshort(data, o, pBuf.length);
  o += 2; // nlen
  writeUshort(data, o, 0);
  o += 2; // elen

  if (t == 1) {
    o += 2; // comment length
    o += 2; // disk number
    o += 6; // attributes
    writeUint(data, o, roff!);
    o += 4; // usize
  }
  data.set(pBuf, o);
  o += pBuf.length;
  if (t == 0) {
    data.set(file, o);
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
const inflateRaw = async (
  buffer: Blob | BufferSource | ReadableStream<Uint8Array>,
) =>
  new Uint8Array(
    await new Response(
      new Response(buffer).body!.pipeThrough(
        new DecompressionStream("deflate-raw"),
      ),
    ).arrayBuffer(),
  );

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

const writeUshort = (buff: Uint8Array, p: number, n: number) => {
  buff[p] = n & 255;
  buff[p + 1] = (n >> 8) & 255;
};
const writeUint = (buff: Uint8Array, p: number, n: number) => {
  buff[p] = n & 255;
  buff[p + 1] = (n >> 8) & 255;
  buff[p + 2] = (n >> 16) & 255;
  buff[p + 3] = (n >> 24) & 255;
};
