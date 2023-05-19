import * as circomlibjs from "https://esm.sh/circomlibjs@0.1.7?pin=v122";
import { Buffer } from "std/io/buffer.ts";
import { hash_bytes, Hashable } from "./hash.ts";

export type BufferFromAble = Uint8Array | string | number[] | Buffer;

export type Scalar = bigint;

export type CurvePointT<T> = [T, T];
export type PubKeyT<T> = CurvePointT<T>;
export type SignatureT<T> = { R8: CurvePointT<T>; S: Scalar };

export type PubKey = PubKeyT<Scalar>;
export type Signature = SignatureT<Scalar>;

type Internal = Uint8Array;
type PubKeyInternal = PubKeyT<Uint8Array>;
type SignatureInternal = SignatureT<Uint8Array>;

export type SecKey = BufferFromAble;

export interface Crypto<T> {
  hash(xs: T[]): T;
  hash_to_field(x: Hashable): Promise<T>;
  pubkey(sk: SecKey): PubKeyT<T>;
  sign(sk: SecKey, msg: T): SignatureT<T>;
  verify(pk: PubKeyT<T>, msg: T, sig: SignatureT<T>): boolean;
}

function crypto_bimap<U, V>(
  c: Crypto<U>,
  l: (u: U) => V,
  r: (v: V) => U,
): Crypto<V> {
  const lcp = (cp: CurvePointT<U>) => [l(cp[0]), l(cp[1])] as CurvePointT<V>;
  const rcp = (cp: CurvePointT<V>) => [r(cp[0]), r(cp[1])] as CurvePointT<U>;
  const lsig = (sig: SignatureT<U>) => ({ R8: lcp(sig.R8), S: sig.S });
  const rsig = (sig: SignatureT<V>) => ({ R8: rcp(sig.R8), S: sig.S });

  return {
    hash: (xs: V[]) => l(c.hash(xs.map(r))),
    hash_to_field: (x: Hashable) => c.hash_to_field(x).then(l),
    pubkey: (sk: SecKey) => lcp(c.pubkey(sk)),
    sign: (sk: SecKey, msg: V) => lsig(c.sign(sk, r(msg))),
    verify: (pk: PubKeyT<V>, msg: V, sig: SignatureT<V>) =>
      c.verify(rcp(pk), r(msg), rsig(sig)),
  };
}

let crypto: Crypto<Scalar> | null = null;

async function make_crypto_work(): Promise<Crypto<Scalar>> {
  const eddsa = await circomlibjs.buildEddsa();
  const F = eddsa.F;
  const internal: Crypto<Internal> = {
    hash: (xs: Internal[]) => eddsa.mimc7.multiHash(xs),
    hash_to_field: hash_bytes,
    pubkey: (sk: SecKey) => eddsa.prv2pub(sk),
    sign: (sk: SecKey, msg: Internal) => eddsa.signMiMC(sk, msg),
    verify: (pk: PubKeyInternal, msg: Internal, sig: SignatureInternal) =>
      eddsa.verifyMiMC(msg, sig, pk),
  };
  const l = (x: Internal) => F.toObject(x) as Scalar;
  const r = (x: Scalar) => F.fromObject(x) as Internal;
  return crypto_bimap(internal, l, r);
}

export async function make_crypto(): Promise<Crypto<Scalar>> {
  if (crypto === null) {
    crypto = await make_crypto_work();
  }
  return crypto;
}
