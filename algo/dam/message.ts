import { NodeID } from "../../comm/node-prim.ts";
import { Item, Price } from "./item.ts";
import { make_zkprover } from "../../util/zkp.ts";
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
import { aoo2ooa, fix_length } from "../../util/collection.ts";

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

export type TxWinnerWitness = {
  my_name: Scalar;
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
  self_tx_who: Scalar[];
  self_tx_allo: Scalar[];
  self_tx_money: Scalar[];
  parent_s_sigR8x: Scalar;
  parent_s_sigR8y: Scalar;
  parent_s_sigS: Scalar;
  self_t_sigR8x: Scalar;
  self_t_sigR8y: Scalar;
  self_t_sigS: Scalar;
};

export type TxPassWitness = ScatterWitness & {
  child_enabled: Scalar[];
  is_xchild: Scalar[];
  my_name: Scalar;
  self_t_sigR8x: Scalar;
  self_t_sigR8y: Scalar;
  self_t_sigS: Scalar;
  self_tx_allo: Scalar[];
  self_tx_money: Scalar[];
  self_tx_who: Scalar[];
  selfmax: Scalar;
  xchild_t_sigR8x: Scalar;
  xchild_t_sigR8y: Scalar;
  xchild_t_sigS: Scalar;
  xchild_tx_allo: Scalar[];
  xchild_tx_money: Scalar[];
  xchild_tx_who: Scalar[];
};

export type Witness =
  | DiffusionWitness
  | GatherWitness
  | ScatterWitness
  | TxWinnerWitness;
export type Proof = {
  proof: unknown;
  publicSignals: unknown;
};

export const provers = {
  diffusion: await make_zkprover("dam_diffusion"),
  gather: await make_zkprover("dam_gather"),
  scatter: await make_zkprover("dam_scatter"),
  trans_winner: await make_zkprover("dam_trans_winner"),
  trans_pass: await make_zkprover("dam_trans_pass"),
};

async function tx_transpose(txs: TransactionUnit[]) {
  return aoo2ooa(
    await Promise.all(txs.map(async (x) => ({
      who: await crypto.hash_to_field(x.buyer),
      allo: BigInt(x.allocation),
      money: x.transfer,
    }))),
  );
}

export class DAMMessageHandler {
  priv_key: SecKey;
  pub_key: PubKey;
  constructor(
    priv_key: SecKey,
  ) {
    this.priv_key = priv_key;
    this.pub_key = crypto.pubkey(this.priv_key);
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
      const hash_of_zero = crypto.hash([0n, 0n, 0n]);

      return crypto.hash([
        4n,
        ...fix_length(
          await Promise.all(
            msg.transactions.map(async (x) =>
              crypto.hash([
                await crypto.hash_to_field(x.buyer),
                x.allocation ? 1n : 0n,
                x.transfer,
              ])
            ),
          ),
          max_height,
          hash_of_zero,
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

  async tx_winner_witness(
    me: NodeID,
    selfoffer: Scalar,
    s_msg: DAMWrapper<ScatterMsg>,
    tx_msg: DAMWrapper<TransactionResponseMsg>,
    d_wtns: DiffusionWitness,
    g_wtns: GatherWitness,
  ): Promise<TxWinnerWitness> {
    const txs = await tx_transpose(tx_msg.info.transactions);
    return {
      my_name: await crypto.hash_to_field(me),
      child_enabled: g_wtns.child_enabled,
      child_g_sigR8x: g_wtns.child_sigR8x,
      child_g_sigR8y: g_wtns.child_sigR8y,
      child_g_sigS: g_wtns.child_sigS,
      childAx: g_wtns.childAx,
      childAy: g_wtns.childAy,
      childmax: g_wtns.childmax,
      parent_s_sigR8x: s_msg.sig.R8[0],
      parent_s_sigR8y: s_msg.sig.R8[1],
      parent_s_sigS: s_msg.sig.S,
      parentAx: d_wtns.parentAx,
      parentAy: d_wtns.parentAy,
      parentoffer: s_msg.info.external_max,
      self_g_sigR8x: g_wtns.self_sigR8x,
      self_g_sigR8y: g_wtns.self_sigR8y,
      self_g_sigS: g_wtns.self_sigS,
      selfAx: g_wtns.selfAx,
      selfAy: g_wtns.selfAy,
      selfbid: g_wtns.selfbid,
      selfmax: g_wtns.selfmax,
      selfoffer: selfoffer,
      self_t_sigR8x: tx_msg.sig.R8[0],
      self_t_sigR8y: tx_msg.sig.R8[1],
      self_t_sigS: tx_msg.sig.S,
      self_tx_allo: fix_length(txs.allo, max_height, 0n),
      self_tx_money: fix_length(txs.money, max_height, 0n),
      self_tx_who: fix_length(txs.who, max_height, 0n),
    };
  }

  async tx_pass_witness(
    me: NodeID,
    max_index: number,
    tx_up_msg: DAMWrapper<TransactionResponseMsg>,
    tx_down_msg: DAMWrapper<TransactionResponseMsg>,
    _d_wtns: DiffusionWitness,
    _g_wtns: GatherWitness,
    s_wtns: ScatterWitness,
  ): Promise<TxPassWitness> {
    const up_txs = await tx_transpose(tx_up_msg.info.transactions);
    const down_txs = await tx_transpose(tx_down_msg.info.transactions);

    return {
      is_xchild: fix_length(
        Array(max_index).fill(0n).concat(1n),
        max_width,
        0n,
      ),
      my_name: await crypto.hash_to_field(me),
      self_t_sigR8x: tx_up_msg.sig.R8[0],
      self_t_sigR8y: tx_up_msg.sig.R8[1],
      self_t_sigS: tx_up_msg.sig.S,
      self_tx_allo: fix_length(up_txs.allo, max_height, 0n),
      self_tx_money: fix_length(up_txs.money, max_height, 0n),
      self_tx_who: fix_length(up_txs.who, max_height, 0n),
      xchild_t_sigR8x: tx_down_msg.sig.R8[0],
      xchild_t_sigR8y: tx_down_msg.sig.R8[1],
      xchild_t_sigS: tx_down_msg.sig.S,
      xchild_tx_allo: fix_length(down_txs.allo, max_height, 0n),
      xchild_tx_money: fix_length(down_txs.money, max_height, 0n),
      xchild_tx_who: fix_length(down_txs.who, max_height, 0n),
      ...s_wtns,
    };
  }

  witness_to_json<T>(wtns: T): string {
    return encode_bigint_ext(wtns);
  }
}

export type Msg = DAMWrapper<RawMsg>;

export const encode_msg = encode_bigint<Msg>;
export const decode_msg = decode_bigint<Msg>;
