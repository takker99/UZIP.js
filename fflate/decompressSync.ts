import { type InflateOptions, inflateSync } from "./inflateSync.ts";
import { unzlibSync } from "./unzlibSync.ts";
import { gunzipSync } from "./gunzipSync.ts";

/**
 * Expands compressed GZIP, Zlib, or raw DEFLATE data, automatically detecting the format
 * @param data The data to decompress
 * @param opts The decompression options
 * @returns The decompressed version of the data
 */
export const decompressSync = (
  data: Uint8Array,
  opts?: InflateOptions,
): Uint8Array =>
  (data[0] == 31 && data[1] == 139 && data[2] == 8)
    ? gunzipSync(data, opts)
    : ((data[0] & 15) != 8 || (data[0] >> 4) > 7 ||
        ((data[0] << 8 | data[1]) % 31))
    ? inflateSync(data, opts)
    : unzlibSync(data, opts);
