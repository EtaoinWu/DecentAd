import { NodeID } from "../../comm/node-prim.ts";
import { Item, Price } from "./item.ts";
import { make_zkprover, ZKProver } from "../../util/zkp.ts";
import {
  crypto,
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

export const max_height = 8;
export const max_width = 4;

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

export type DiffusionWitness = Record<DiffusionWitnessFields, Scalar>;

export type GatherWitness = {
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

export type ScatterWitness = {
  selfAx: Scalar;
  selfAy: Scalar;
  parentAx: Scalar;
  parentAy: Scalar;
  childAx: Scalar[];
  childAy: Scalar[];
  child_enabled: Scalar[];
  childmax: Scalar[];
  selfbid: Scalar;
  selfmax: Scalar;
  self_g_sigR8x: Scalar;
  self_g_sigR8y: Scalar;
  self_g_sigS: Scalar;
  child_g_sigR8x: Scalar[];
  child_g_sigR8y: Scalar[];
  child_g_sigS: Scalar[];
  parentoffer: Scalar;
  selfoffer: Scalar;
  self_s_sigR8x: Scalar;
  self_s_sigR8y: Scalar;
  self_s_sigS: Scalar;
  parent_s_sigR8x: Scalar;
  parent_s_sigR8y: Scalar;
  parent_s_sigS: Scalar;
};

export type Witness = DiffusionWitness | GatherWitness | ScatterWitness;
export type Proof = {
  proof: unknown;
  publicSignals: unknown;
};

const prover_names = ["dam_diffusion", "dam_gather", "dam_scatter"];

const provers: ZKProver[] = await Promise.all(prover_names.map((name) => {
  return make_zkprover(name);
}));

export class DAMMessageHandler {
  priv_key: SecKey;
  pub_key: PubKey;
  provers: ZKProver[];
  constructor(
    priv_key: SecKey,
  ) {
    this.priv_key = priv_key;
    this.pub_key = crypto.pubkey(this.priv_key);
    this.provers = provers;
  }

  async hash_message<T extends RawMsg>(msg: T): Promise<Scalar> {
    if (msg.type === "DAM_PubKey") {
      return crypto.hash([0n, ...msg.pub_key]);
    } else if (msg.type === "DAM_Diffusion") {
      return crypto.hash([
        1n,
        await crypto.hash_to_field(msg.seller),
        await crypto.hash_to_field(msg.item),
      ]);
    } else if (msg.type === "DAM_Gather") {
      return crypto.hash([
        2n,
        msg.subtree_max,
      ]);
    } else if (msg.type === "DAM_Scatter") {
      return crypto.hash([
        3n,
        msg.external_max,
      ]);
    } else {
      return crypto.hash([
        4n,
        ...await Promise.all(
          msg.transactions.map(async (x) =>
            crypto.hash([
              await crypto.hash_to_field(x.buyer),
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
    const sig = await crypto.sign(this.priv_key, hash!);
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
    return crypto.verify(pk, hash, sig);
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
      item: await crypto.hash_to_field(up_msg.info.item),
      parent_sigR8x: up_msg.sig.R8[0],
      parent_sigR8y: up_msg.sig.R8[1],
      parent_sigS: up_msg.sig.S,
      parentAx: parent_pk[0],
      parentAy: parent_pk[1],
      self_sigR8x: down_msg.sig.R8[0],
      self_sigR8y: down_msg.sig.R8[1],
      self_sigS: down_msg.sig.S,
      selfAx: this.pub_key[0],
      selfAy: this.pub_key[1],
      seller: await crypto.hash_to_field(up_msg.info.seller),
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
      selfAx: this.pub_key[0],
      selfAy: this.pub_key[1],
      childAx: fix_length(
        child_pks.map((x) => x[0]),
        max_width,
        this.pub_key[0],
      ),
      childAy: fix_length(
        child_pks.map((x) => x[1]),
        max_width,
        this.pub_key[1],
      ),
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

  scatter_witness(
    up_msg: DAMWrapper<ScatterMsg>,
    down_msg: DAMWrapper<ScatterMsg>,
    d_wtns: DiffusionWitness,
    g_wtns: GatherWitness,
  ): ScatterWitness {
    return {
      selfAx: g_wtns.selfAx,
      selfAy: g_wtns.selfAy,
      parentAx: d_wtns.parentAx,
      parentAy: d_wtns.parentAy,
      childAx: g_wtns.childAx,
      childAy: g_wtns.childAy,
      child_enabled: g_wtns.child_enabled,
      childmax: g_wtns.childmax,
      selfbid: g_wtns.selfbid,
      selfmax: g_wtns.selfmax,
      self_g_sigR8x: g_wtns.self_sigR8x,
      self_g_sigR8y: g_wtns.self_sigR8y,
      self_g_sigS: g_wtns.self_sigS,
      child_g_sigR8x: g_wtns.child_sigR8x,
      child_g_sigR8y: g_wtns.child_sigR8y,
      child_g_sigS: g_wtns.child_sigS,
      parentoffer: up_msg.info.external_max,
      selfoffer: down_msg.info.external_max,
      parent_s_sigR8x: up_msg.sig.R8[0],
      parent_s_sigR8y: up_msg.sig.R8[1],
      parent_s_sigS: up_msg.sig.S,
      self_s_sigR8x: down_msg.sig.R8[0],
      self_s_sigR8y: down_msg.sig.R8[1],
      self_s_sigS: down_msg.sig.S,
    };
  }

  witness_to_json<T>(wtns: T): string {
    return encode_bigint_ext(wtns);
  }
}

export type Msg = DAMWrapper<RawMsg>;

export const encode_msg = encode_bigint<Msg>;
export const decode_msg = decode_bigint<Msg>;
