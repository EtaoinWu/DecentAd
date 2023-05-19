import { NodeID } from "../../comm/node-prim.ts";
import { Item, Price } from "./item.ts";
import {
  make_crypto,
  PubKey,
  Scalar,
  SecKey,
  Signature,
} from "../../util/crypto.ts";
import {
  decode_bigint,
  encode_bigint,
  encode_bigint_ext,
} from "../../util/bigint_codec.ts";
import { fix_length } from "../../util/collection.ts";

const max_height = 8;
const max_width = 4;

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

type DiffusionWitnessFields =
  | "item"
  | "parent_sigR8x"
  | "parent_sigR8y"
  | "parent_sigS"
  | "parentAx"
  | "parentAy"
  | "self_sigR8x"
  | "self_sigR8y"
  | "self_sigS"
  | "selfAx"
  | "selfAy"
  | "seller";

type DiffusionWitness = Record<DiffusionWitnessFields, Scalar>;

type GatherWitness = {
  self_sigR8x: Scalar;
  self_sigR8y: Scalar;
  self_sigS: Scalar;
  selfAx: Scalar;
  selfAy: Scalar;
  childAx: Scalar[];
  childAy: Scalar[];
  child_enabled: Scalar[];
  childmax: Scalar[];
  selfbid: Scalar;
  selfmax: Scalar;
  child_sigR8x: Scalar[];
  child_sigR8y: Scalar[];
  child_sigS: Scalar[];
};

export type Witness = DiffusionWitness | GatherWitness;

export class DAMMessageHandler {
  crypto: Awaited<ReturnType<typeof make_crypto>>;
  priv_key: SecKey;
  pub_key_memo: PubKey | null;
  constructor(
    crypto: Awaited<ReturnType<typeof make_crypto>>,
    priv_key: SecKey,
  ) {
    this.crypto = crypto;
    this.priv_key = priv_key;
    this.pub_key_memo = null;
  }

  pub_key(): PubKey {
    if (this.pub_key_memo === null) {
      this.pub_key_memo = this.crypto.pubkey(this.priv_key);
    }
    return this.pub_key_memo;
  }

  async hash_message<T extends RawMsg>(msg: T): Promise<Scalar> {
    if (msg.type === "DAM_PubKey") {
      return this.crypto.hash([0n, ...msg.pub_key]);
    } else if (msg.type === "DAM_Diffusion") {
      return this.crypto.hash([
        1n,
        await this.crypto.hash_to_field(msg.seller),
        await this.crypto.hash_to_field(msg.item),
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

  async wrap<T extends RawMsg>(msg: T): Promise<DAMWrapper<T>> {
    const hash = await this.hash_message(msg);
    const sig = await this.crypto.sign(this.priv_key, hash!);
    return new DAMWrapper(msg, hash!, sig);
  }

  unwrap<T extends RawMsg>(msg: DAMWrapper<T>): Promise<T> {
    return Promise.resolve(msg.info);
  }

  async verify<T extends RawMsg>(
    msg: DAMWrapper<T>,
    pk: PubKey,
  ): Promise<boolean> {
    const hash = await this.hash_message(msg.info);
    if (hash !== msg.hash) return false;
    const sig = msg.sig;
    return this.crypto.verify(pk, hash, sig);
  }

  async must_verify<T extends RawMsg>(
    msg: DAMWrapper<T>,
    pk: PubKey,
  ): Promise<void> {
    if (!(await this.verify(msg, pk))) throw new Error("Invalid signature");
  }

  async verify_and_unwrap<T extends RawMsg>(
    msg: DAMWrapper<T>,
    pk: PubKey,
  ): Promise<T> {
    await this.must_verify(msg, pk);
    return this.unwrap(msg);
  }

  async diffusion_witness(
    up_msg: DAMWrapper<DiffusionMsg>,
    down_msg: DAMWrapper<DiffusionMsg>,
    parent_pk: PubKey,
  ): Promise<DiffusionWitness> {
    return {
      item: await this.crypto.hash_to_field(up_msg.info.item),
      parent_sigR8x: up_msg.sig.R8[0],
      parent_sigR8y: up_msg.sig.R8[1],
      parent_sigS: up_msg.sig.S,
      parentAx: parent_pk[0],
      parentAy: parent_pk[1],
      self_sigR8x: down_msg.sig.R8[0],
      self_sigR8y: down_msg.sig.R8[1],
      self_sigS: down_msg.sig.S,
      selfAx: this.pub_key()[0],
      selfAy: this.pub_key()[1],
      seller: await this.crypto.hash_to_field(up_msg.info.seller),
    };
  }

  gather_witness(
    up_msg: DAMWrapper<GatherMsg>,
    down_msgs: DAMWrapper<GatherMsg>[],
    child_pks: PubKey[],
    bid: Scalar,
    max_price: Scalar,
  ): GatherWitness {
    const pad = (x: Scalar[]) => fix_length(x, max_width, 0n);
    return {
      selfAx: this.pub_key()[0],
      selfAy: this.pub_key()[1],
      childAx: fix_length(child_pks.map((x) => x[0]), max_width, this.pub_key()[0]),
      childAy: fix_length(child_pks.map((x) => x[1]), max_width, this.pub_key()[1]),
      child_enabled: pad(down_msgs.map((_) => 1n)),
      childmax: pad(down_msgs.map((x) => x.info.subtree_max)),
      selfbid: bid,
      selfmax: max_price,
      self_sigR8x: up_msg.sig.R8[0],
      self_sigR8y: up_msg.sig.R8[1],
      self_sigS: up_msg.sig.S,
      child_sigR8x: pad(down_msgs.map((x) => x.sig.R8[0])),
      child_sigR8y: pad(down_msgs.map((x) => x.sig.R8[1])),
      child_sigS: pad(down_msgs.map((x) => x.sig.S)),
    };
  }

  witness_to_json<T>(wtns: T): string {
    return encode_bigint_ext(wtns);
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
