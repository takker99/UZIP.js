import { decode, encode } from "./mod.ts";
import { assertEquals } from "https://deno.land/std@0.214.0/assert/mod.ts";

Deno.test("zip and unzip", async (t) => {
  await t.step("text files", async () => {
    const obj = {
      "file1.txt": new Uint8Array([72, 69, 76, 76, 79]),
      "file2.txt": new Uint8Array([72, 69, 76, 76, 79]),
    };

    for await (const entry of decode(await encode(obj))) {
      assertEquals(
        new Uint8Array(await entry.arrayBuffer()),
        obj[entry.name as keyof typeof obj],
      );
    }
  });

  await t.step("UTF-8 filename", async () => {
    const obj = {
      "ファイル.txt": new Uint8Array([72, 69, 76, 76, 79]),
      "✅☺👍.txt": new Uint8Array([72, 69, 76, 76, 79]),
    };

    for await (const entry of decode(await encode(obj))) {
      assertEquals(
        new Uint8Array(await entry.arrayBuffer()),
        obj[entry.name as keyof typeof obj],
      );
    }
  });
});
