import { expectOk, unzip, zip } from "./mod.ts";
import { assertEquals } from "@std/assert";

Deno.test("zip and unzip", async (t) => {
  await t.step("text files", () => {
    const obj = {
      "file1.txt": new Uint8Array([72, 69, 76, 76, 79]),
      "file2.txt": new Uint8Array([72, 69, 76, 76, 79]),
    };

    assertEquals(expectOk(unzip(expectOk(zip(obj)))), {
      "file1.txt": {
        data: obj["file1.txt"],
        size: 5,
        originalSize: 5,
        compression: 0,
      },
      "file2.txt": {
        data: obj["file2.txt"],
        size: 5,
        originalSize: 5,
        compression: 0,
      },
    });
  });

  await t.step("UTF-8 filename", () => {
    const obj = {
      "ファイル.txt": new Uint8Array([72, 69, 76, 76, 79]),
      "✅☺👍.txt": new Uint8Array([72, 69, 76, 76, 79]),
    };

    assertEquals(expectOk(unzip(expectOk(zip(obj)))), {
      "ファイル.txt": {
        data: obj["ファイル.txt"],
        size: 5,
        originalSize: 5,
        compression: 0,
      },
      "✅☺👍.txt": {
        data: obj["✅☺👍.txt"],
        size: 5,
        originalSize: 5,
        compression: 0,
      },
    });
  });
});
