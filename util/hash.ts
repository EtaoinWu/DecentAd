import { crypto } from "crypto";

export async function hash(item: string): Promise<string> {
  const hash_buffer = await crypto.subtle.digest(
    "SHA-384",
    new TextEncoder().encode(item),
  );
  const hash_array = new Uint8Array(hash_buffer);
  return Array.from(hash_array, (b) => b.toString(16).padStart(2, "0")).join("");
}
