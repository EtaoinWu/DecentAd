import { blake2b } from "https://esm.sh/hash-wasm@4.9.0";

import { decode } from "std/encoding/hex.ts";

export type Hashable = string | Buffer | Uint8Array | Uint16Array | Uint32Array;

export function hash_str(item: Hashable): Promise<string> {
  return blake2b(item);
}

export async function hash_bytes(item: Hashable): Promise<Uint8Array> {
  const hash = await hash_str(item);
  const hash_arr = new TextEncoder().encode(hash);
  return decode(hash_arr);
}
