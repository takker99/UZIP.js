import { assertEquals } from "@std/assert";
import { flatten, type FlatZippable, type Zippable } from "./zippable.ts";

Deno.test("flatten - single file", () => {
  const file = new Uint8Array([72, 69, 76, 76, 79]);
  const zippable: Zippable = {
    "file.txt": file,
  };
  const expected: FlatZippable = {
    "file.txt": [file, {}],
  };
  const result = flatten(zippable, "", {});
  assertEquals(result, expected);
});

Deno.test("flatten - nested directory", () => {
  const file1 = new Uint8Array([72, 69, 76, 76, 79]);
  const file2 = new Uint8Array([87, 79, 82, 76, 68]);
  const file3 = new Uint8Array([72, 69, 76, 76, 80]);
  const nested: Zippable = {
    dir1: {
      "file1.txt": file1,
    },
    dir2: {
      "file2.txt": file2,
    },
    dir3: {
      dir4: {
        "file3.txt": file3,
      },
    },
  };
  const expected: FlatZippable = {
    "dir1/": [new Uint8Array(), {}],
    "dir1/file1.txt": [file1, {}],
    "dir2/": [new Uint8Array(), {}],
    "dir2/file2.txt": [file2, {}],
    "dir3/": [new Uint8Array(), {}],
    "dir3/dir4/": [new Uint8Array(), {}],
    "dir3/dir4/file3.txt": [file3, {}],
  };
  const result = flatten(nested, "", {});
  assertEquals(result, expected);
});

Deno.test("flatten - nested directory with options", () => {
  const file1 = new Uint8Array([72, 69, 76, 76, 79]);
  const file2 = new Uint8Array([87, 79, 82, 76, 68]);
  const nested: Zippable = {
    dir1: {
      "file1.txt": file1,
    },
    dir2: {
      "file2.txt": file2,
    },
  };
  const options = {
    compressionLevel: 9,
    os: 3,
  };
  const expected: FlatZippable = {
    "dir1/": [new Uint8Array(), options],
    "dir1/file1.txt": [file1, options],
    "dir2/": [new Uint8Array(), options],
    "dir2/file2.txt": [file2, options],
  };
  const result = flatten(nested, "", options);
  assertEquals(result, expected);
});
