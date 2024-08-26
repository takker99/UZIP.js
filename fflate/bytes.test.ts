import { bits, shft, wbits, wbits16 } from "./bytes.ts";
import { assertEquals } from "@std/assert";

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
