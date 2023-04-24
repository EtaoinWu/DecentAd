import { Node } from "../../comm/node-base.ts";
import { Communicator } from "../../comm/node-comm.ts";
import { NodeID } from "../../comm/node-prim.ts";
import { Item, Price } from "./item.ts";
import * as DAMMsg from "./message.ts";
import { remove_element } from "../../util/collection.ts";
import { max } from "../../util/algorithm.ts";

export type DAMSellerSetup = {
  item: Item;
};

export type DAMBuyerSetup = {
  parent: NodeID;
  evaluation: (item: Item) => Promise<Price>;
};

export type DAMSetup = DAMSellerSetup | DAMBuyerSetup;

export class DAMSellerNode extends Node<DAMMsg.Msg, DAMMsg.TransactionUnit[]> {
  setup: DAMSellerSetup;

  constructor(
    me: NodeID,
    comm: Communicator<DAMMsg.Msg>,
    setup: DAMSellerSetup,
  ) {
    super(me, comm);
    this.setup = setup;
  }

  async run(): Promise<DAMMsg.TransactionUnit[]> {
    const children = await this.comm.neighbors();
    const item = this.setup.item;
    const init_msg = await DAMMsg.dam_wrap({
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
      const unwrapped = await DAMMsg.dam_unwrap(msg.message);
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
    const sell_msg = await DAMMsg.dam_wrap({
      type: "DAM_Scatter",
      external_max: second_max_price,
    });
    await this.comm.send_message(max_neighbor, sell_msg);

    // Round 4 -- Transaction Response
    const transaction_msg = await this.comm.get_message(max_neighbor);
    const transaction_unwrapped = await DAMMsg.dam_unwrap(
      transaction_msg.message,
    );
    if (transaction_unwrapped.type !== "DAM_TResponse") {
      throw new Error("Unexpected message");
    }
    const transactions = transaction_unwrapped.transactions;
    const total_transfer = transactions.reduce(
      (acc, x) => acc + x.transfer,
      0,
    );
    const seller_tx: DAMMsg.TransactionUnit = {
      buyer: this.me,
      transfer: -total_transfer,
      allocation: 0,
    }
    return [seller_tx, ...transactions];
  }
}

export class DAMBuyerNode extends Node<DAMMsg.Msg> {
  setup: DAMBuyerSetup;

  constructor(
    me: NodeID,
    comm: Communicator<DAMMsg.Msg>,
    setup: DAMBuyerSetup,
  ) {
    super(me, comm);
    this.setup = setup;
  }

  async run(): Promise<void> {
    const parent = this.setup.parent;
    const evaluation = this.setup.evaluation;
    const children = remove_element(await this.comm.neighbors(), parent);
    const degree = children.length;

    // Round 1 -- Diffusion
    const diffusion_msg = await this.comm.get_message(parent);
    const diffusion_unwrapped = await DAMMsg.dam_unwrap(diffusion_msg.message);
    if (diffusion_unwrapped.type !== "DAM_Diffusion") {
      throw new Error("Unexpected message");
    }

    const item = diffusion_unwrapped.item;
    const val = await evaluation(item);
    const price = val;
    await Promise.all(children.map(async (node) => {
      await this.comm.send_message(
        node,
        await DAMMsg.dam_wrap(diffusion_unwrapped),
      );
    }));

    // Round 2 -- Gather
    const gather_down_msgs = await Promise.all(
      children.map(async (node, i) => {
        const msg = await this.comm.get_message(node);
        const unwrapped = await DAMMsg.dam_unwrap(msg.message);
        if (unwrapped.type !== "DAM_Gather") {
          throw new Error("Unexpected message");
        }
        return { index: i, subtree_max: unwrapped.subtree_max };
      }),
    );

    gather_down_msgs.sort((a, b) => (a.subtree_max > b.subtree_max) ? -1 : 1);
    const max_index = degree >= 1 ? gather_down_msgs[0].index : -1;
    const max_neighbor = degree >= 1 ? children[max_index] : "";
    const second_max_price = degree >= 2 ? max(gather_down_msgs[1].subtree_max, price) : price;
    const max_price = degree >= 1 ? max(gather_down_msgs[0].subtree_max, second_max_price) : price;

    const gather_up_msg = await DAMMsg.dam_wrap({
      type: "DAM_Gather",
      subtree_max: max_price,
    });
    await this.comm.send_message(parent, gather_up_msg);

    // Round 3 -- Scatter
    const scatter_up_msg = await this.comm.get_message(parent);
    const scatter_up_unwrapped = await DAMMsg.dam_unwrap(
      scatter_up_msg.message,
    );
    if (scatter_up_unwrapped.type !== "DAM_Scatter") {
      throw new Error("Unexpected message");
    }

    const offered_price = scatter_up_unwrapped.external_max;
    if (second_max_price <= price) {
      // Keep
      const tx = { buyer: this.me, transfer: -offered_price, allocation: 1 };
      const tx_msg = await DAMMsg.dam_wrap({
        type: "DAM_TResponse",
        transactions: [tx],
      });
      await this.comm.send_message(parent, tx_msg);
    } else {
      // Resell
      const scatter_down_msg = await DAMMsg.dam_wrap({
        type: "DAM_Scatter",
        external_max: second_max_price,
      });
      await this.comm.send_message(max_neighbor, scatter_down_msg);

      // Round 4 -- Transaction Response
      const tx_down_msg = await this.comm.get_message(max_neighbor);
      const tx_down_unwrapped = await DAMMsg.dam_unwrap(tx_down_msg.message);
      if (tx_down_unwrapped.type !== "DAM_TResponse") {
        throw new Error("Unexpected message");
      }
      const tx = {
        buyer: this.me,
        transfer: second_max_price - offered_price,
        allocation: 0,
      };
      const tx_up_msg = await DAMMsg.dam_wrap({
        type: "DAM_TResponse",
        transactions: [tx, ...tx_down_unwrapped.transactions],
      });
      await this.comm.send_message(parent, tx_up_msg);
    }
  }
}

type DAMNode = DAMSellerNode | DAMBuyerNode;
