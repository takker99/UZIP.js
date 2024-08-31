import { assertEquals, assertThrows } from "@std/assert";
import { flatten, type ZipOptions, type Zippable } from "./zippable.ts";
import { deflate } from "./deflate.ts";

Deno.test("flatten - single file", () => {
  const file = new Uint8Array([72, 69, 76, 76, 79]);
  const zippable: Zippable = {
    "file.txt": file,
  };
  assertEquals([...flatten(zippable)], [["file.txt", file, {}]]);
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
  assertEquals([...flatten(nested)], [
    ["dir1/", new Uint8Array(), {}],
    ["dir1/file1.txt", file1, {}],
    ["dir2/", new Uint8Array(), {}],
    ["dir2/file2.txt", file2, {}],
    ["dir3/", new Uint8Array(), {}],
    ["dir3/dir4/", new Uint8Array(), {}],
    ["dir3/dir4/file3.txt", file3, {}],
  ]);
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
  const options: ZipOptions = {
    compressionMethods: {
      deflate: (data) => deflate(data),
    },
  };
  assertEquals([...flatten(nested, options)], [
    ["dir1/", new Uint8Array(), {}],
    ["dir1/file1.txt", file1, options],
    ["dir2/", new Uint8Array(), {}],
    ["dir2/file2.txt", file2, options],
  ]);
});
Deno.test("flatten - empty directory", () => {
  assertEquals([...flatten({})], []);
});

Deno.test("flatten - with attributes", () => {
  const directory: Zippable = {
    // Directories can be nested structures, as in an actual filesystem
    "dir1": {
      "nested": {
        // You can use Unicode in filenames
        "你好.txt": new TextEncoder().encode("Hey there!"),
      },
      // You can also manually write out a directory path
      "other/tmp.txt": new Uint8Array([97, 98, 99, 100]),
    },

    // You can also provide compression options
    "massiveImage.bmp": [new Uint8Array(256), {
      mtime: new Date("2022-10-20"),
    }],
    // Directories take options too
    "exec": [{
      "hello.sh": [new TextEncoder().encode("echo hello world"), {
        // ZIP only: Set the operating system to Unix
        os: 3,
        // ZIP only: Make this file executable on Unix
        attrs: 0o755 << 16,
      }],
    }, {
      mtime: new Date("10/20/2020"),
    }],
  };
  assertEquals([...flatten(directory)], [
    ["dir1/", new Uint8Array(), {}],
    ["dir1/nested/", new Uint8Array(), {}],
    ["dir1/nested/你好.txt", new TextEncoder().encode("Hey there!"), {}],
    ["dir1/other/", new Uint8Array(), {}],
    ["dir1/other/tmp.txt", new Uint8Array([97, 98, 99, 100]), {}],
    ["massiveImage.bmp", new Uint8Array(256), {
      mtime: new Date("2022-10-20"),
      compression: undefined,
    }],
    ["exec/", new Uint8Array(), {}],
    ["exec/hello.sh", new TextEncoder().encode("echo hello world"), {
      mtime: new Date("10/20/2020"),
      os: 3,
      attrs: 0o755 << 16,
      compression: undefined,
    }],
  ]);
});

Deno.test("flatten - duplicate file path", () => {
  const directory: Zippable = {
    path: {
      to: {
        "file.txt": new Uint8Array(),
      },
      "to/file.txt": new Uint8Array([97, 98, 99, 100]),
    },
  };
  assertThrows(
    () => [...flatten(directory)],
    "Duplicate path: path/to/file.txt",
  );
});

Deno.test("flatten - duplicate directory path", () => {
  const directory: Zippable = {
    // Directories can be nested structures, as in an actual filesystem
    path: {
      to: {
        "file.txt": new Uint8Array(),
      },
      "to/file2.txt": new Uint8Array([97, 98, 99, 100]),
    },
  };
  assertEquals([...flatten(directory)], [
    ["path/", new Uint8Array(), {}],
    ["path/to/", new Uint8Array(), {}],
    ["path/to/file.txt", new Uint8Array(), {}],
    ["path/to/file2.txt", new Uint8Array([97, 98, 99, 100]), {}],
  ]);
});
