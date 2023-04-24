import { NodeID } from "./node-prim.ts";

export class Tagged<Msg> {
  readonly from: NodeID;
  readonly message: Msg;

  constructor(from: NodeID, message: Msg) {
    this.from = from;
    this.message = message;
  }

  map<NewMsg>(f: (msg: Msg) => NewMsg): Tagged<NewMsg> {
    return new Tagged(this.from, f(this.message));
  }
}

export type Resolve<T> = (value: T | PromiseLike<T>) => void;
export type Reject = (reason?: unknown) => void;
export type ResRej<T> = [Resolve<T>, Reject];

export class LocalChannel<Msg> {
  readonly send_queue: Msg[];
  readonly recv_queue: ResRej<Msg>[];

  constructor() {
    this.send_queue = [];
    this.recv_queue = [];
  }

  send_message(message: Msg): Promise<void> {
    const elem = this.recv_queue.shift();
    if (elem === undefined) {
      this.send_queue.push(message);
    } else {
      const [resolve, _] = elem;
      resolve(message);
    }
    return Promise.resolve();
  }

  get_message(): Promise<Msg> {
    const elem = this.send_queue.shift();
    if (elem === undefined) {
      return new Promise((resolve, reject) => {
        this.recv_queue.push([resolve, reject]);
      });
    } else {
      return Promise.resolve(elem);
    }
  }
}

export interface Communicator<Msg> {
  num_nodes(): Promise<number>;
  neighbors(): Promise<NodeID[]>;
  send_message(to: NodeID, message: Msg): Promise<void>;
  get_message(from: NodeID): Promise<Tagged<Msg>>;
}

export class LocalHub<Msg> {
  readonly n_nodes: number;
  readonly nodes: Set<NodeID>;
  readonly network_topology: Map<NodeID, NodeID[]>;
  readonly channels: Map<NodeID, Map<NodeID, LocalChannel<Msg>>>;

  constructor(network_topology: Map<NodeID, NodeID[]>) {
    this.nodes = new Set(network_topology.keys());
    this.n_nodes = this.nodes.size;
    this.network_topology = network_topology;
    this.channels = new Map();

    for (const [from, tos] of network_topology) {
      const from_channels = new Map();
      for (const to of tos) {
        from_channels.set(to, new LocalChannel<Msg>());
      }
      this.channels.set(from, from_channels);
    }
  }

  get_communicator(me: NodeID): Communicator<Msg> {
    if (!this.nodes.has(me)) {
      throw new Error("Node not found");
    }
    return new LocalCommunicator(me, this);
  }
}

export class LocalCommunicator<Msg> implements Communicator<Msg> {
  readonly me: NodeID;
  readonly hub: LocalHub<Msg>;

  constructor(me: NodeID, hub: LocalHub<Msg>) {
    this.me = me;
    this.hub = hub;
  }

  num_nodes(): Promise<number> {
    return Promise.resolve(this.hub.n_nodes);
  }

  neighbors(): Promise<NodeID[]> {
    return Promise.resolve(this.hub.network_topology.get(this.me) || []);
  }

  async send_message(to: NodeID, message: Msg): Promise<void> {
    const from_channels = this.hub.channels.get(this.me);
    if (from_channels === undefined) {
      throw new Error("Node not found");
    }
    const channel = from_channels.get(to);
    if (channel === undefined) {
      throw new Error("Node not found");
    }
    await channel.send_message(message);
  }

  async get_message(from: NodeID): Promise<Tagged<Msg>> {
    const to_channels = this.hub.channels.get(from);
    if (to_channels === undefined) {
      throw new Error("Node not found");
    }
    const channel = to_channels.get(this.me);
    if (channel === undefined) {
      throw new Error("Node not found");
    }
    return new Tagged(from, await channel.get_message());
  }
}

export function encoded_communicator<P, Q>(
  comm: Communicator<P>,
  encoder: (q: Q) => P,
  decoder: (p: P) => Q,
): Communicator<Q> {
  return {
    num_nodes: () => comm.num_nodes(),
    neighbors: () => comm.neighbors(),
    send_message: async (node: NodeID, message: Q) =>
      await comm.send_message(node, encoder(message)),
    get_message: async (node: NodeID) =>
      (await comm.get_message(node)).map(decoder),
  };
}
