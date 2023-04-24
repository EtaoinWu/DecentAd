import { assertEquals } from "std/testing/asserts.ts";

import {
  decode_sos_msg,
  encode_sos_msg,
  SOSDispatcherNode,
  SOSHostNode,
  SOSMsg,
  SOSResult,
  SOSWorkerNode,
} from "../algo/sum_of_squares.ts";

import { NodeID } from "./node-prim.ts";
import { MultiNodeSetup } from "./multinode.ts";
import { EdgeList } from "../util/graph.ts";
import { Communicator } from "./node-comm.ts";

Deno.test("sum of squares with many hubs with multinode", async (t) => {
  const dispatch = "DISPATCH";
  const host = "HOST";
  const workers = ["A", "B", "C", "D", "E"];
  const node_ids = [dispatch, host, ...workers];
  const graph_base = new EdgeList(7, [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [0, 6],
    [1, 2],
    [1, 3],
    [1, 4],
    [1, 5],
    [1, 6],
  ]).bidirectional().to_adjacency_list();
  const types: ("dispatch" | "host" | "worker")[] = [
    "dispatch",
    "host",
    "worker",
    "worker",
    "worker",
    "worker",
    "worker",
  ];
  const belongs = ["a", "b", "a", "b", "c", "c", "c"];
  const get_node = (
    t: "dispatch" | "host" | "worker",
    comm: Communicator<SOSMsg>,
    id: NodeID,
  ) => {
    if (t == "dispatch") {
      return new SOSDispatcherNode(dispatch, comm, workers, host);
    } else if (t == "host") {
      return new SOSHostNode(host, comm, dispatch, workers);
    } else {
      return new SOSWorkerNode(id, comm, dispatch);
    }
  };
  const world = new MultiNodeSetup(
    graph_base,
    node_ids,
    types,
    get_node,
    belongs,
    encode_sos_msg,
    decode_sos_msg,
  );
  await t.step("run all", async () => {
    const res = await Promise.all(world.nodes.map((node) => node.run()));
    const dispatch_res = res[0] as SOSResult;
    const sos = dispatch_res.baseline;
    const sums = dispatch_res.sos;
    console.log(`sum of squares: ${sos}`);
    console.log(`sums: ${sums}`);
    for (const x of sums) {
      assertEquals(x, sos);
    }
  });
});
