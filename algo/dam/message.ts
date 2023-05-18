import { NodeID } from "../../comm/node-prim.ts";
import { Item, Price } from "./item.ts";
import {
  make_crypto,
  PubKey,
  Scalar,
  SecKey,
  Signature,
} from "../../util/crypto.ts";
import { decode_bigint, encode_bigint } from "../../util/bigint_codec.ts";

export type PubkeyExchangeMsg = {
  type: "DAM_PubKey";
  pub_key: PubKey;
};

export type DiffusionMsg = {
  type: "DAM_Diffusion";
  seller: NodeID;
  item: Item;
};

export type GatherMsg = {
  type: "DAM_Gather";
  subtree_max: Price;
};

export type ScatterMsg = {
  type: "DAM_Scatter";
  external_max: Price;
};

export type TransactionUnit = {
  buyer: NodeID;
  transfer: Price;
  allocation: number;
};

export type TransactionResponseMsg = {
  type: "DAM_TResponse";
  transactions: Array<TransactionUnit>;
};

export class DAMWrapper<T extends RawMsg> {
  info: T;
  hash: Scalar;
  sig: Signature;
  constructor(info: T, hash: Scalar, sig: Signature) {
    this.info = info;
    this.hash = hash;
    this.sig = sig;
  }
}

type RawMsg =
  | PubkeyExchangeMsg
  | DiffusionMsg
  | GatherMsg
  | ScatterMsg
  | TransactionResponseMsg;

export class DAMMessageHandler {
  crypto: Awaited<ReturnType<typeof make_crypto>>;
  priv_key: SecKey;
  constructor(
    crypto: Awaited<ReturnType<typeof make_crypto>>,
    priv_key: SecKey,
  ) {
    this.crypto = crypto;
    this.priv_key = priv_key;
  }

  pub_key(): PubKey {
    return this.crypto.pubkey(this.priv_key);
  }

  async hash_message(msg: RawMsg): Promise<Scalar> {
    if (msg.type === "DAM_PubKey") {
      return this.crypto.hash([0n, ...msg.pub_key]);
    } else if (msg.type === "DAM_Diffusion") {
      return this.crypto.hash([
        1n,
        await this.crypto.hash_to_field(msg.seller),
        await this.crypto.hash_to_field(msg.seller),
      ]);
    } else if (msg.type === "DAM_Gather") {
      return this.crypto.hash([
        2n,
        msg.subtree_max,
      ]);
    } else if (msg.type === "DAM_Scatter") {
      return this.crypto.hash([
        3n,
        msg.external_max,
      ]);
    } else {
      return this.crypto.hash([
        4n,
        ...await Promise.all(
          msg.transactions.map(async (x) =>
            this.crypto.hash([
              await this.crypto.hash_to_field(x.buyer),
              x.allocation ? 1n : 0n,
              x.transfer,
            ])
          ),
        ),
      ]);
    }
  }

  async wrap(msg: RawMsg): Promise<DAMWrapper<RawMsg>> {
    const hash = await this.hash_message(msg);
    const sig = await this.crypto.sign(this.priv_key, hash!);
    return new DAMWrapper(msg, hash!, sig);
  }

  unwrap(msg: DAMWrapper<RawMsg>): Promise<RawMsg> {
    return Promise.resolve(msg.info);
  }

  async verify(msg: DAMWrapper<RawMsg>, pk: PubKey): Promise<boolean> {
    const hash = await this.hash_message(msg.info);
    if (hash !== msg.hash) return false;
    const sig = msg.sig;
    return this.crypto.verify(pk, hash, sig);
  }

  async must_verify(msg: DAMWrapper<RawMsg>, pk: PubKey): Promise<void> {
    if (!(await this.verify(msg, pk))) throw new Error("Invalid signature");
  }

  async verify_and_unwrap(
    msg: DAMWrapper<RawMsg>,
    pk: PubKey,
  ): Promise<RawMsg> {
    await this.must_verify(msg, pk);
    return this.unwrap(msg);
  }
}

export async function make_message_handler(
  priv_key: SecKey,
): Promise<DAMMessageHandler> {
  return new DAMMessageHandler(await make_crypto(), priv_key);
}

export type Msg = DAMWrapper<RawMsg>;

export const encode_msg = encode_bigint<Msg>;
export const decode_msg = decode_bigint<Msg>;
