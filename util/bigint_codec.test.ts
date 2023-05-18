import { assertEquals } from "std/testing/asserts.ts";
import { decode_bigint, encode_bigint } from "./bigint_codec.ts";

Deno.test("encoding and decoding bigints", async (t) => {
  await t.step("array of bigints", () => {
    const arr = [1n, 2n, 3n];
    const encoded = encode_bigint(arr);
    const decoded = decode_bigint<bigint[]>(encoded);
    assertEquals(arr, decoded);
  });

  await t.step("object of bigints", () => {
    const obj = { a:-1n, b: 0n, c: -3n, d: 4, e: "n", f: "strin" };
    const encoded = encode_bigint(obj);
    const decoded = decode_bigint<typeof obj>(encoded);
    assertEquals(obj, decoded);
  });

  await t.step("complicated object", () => {
    const obj = {
      a: 1n,
      b: -2n,
      c: [-3n, 0n, 5, { g: 6n }, { h: "nstrn" }],
      d: 4,
      e: "n",
      f: "strin",
    };
    const encoded = encode_bigint(obj);
    const decoded = decode_bigint<typeof obj>(encoded);
    assertEquals(obj, decoded);
  });
});
