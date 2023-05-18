import { assertAlmostEquals } from "std/testing/asserts.ts";

import { encoded_communicator, LocalHub } from "../comm/node-comm.ts";
import {
  decode_sos_msg,
  encode_sos_msg,
  SOSDispatcherNode,
  SOSHostNode,
  SOSResult,
  SOSWorkerNode,
} from "./sum_of_squares.ts";

Deno.test("sum of squares protocol", async (t) => {
  const dispatch = "DISPATCH";
  const host = "HOST";
  const workers = ["A", "B", "C", "D", "E"];
  const node_ids = [dispatch, host, ...workers];

  const network = new Map<string, string[]>(node_ids.map((node) => [node, []]));
  for (const node of node_ids) {
    if (node != dispatch) {
      network.get(node)!.push(dispatch);
      network.get(dispatch)!.push(node);
    }
  }
  for (const worker of workers) {
    network.get(worker)!.push(host);
    network.get(host)!.push(worker);
  }

  const hub = new LocalHub<string>(network);

  const get_communicator = (node: string) =>
    encoded_communicator(
      hub.get_communicator(node),
      encode_sos_msg,
      decode_sos_msg,
    );

  const dispatch_node = new SOSDispatcherNode(
    dispatch,
    get_communicator(dispatch),
    workers,
    host,
  );

  const host_node = new SOSHostNode(
    host,
    get_communicator(host),
    dispatch,
    workers,
  );
  const worker_nodes = workers.map((worker) =>
    new SOSWorkerNode(worker, get_communicator(worker), dispatch)
  );

  const nodes = [dispatch_node, host_node, ...worker_nodes];

  await t.step("run all", async () => {
    const res = await Promise.all(nodes.map((node) => node.run()));
    const dispatch_res = res[0] as SOSResult;
    const sos = dispatch_res.baseline;
    const sums = dispatch_res.sos;
    console.log(`sum of squares: ${sos}`);
    console.log(`sums: ${sums}`);
    for (const x of sums) {
      assertAlmostEquals(x, sos);
    }
  });
});
