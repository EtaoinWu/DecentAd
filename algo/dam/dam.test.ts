import { zip } from "std/collections/zip.ts";
import { EdgeList } from "../../util/graph.ts";
import { Communicator } from "../../comm/node-comm.ts";
import { NodeID } from "../../comm/node-prim.ts";
import * as DAMMsg from "./message.ts";
import { DAMBuyerNode, DAMSellerNode } from "./mechanism.ts";
import { const_resolve } from "../../util/functional.ts";
import { MultiNodeSetup } from "../../comm/multinode.ts";
import { assertEquals } from "std/testing/asserts.ts";

Deno.test("DAM small example 1", async (t) => {
  const item = "very good stuff";
  const n = 7;
  const seller = 0;
  const node_ids = Array.from({ length: n }, (_, i) => i.toString());
  const parents = [0, 0, 0, 1, 1, 2, 2];
  const graph = new EdgeList(n, parents.map((p, i) => [p, i]))
    .remove_loops().bidirectional().to_adjacency_list();
  const types: ("seller" | "buyer")[] = node_ids.map((_, i) =>
    i == seller ? "seller" : "buyer"
  );
  const belongs = ["a", "b", "a", "a", "c", "c", "c"];
  const bids = [0, 3, 1, 7, 5, 1, 1];
  const extras = zip(parents, types, bids).map(([parent, type, bid]) => ({
    parent,
    type,
    bid,
  }));
  const get_node = (
    e: typeof extras[0],
    comm: Communicator<DAMMsg.Msg>,
    id: NodeID,
  ) => {
    if (e.type == "seller") {
      return new DAMSellerNode(id, comm, { item });
    } else {
      return new DAMBuyerNode(id, comm, {
        parent: node_ids[e.parent],
        evaluation: const_resolve(e.bid),
      });
    }
  };

  const world = new MultiNodeSetup(
    graph,
    node_ids,
    extras,
    get_node,
    belongs,
    DAMMsg.encode_msg,
    DAMMsg.decode_msg,
  );
  const runs = world.nodes.map((node) => node.run());
  await t.step("run any", async () => {
    const _ = await Promise.race(runs);
  });
  await t.step("get seller", async () => {
    const res = await runs[0];
    if (res == undefined) {
      throw new Error("seller did not run");
    }
    assertEquals(res, [
      { buyer: "0", transfer: 1, allocation: 0 },
      { buyer: "1", transfer: 4, allocation: 0 },
      { buyer: "3", transfer: -5, allocation: 1 },
    ]);
  });
});

Deno.test("DAM small example 2: early stop", async (t) => {
  const item = "very good stuff";
  const n = 7;
  const seller = 0;
  const node_ids = Array.from({ length: n }, (_, i) => i.toString());
  const parents = [0, 0, 0, 1, 1, 2, 2];
  const graph = new EdgeList(n, parents.map((p, i) => [p, i]))
    .remove_loops().bidirectional().to_adjacency_list();
  const types: ("seller" | "buyer")[] = node_ids.map((_, i) =>
    i == seller ? "seller" : "buyer"
  );
  const belongs = ["a", "b", "a", "a", "c", "c", "c"];
  const bids = [0, 3, 1, 2, 5, 1, 1];
  const extras = zip(parents, types, bids).map(([parent, type, bid]) => ({
    parent,
    type,
    bid,
  }));
  const get_node = (
    e: typeof extras[0],
    comm: Communicator<DAMMsg.Msg>,
    id: NodeID,
  ) => {
    if (e.type == "seller") {
      return new DAMSellerNode(id, comm, { item });
    } else {
      return new DAMBuyerNode(id, comm, {
        parent: node_ids[e.parent],
        evaluation: const_resolve(e.bid),
      });
    }
  };

  const world = new MultiNodeSetup(
    graph,
    node_ids,
    extras,
    get_node,
    belongs,
    DAMMsg.encode_msg,
    DAMMsg.decode_msg,
  );
  const runs = world.nodes.map((node) => node.run());
  await t.step("run any", async () => {
    const _ = await Promise.race(runs);
  });
  await t.step("get seller", async () => {
    const res = await runs[0];
    if (res == undefined) {
      throw new Error("seller did not run");
    }
    assertEquals(res, [
      { buyer: "0", transfer: 1, allocation: 0 },
      { buyer: "1", transfer: -1, allocation: 1 },
    ]);
  });
});

Deno.test("DAM mid example 1: in paper", async (t) => {
  const item = "stuff";
  const n = 14;
  const node_ids = ["s", ..."abcdefghijklm".split("")];
  const parent_ids = ["s", ..."ssabbeffdigkk".split("")];
  const parents = parent_ids.map((p) => node_ids.indexOf(p));
  const graph = new EdgeList(n, parents.map((p, i) => [p, i]))
    .remove_loops().bidirectional().to_adjacency_list();
  const types: ("seller" | "buyer")[] = node_ids.map((x) =>
    x == "s" ? "seller" : "buyer"
  );
  const belongs = parents.map((_) => "ABCD"[Math.floor(Math.random() * 4)]);
  const bids = [0, 8, 5, 12, 19, 13, 17, 23, 29, 21, 15, 31, 26, 11];
  const extras = zip(parents, types, bids).map(([parent, type, bid]) => ({
    parent,
    type,
    bid,
  }));
  const get_node = (
    e: typeof extras[0],
    comm: Communicator<DAMMsg.Msg>,
    id: NodeID,
  ) => {
    if (e.type == "seller") {
      return new DAMSellerNode(id, comm, { item });
    } else {
      return new DAMBuyerNode(id, comm, {
        parent: node_ids[e.parent],
        evaluation: const_resolve(e.bid),
      });
    }
  };

  const world = new MultiNodeSetup(
    graph,
    node_ids,
    extras,
    get_node,
    belongs,
    DAMMsg.encode_msg,
    DAMMsg.decode_msg,
  );
  const runs = world.nodes.map((node) => node.run());
  await t.step("run any", async () => {
    const _ = await Promise.race(runs);
  });
  await t.step("get seller", async () => {
    const res = await runs[0];
    if (res == undefined) {
      throw new Error("seller did not run");
    }
    assertEquals(res, [
      { buyer: "s", transfer: 12, allocation: 0 },
      { buyer: "b", transfer: 9, allocation: 0 },
      { buyer: "e", transfer: 0, allocation: 0 },
      { buyer: "f", transfer: 8, allocation: 0 },
      { buyer: "g", transfer: 0, allocation: 0 },
      { buyer: "k", transfer: -29, allocation: 1 },
    ]);
  });
});

Deno.test("DAM mid example 2: in paper (modified)", async (t) => {
  const item = "stuff";
  const n = 14;
  const node_ids = ["s", ..."abcdefghijklm".split("")];
  const parent_ids = ["s", ..."ssabbeffdigkk".split("")];
  const parents = parent_ids.map((p) => node_ids.indexOf(p));
  const graph = new EdgeList(n, parents.map((p, i) => [p, i]))
    .remove_loops().bidirectional().to_adjacency_list();
  const types: ("seller" | "buyer")[] = node_ids.map((x) =>
    x == "s" ? "seller" : "buyer"
  );
  const belongs = parents.map((_) => "ABCD"[Math.floor(Math.random() * 4)]);
  const bids = [0, 8, 5, 12, 19, 13, 30, 23, 29, 21, 15, 31, 26, 11];
  const extras = zip(parents, types, bids).map(([parent, type, bid]) => ({
    parent,
    type,
    bid,
  }));
  const get_node = (
    e: typeof extras[0],
    comm: Communicator<DAMMsg.Msg>,
    id: NodeID,
  ) => {
    if (e.type == "seller") {
      return new DAMSellerNode(id, comm, { item });
    } else {
      return new DAMBuyerNode(id, comm, {
        parent: node_ids[e.parent],
        evaluation: const_resolve(e.bid),
      });
    }
  };

  const world = new MultiNodeSetup(
    graph,
    node_ids,
    extras,
    get_node,
    belongs,
    DAMMsg.encode_msg,
    DAMMsg.decode_msg,
  );
  const runs = world.nodes.map((node) => node.run());
  await t.step("run any", async () => {
    const _ = await Promise.race(runs);
  });
  await t.step("get seller", async () => {
    const res = await runs[0];
    if (res == undefined) {
      throw new Error("seller did not run");
    }
    assertEquals(res, [
      { buyer: "s", transfer: 12, allocation: 0 },
      { buyer: "b", transfer: 9, allocation: 0 },
      { buyer: "e", transfer: 0, allocation: 0 },
      { buyer: "f", transfer: -21, allocation: 1 },
    ]);
  });
});
