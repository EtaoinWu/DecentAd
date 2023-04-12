import { NodeID } from "../node-prim.ts";

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

export interface Communicator<Msg> {
  num_nodes(): Promise<number>;
  neighbors(): Promise<NodeID[]>;
  send_message(to: NodeID, message: Msg): Promise<void>;
  get_message(from: NodeID): Promise<Tagged<Msg>>;
  get_any_message(): Promise<Tagged<Msg>>;
  broadcast_message(message: Msg): Promise<void>;
  get_broadcast_message(): Promise<Tagged<Msg>>;
}

export class LocalHub<Msg> {
  readonly n_nodes: number;
  readonly nodes: Set<NodeID>;
  readonly network_topology: Map<NodeID, NodeID[]>;
  message_queues: Map<NodeID, Tagged<Msg>[]>;
  broadcast_send_queue: Tagged<Msg>[];
  broadcast_recv_queue: Map<NodeID, Tagged<Msg>[]>;

  constructor(n_nodes: number, network_topology: Map<NodeID, NodeID[]>) {
    this.n_nodes = n_nodes;
    this.nodes = new Set(network_topology.keys());
    this.network_topology = network_topology;
    this.message_queues = new Map();
    this.broadcast_send_queue = [];
    this.broadcast_recv_queue = new Map();

    for (const node of this.nodes) {
      this.message_queues.set(node, []);
      this.broadcast_recv_queue.set(node, []);
    }
  }

  broadcast_once(): boolean {
    const elem = this.broadcast_send_queue.shift();
    if (elem === undefined) {
      return false;
    }
    for (const node of this.nodes) {
      if (node !== elem.from) {
        this.broadcast_recv_queue.get(node)?.push(elem);
      }
    }
    return true;
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

  send_message(to: NodeID, message: Msg): Promise<void> {
    const queue = this.hub.message_queues.get(to);
    if (queue === undefined) {
      throw new Error(`Node ${to} does not exist`);
    }
    queue.push(new Tagged(this.me, message));
    return Promise.resolve();
  }

  get_message(from: NodeID): Promise<Tagged<Msg>> {
    const queue = this.hub.message_queues.get(this.me);
    if (queue === undefined) {
      return Promise.reject(new Error(`Node ${this.me} does not exist`));
    }
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].from === from) {
        return Promise.resolve(queue.splice(i, 1)[0]);
      }
    }
    return Promise.reject(new Error(`No message from ${from} in queue`));
  }

  get_any_message(): Promise<Tagged<Msg>> {
    const queue = this.hub.message_queues.get(this.me);
    if (queue === undefined) {
      return Promise.reject(new Error(`Node ${this.me} does not exist`));
    }
    const elem = queue.shift();
    if (elem === undefined) {
      return Promise.reject(new Error(`No message in queue`));
    }
    return Promise.resolve(elem);
  }

  broadcast_message(message: Msg): Promise<void> {
    this.hub.broadcast_send_queue.push(new Tagged(this.me, message));
    return Promise.resolve();
  }

  get_broadcast_message(): Promise<Tagged<Msg>> {
    const queue = this.hub.broadcast_recv_queue.get(this.me);
    if (queue === undefined) {
      return Promise.reject(new Error(`Node ${this.me} does not exist`));
    }
    const elem = queue.shift();
    if (elem === undefined) {
      if (this.hub.broadcast_once()) {
        return this.get_broadcast_message();
      }
      return Promise.reject(new Error(`No broadcast message in queue`));
    }
    return Promise.resolve(elem);
  }
}

export function encoded_communicator<P, Q>(
  comm: Communicator<P>,
  encoder: (q: Q) => P,
  decoder: (p: P) => Q,
): Communicator<Q> {
  return {
    num_nodes: comm.num_nodes,
    neighbors: comm.neighbors,
    send_message: async (node: NodeID, message: Q) =>
      await comm.send_message(node, encoder(message)),
    get_message: async (node: NodeID) =>
      (await comm.get_message(node)).map(decoder),
    get_any_message: async () => (await comm.get_any_message()).map(decoder),
    broadcast_message: async (message: Q) =>
      await comm.broadcast_message(encoder(message)),
    get_broadcast_message: async () =>
      (await comm.get_broadcast_message()).map(decoder),
  };
}
