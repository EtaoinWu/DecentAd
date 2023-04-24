import {
  Communicator,
  encoded_communicator,
  Tagged,
} from "../comm/node-comm.ts";
import { AdjacencyList } from "../util/graph.ts";
import { MixedHub } from "./mixed-comm.ts";
import { NodeID } from "./node-prim.ts";

export type GetNodeFn<T, Msg, U> = (
  extra: T,
  comm: Communicator<Msg>,
  id: NodeID,
  index: number,
  neighbors: NodeID[],
  neighbors_index: number[],
) => U;

export class MultiNodeSetup<Msg, Extra, Node> {
  graph: AdjacencyList;
  id: NodeID[];
  index: Map<NodeID, number>;
  get_node: GetNodeFn<Extra, Msg, Node>;
  belongs: string[];
  hubs: Map<string, MixedHub<string>>;
  comms: Communicator<Msg>[];
  nodes: Node[];

  constructor(
    graph: AdjacencyList,
    id: NodeID[],
    extras: Extra[],
    get_node: GetNodeFn<Extra, Msg, Node>,
    belongs: string[],
    encoder: (q: Msg) => string,
    decoder: (p: string) => Msg,
  ) {
    this.graph = graph;
    this.id = id;
    this.index = new Map([...id.entries()].map(([k, v]) => [v, k]));
    this.get_node = get_node;
    this.nodes = [];
    this.belongs = belongs;
    const channels = new Set(this.belongs);
    this.hubs = new Map();
    const handle = async (to: NodeID, msg: Tagged<string>) => {
      const to_index = this.index.get(to);
      if (to_index === undefined) {
        throw new Error(`unknown node ${to}`);
      }
      const channel = this.belongs[to_index];
      const hub = this.hubs.get(channel);
      if (hub === undefined) {
        throw new Error(`unknown channel ${channel}`);
      }
      return await hub.handle_message(to, msg);
    };
    for (const channel of channels) {
      const members = [...id.entries()].filter(([k, _]: [number, string]) =>
        this.belongs[k] === channel
      );
      const network = new Map<NodeID, NodeID[]>();
      for (const [i, node] of members) {
        network.set(node, this.graph.adj[i].map((j) => id[j]));
      }
      const hub = new MixedHub<string>(
        id.length,
        new Set(members.map(([_, v]) => v)),
        network,
        handle,
      );
      this.hubs.set(channel, hub);
    }
    this.comms = id.map((node, i) => {
      const hub = this.hubs.get(this.belongs[i]);
      if (hub === undefined) {
        throw new Error(`unknown channel ${this.belongs[i]}`);
      }
      return encoded_communicator(
        hub.get_communicator(node),
        encoder,
        decoder,
      );
    });
    this.nodes = id.map((node, i) => {
      const hub = this.hubs.get(this.belongs[i]);
      if (hub === undefined) {
        throw new Error(`unknown channel ${this.belongs[i]}`);
      }
      return get_node(
        extras[i],
        this.comms[i],
        node,
        i,
        this.graph.adj[i].map((j) => id[j]),
        this.graph.adj[i],
      );
    });
  }
}
