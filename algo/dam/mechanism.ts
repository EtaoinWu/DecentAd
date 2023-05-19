import { Node } from "../../comm/node-base.ts";
import { Communicator } from "../../comm/node-comm.ts";
import { NodeID } from "../../comm/node-prim.ts";
import { Item, Price } from "./item.ts";
import * as DAMMsg from "./message.ts";
import { remove_element } from "../../util/collection.ts";
import { max } from "../../util/algorithm.ts";
import { PubKey, SecKey } from "../../util/crypto.ts";

export interface DAMBaseSetup {
  priv_key: SecKey;
}

export interface DAMSellerSetup extends DAMBaseSetup {
  item: Item;
}

export interface DAMBuyerSetup extends DAMBaseSetup {
  parent: NodeID;
  evaluation: (item: Item) => Promise<Price>;
}

export type DAMSetup = DAMSellerSetup | DAMBuyerSetup;

export class DAMNodeBase<T = void> extends Node<DAMMsg.Msg, T> {
  base_setup: DAMBaseSetup;
  mh: DAMMsg.DAMMessageHandler | null;
  pub_key: PubKey | null;
  neighbor_pk: Map<NodeID, PubKey>;

  constructor(
    me: NodeID,
    comm: Communicator<DAMMsg.Msg>,
    base_setup: DAMBaseSetup,
  ) {
    super(me, comm);
    this.base_setup = base_setup;
    this.mh = null;
    this.pub_key = null;
    this.neighbor_pk = new Map();
  }

  async init_handler() {
    this.mh = await DAMMsg.make_message_handler(this.base_setup.priv_key);
    this.pub_key = this.mh.pub_key();
  }

  async exchange_pubkeys() {
    const mh = this.mh!;
    const neighbors = await this.comm.neighbors();
    const pub_key_msg = await mh.wrap({
      type: "DAM_PubKey",
      pub_key: mh.pub_key(),
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

export class DAMSellerNode extends DAMNodeBase<DAMMsg.TransactionUnit[]> {
  setup: DAMSellerSetup;

  constructor(
    me: NodeID,
    comm: Communicator<DAMMsg.Msg>,
    setup: DAMSellerSetup,
  ) {
    super(me, comm, setup);
    this.setup = setup;
  }

  async run(): Promise<DAMMsg.TransactionUnit[]> {
    await this.init_handler();
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
    const seller_tx: DAMMsg.TransactionUnit = {
      buyer: this.me,
      transfer: -total_transfer,
      allocation: 0,
    };
    return [seller_tx, ...transactions];
  }
}

export class DAMBuyerNode extends DAMNodeBase {
  setup: DAMBuyerSetup;
  witnesses: DAMMsg.Witness[] = [];

  constructor(
    me: NodeID,
    comm: Communicator<DAMMsg.Msg>,
    setup: DAMBuyerSetup,
  ) {
    super(me, comm, setup);
    this.setup = setup;
  }

  async run(): Promise<void> {
    await this.init_handler();
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
    this.witnesses.push(
      await mh.diffusion_witness(
        d_up_msg as DAMMsg.DAMWrapper<DAMMsg.DiffusionMsg>,
        d_down_msg,
        this.neighbor_pk.get(parent)!,
      ),
    );

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
    const second_max = max(price, ...remove_element(children_maxes, max_price));

    const gather_up_msg = await mh.wrap({
      type: "DAM_Gather",
      subtree_max: max_price,
    });
    this.witnesses.push(
      await mh.gather_witness(
        gather_up_msg,
        g_down_msgs as DAMMsg.DAMWrapper<DAMMsg.GatherMsg>[],
        children.map((x) => this.neighbor_pk.get(x)!),
        price,
        max_price
      )
    );
    await this.comm.send_message(parent, gather_up_msg);

    // Round 3 -- Scatter
    const s_up_msg = await this.comm.get_message(parent);
    const s_up_unwrapped = await mh.verify_and_unwrap(
      s_up_msg.message,
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
      await this.comm.send_message(parent, tx_msg);
    } else {
      // Resell
      const scatter_down_msg = await mh.wrap({
        type: "DAM_Scatter",
        external_max: child_offer,
      });
      await this.comm.send_message(max_child, scatter_down_msg);

      // Round 4 -- Transaction Response
      const tx_down_msg = await this.comm.get_message(max_child);
      const tx_down_unwrapped = await mh.verify_and_unwrap(
        tx_down_msg.message,
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
      await this.comm.send_message(parent, tx_up_msg);
    }
  }
}

type DAMNode = DAMSellerNode | DAMBuyerNode;
