import { Node } from "../../comm/node-base.ts";
import { Communicator } from "../../comm/node-comm.ts";
import { NodeID } from "../../comm/node-prim.ts";
import { Item, Price } from "./item.ts";
import {
  DAMMessageHandler,
  DAMWrapper,
  DiffusionMsg,
  DiffusionWitness,
  GatherMsg,
  GatherWitness,
  Msg,
  Proof,
  provers,
  ScatterMsg,
  ScatterWitness,
  TransactionResponseMsg,
  TransactionUnit,
  Witness,
} from "./message.ts";
import { remove_element } from "../../util/collection.ts";
import { max } from "../../util/algorithm.ts";
import { PubKey, SecKey } from "../../util/crypto.ts";

export interface DAMBaseSetup {
  priv_key: SecKey;
  is_generate_witness?: boolean;
  is_generate_proof?: boolean;
}

export interface DAMSellerSetup extends DAMBaseSetup {
  item: Item;
}

export interface DAMBuyerSetup extends DAMBaseSetup {
  parent: NodeID;
  evaluation: (item: Item) => Promise<Price>;
}

export type DAMSetup = DAMSellerSetup | DAMBuyerSetup;

export class DAMNodeBase<T = void> extends Node<Msg, T> {
  base_setup: DAMBaseSetup;
  mh: DAMMessageHandler | null;
  pub_key: PubKey | null;
  neighbor_pk: Map<NodeID, PubKey>;

  constructor(
    me: NodeID,
    comm: Communicator<Msg>,
    base_setup: DAMBaseSetup,
  ) {
    super(me, comm);
    this.base_setup = base_setup;
    this.mh = new DAMMessageHandler(base_setup.priv_key);
    this.pub_key = this.mh.pub_key;
    this.neighbor_pk = new Map();
  }

  async exchange_pubkeys() {
    const mh = this.mh!;
    const neighbors = await this.comm.neighbors();
    const pub_key_msg = await mh.wrap({
      type: "DAM_PubKey",
      pub_key: mh.pub_key,
    });
    await Promise.all(neighbors.map(async (node) => {
      await this.comm.send_message(node, pub_key_msg);
    }));
    await Promise.all(neighbors.map(async (node) => {
      const msg = await this.comm.get_message(node);
      const unwrapped = await mh.unwrap(msg.message);
      if (unwrapped.type !== "DAM_PubKey") {
        throw new Error("Unexpected message");
      }
      this.neighbor_pk.set(node, unwrapped.pub_key);
    }));
  }
}

export class DAMSellerNode extends DAMNodeBase<TransactionUnit[]> {
  setup: DAMSellerSetup;

  constructor(
    me: NodeID,
    comm: Communicator<Msg>,
    setup: DAMSellerSetup,
  ) {
    super(me, comm, setup);
    this.setup = setup;
  }

  async run(): Promise<TransactionUnit[]> {
    await this.exchange_pubkeys();

    const mh = this.mh!;
    const children = await this.comm.neighbors();
    const item = this.setup.item;
    const init_msg = await mh.wrap({
      type: "DAM_Diffusion",
      seller: this.me,
      item: item,
    });

    // Round 1 -- Diffusion
    await Promise.all(children.map(async (node) => {
      await this.comm.send_message(node, init_msg);
    }));

    // Round 2 -- Gather
    const responses = await Promise.all(children.map(async (node, i) => {
      const msg = await this.comm.get_message(node);
      const unwrapped = await mh.verify_and_unwrap(
        msg.message,
        this.neighbor_pk.get(node)!,
      );
      if (unwrapped.type !== "DAM_Gather") {
        throw new Error("Unexpected message");
      }
      return { index: i, subtree_max: unwrapped.subtree_max };
    }));
    responses.sort((a, b) => (a.subtree_max > b.subtree_max) ? -1 : 1);
    const max_index = responses[0].index;
    const max_neighbor = children[max_index];
    const second_max_price = responses[1].subtree_max;

    // Round 3 -- Scatter
    const sell_msg = await mh.wrap({
      type: "DAM_Scatter",
      external_max: second_max_price,
    });
    await this.comm.send_message(max_neighbor, sell_msg);

    // Round 4 -- Transaction Response
    const transaction_msg = await this.comm.get_message(max_neighbor);
    const transaction_unwrapped = await mh.verify_and_unwrap(
      transaction_msg.message,
      this.neighbor_pk.get(max_neighbor)!,
    );
    if (transaction_unwrapped.type !== "DAM_TResponse") {
      throw new Error("Unexpected message");
    }
    const transactions = transaction_unwrapped.transactions;
    const total_transfer = transactions.reduce(
      (acc, x) => acc + x.transfer,
      0n,
    );
    const seller_tx: TransactionUnit = {
      buyer: this.me,
      transfer: -total_transfer,
      allocation: 0,
    };
    return [seller_tx, ...transactions];
  }
}

export class DAMBuyerNode extends DAMNodeBase {
  setup: DAMBuyerSetup;
  witnesses: Witness[] = [];
  proofs: Proof[] = [];

  constructor(
    me: NodeID,
    comm: Communicator<Msg>,
    setup: DAMBuyerSetup,
  ) {
    super(me, comm, setup);
    this.setup = setup;
  }

  async run(): Promise<void> {
    await this.exchange_pubkeys();

    const mh = this.mh!;

    const parent = this.setup.parent;
    const evaluation = this.setup.evaluation;
    const children = remove_element(await this.comm.neighbors(), parent);

    // Round 1 -- Diffusion
    const d_up_msg = (await this.comm.get_message(parent)).message;
    const d_up_unwrapped = await mh.verify_and_unwrap(
      d_up_msg,
      this.neighbor_pk.get(parent)!,
    );
    if (d_up_unwrapped.type !== "DAM_Diffusion") {
      throw new Error("Unexpected message");
    }

    const item = d_up_unwrapped.item;
    const val = await evaluation(item);
    const price = val;

    const d_down_msg = await mh.wrap(d_up_unwrapped);
    if (this.base_setup.is_generate_witness) {
      const d_witness = await mh.diffusion_witness(
        d_up_msg as DAMWrapper<DiffusionMsg>,
        d_down_msg,
        this.neighbor_pk.get(parent)!,
      );
      this.witnesses.push(d_witness);
      if (this.base_setup.is_generate_proof) {
        this.proofs.push(
          await provers.diffusion.full_prove(d_witness),
        );
      }
    }

    await Promise.all(children.map(async (node) => {
      await this.comm.send_message(
        node,
        d_down_msg,
      );
    }));

    // Round 2 -- Gather
    const g_down_msgs = await Promise.all(
      children.map(async (node) => {
        return (await this.comm.get_message(node)).message;
      }),
    );
    const g_down_unwrapped = await Promise.all(
      children.map(async (node, i) => {
        const msg = g_down_msgs[i];
        const unwrapped = await mh.verify_and_unwrap(
          msg,
          this.neighbor_pk.get(node)!,
        );
        if (unwrapped.type !== "DAM_Gather") {
          throw new Error("Unexpected message");
        }
        return unwrapped;
      }),
    );

    const children_maxes = g_down_unwrapped.map((x) => x.subtree_max);
    const max_price = max(price, ...children_maxes);
    const max_index = children_maxes.indexOf(max_price);
    const max_child = children[max_index];
    const all_but_max = remove_element([price, ...children_maxes], max_price);
    const second_max = max(0n, ...all_but_max);

    const gather_up_msg = await mh.wrap({
      type: "DAM_Gather",
      subtree_max: max_price,
    });
    if (this.base_setup.is_generate_witness) {
      const g_witness = await mh.gather_witness(
        gather_up_msg,
        g_down_msgs as DAMWrapper<GatherMsg>[],
        children.map((x) => this.neighbor_pk.get(x)!),
        price,
        max_price,
      );
      this.witnesses.push(g_witness);
      if (this.base_setup.is_generate_proof) {
        this.proofs.push(
          await provers.gather.full_prove(g_witness),
        );
      }
    }
    await this.comm.send_message(parent, gather_up_msg);

    // Round 3 -- Scatter
    const s_up_msg = (await this.comm.get_message(parent)).message;
    const s_up_unwrapped = await mh.verify_and_unwrap(
      s_up_msg,
      this.neighbor_pk.get(parent)!,
    );
    if (s_up_unwrapped.type !== "DAM_Scatter") {
      throw new Error("Unexpected message");
    }

    const offered_price = s_up_unwrapped.external_max;
    const child_offer = max(second_max, offered_price);
    if (child_offer <= price) {
      // Keep
      const tx = { buyer: this.me, transfer: -offered_price, allocation: 1 };
      const tx_msg = await mh.wrap({
        type: "DAM_TResponse",
        transactions: [tx],
      });
      if (this.base_setup.is_generate_witness) {
        const t_witness = await mh.tx_winner_witness(
          this.me,
          child_offer,
          s_up_msg as DAMWrapper<ScatterMsg>,
          tx_msg,
          ...this.witnesses as [DiffusionWitness, GatherWitness],
        );
        this.witnesses.push(t_witness);
        if (this.base_setup.is_generate_proof) {
          this.proofs.push(
            await provers.trans_winner.full_prove(t_witness),
          );
        }
      }
      await this.comm.send_message(parent, tx_msg);
    } else {
      // Resell
      const s_down_msg = await mh.wrap({
        type: "DAM_Scatter",
        external_max: child_offer,
      });
      if (this.base_setup.is_generate_witness) {
        const s_witness = await mh.scatter_witness(
          s_up_msg as DAMWrapper<ScatterMsg>,
          s_down_msg,
          ...this.witnesses as [DiffusionWitness, GatherWitness],
        );
        this.witnesses.push(s_witness);
        if (this.base_setup.is_generate_proof) {
          this.proofs.push(
            await provers.scatter.full_prove(s_witness),
          );
        }
      }
      await this.comm.send_message(max_child, s_down_msg);

      // Round 4 -- Transaction Response
      const tx_down_msg = (await this.comm.get_message(max_child)).message;
      const tx_down_unwrapped = await mh.verify_and_unwrap(
        tx_down_msg,
        this.neighbor_pk.get(max_child)!,
      );
      if (tx_down_unwrapped.type !== "DAM_TResponse") {
        throw new Error("Unexpected message");
      }
      const tx = {
        buyer: this.me,
        transfer: child_offer - offered_price,
        allocation: 0,
      };
      const tx_up_msg = await mh.wrap({
        type: "DAM_TResponse",
        transactions: [tx, ...tx_down_unwrapped.transactions],
      });
      if (this.base_setup.is_generate_witness) {
        const t_witness = await mh.tx_pass_witness(
          this.me,
          max_index,
          tx_up_msg,
          tx_down_msg as DAMWrapper<TransactionResponseMsg>,
          ...this.witnesses as [
            DiffusionWitness,
            GatherWitness,
            ScatterWitness,
          ],
        );
        this.witnesses.push(t_witness);
        if (this.base_setup.is_generate_proof) {
          this.proofs.push(
            await provers.trans_pass.full_prove(t_witness),
          );
        }
      }
      await this.comm.send_message(parent, tx_up_msg);
    }
  }
}

type DAMNode = DAMSellerNode | DAMBuyerNode;
