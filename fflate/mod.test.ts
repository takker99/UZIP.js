import { InvalidZipData } from "./error.ts";
import { expectOk, unzip, zip } from "./mod.ts";
import { assertEquals } from "@std/assert";

Deno.test("zip and unzip", async (t) => {
  await t.step("empty", () => {
    const zipped = expectOk(zip({}));
    assertEquals(
      zipped,
      new Uint8Array(
        new Uint16Array([
          0x4b50,
          0x0605, // end of central directory signature
          0, // number of this disk
          0, // number of the disk with the start of the central directory
          0, // total number of entries in the central dir on this disk
          0, // total number of entries in the central dir
          0,
          0, // size of the central directory
          0,
          0, // offset of start of central directory with respect to the starting disk number
          0, // .ZIP file comment length
        ]).buffer,
      ),
    );
    assertEquals([...expectOk(unzip(zipped))], []);
  });

  await t.step("invalid", () => {
    assertEquals(
      unzip(new TextEncoder().encode("PK: This is not a zip file.")),
      { ok: false, err: { code: InvalidZipData } },
    );
  });

  await t.step("text files", () => {
    const obj = {
      "file1.txt": new Uint8Array([72, 69, 76, 76, 79]),
      "file2.txt": new Uint8Array([72, 69, 76, 76, 79]),
    };

    assertEquals([...expectOk(unzip(expectOk(zip(obj))))], [
      {
        name: "file1.txt",
        data: obj["file1.txt"],
        size: 5,
        originalSize: 5,
        compression: 0,
      },
      {
        name: "file2.txt",
        data: obj["file2.txt"],
        size: 5,
        originalSize: 5,
        compression: 0,
      },
    ]);
  });

  await t.step("UTF-8 filename", () => {
    const obj = {
      "ファイル.txt": new Uint8Array([72, 69, 76, 76, 79]),
      "✅☺👍.txt": new Uint8Array([72, 69, 76, 76, 79]),
    };

    assertEquals([...expectOk(unzip(expectOk(zip(obj))))], [
      {
        name: "ファイル.txt",
        data: obj["ファイル.txt"],
        size: 5,
        originalSize: 5,
        compression: 0,
      },
      {
        name: "✅☺👍.txt",
        data: obj["✅☺👍.txt"],
        size: 5,
        originalSize: 5,
        compression: 0,
      },
    ]);
  });
});
