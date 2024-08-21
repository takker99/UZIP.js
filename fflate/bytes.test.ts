import {
  bits,
  getUint16,
  getUint32,
  getUint64,
  setUint,
  shft,
  wbits,
  wbits16,
} from "./bytes.ts";
import { assertEquals } from "@std/assert";

Deno.test("b2 should read 2 bytes correctly", () => {
  const buffer = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
  assertEquals(getUint16(buffer, 0), 0x0201);
  assertEquals(getUint16(buffer, 2), 0x0403);
});

Deno.test("b4 should read 4 bytes correctly", () => {
  const buffer = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
  assertEquals(getUint32(buffer, 0), 0x04030201);
  assertEquals(getUint32(buffer, 2), 0x06050403);
});

Deno.test("b8 should read 8 bytes correctly", () => {
  // deno-fmt-ignore
  const buffer = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A]);
  assertEquals(getUint64(buffer, 0), 0x0807060504030201);
  assertEquals(getUint64(buffer, 2), 0x0A09080706050403);
});

Deno.test("wbytes should write bytes correctly", () => {
  const buffer = new Uint8Array(4);
  setUint(buffer, 0, 0x04030201);
  assertEquals(buffer, new Uint8Array([0x01, 0x02, 0x03, 0x04]));
});

Deno.test("bits should read bits correctly", () => {
  const buffer = new Uint8Array([0b10101010, 0b01010101]);
  assertEquals(bits(buffer, 0, 0b1111), 0b1010);
  assertEquals(bits(buffer, 4, 0b1111), 0b1010);
  assertEquals(bits(buffer, 8, 0b1111), 0b0101);
});

Deno.test("wbits should write bits correctly", () => {
  const buffer = new Uint8Array(2);
  wbits(buffer, 0, 0b1010);
  assertEquals(buffer, new Uint8Array([0b1010, 0x00]));
});

Deno.test("wbits16 should write bits (>8) correctly", () => {
  const buffer = new Uint8Array(3);
  wbits16(buffer, 0, 0b10101010);
  assertEquals(buffer, new Uint8Array([0b10101010, 0x00, 0x00]));
});
Deno.test("shft should calculate the end of byte correctly", () => {
  assertEquals(shft(0), 0);
  assertEquals(shft(1), 1);
  assertEquals(shft(7), 1);
  assertEquals(shft(8), 1);
  assertEquals(shft(9), 2);
  assertEquals(shft(15), 2);
  assertEquals(shft(16), 2);
  assertEquals(shft(17), 3);
});
