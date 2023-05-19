export function encode_bigint<T>(msg: T): string {
  return JSON.stringify(
    msg,
    (_, v) => typeof v === "bigint" ? v.toString() + "n" : v,
  );
}

export function encode_bigint_ext<T>(msg: T): string {
  return JSON.stringify(
    msg,
    (_, v) => typeof v === "bigint" ? v.toString() : v,
  );
}

export function decode_bigint<T>(msg: string): T {
  return JSON.parse(
    msg,
    (_, v) =>
      typeof v === "string" && /^\-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v,
  );
}
