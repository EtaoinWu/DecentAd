import { NodeID } from "./node-prim.ts";
import { Communicator, LocalChannel, Tagged } from "./node-comm.ts";

export class MixedHub<Msg> {
  readonly n_total_nodes: number;
  readonly local_nodes: Set<NodeID>;
  readonly local_network_topology: Map<NodeID, NodeID[]>;
  readonly recv_channels: Map<NodeID, Map<NodeID, LocalChannel<Msg>>>; // to -> from -> channel

  readonly send_message_callback: (
    to: NodeID,
    msg: Tagged<Msg>,
  ) => Promise<void>;

  constructor(
    n_total_nodes: number,
    local_nodes: Set<NodeID>,
    local_network_topology: Map<NodeID, NodeID[]>,
    send_message_callback: (to: NodeID, msg: Tagged<Msg>) => Promise<void>,
  ) {
    this.n_total_nodes = n_total_nodes;
    this.local_nodes = local_nodes;
    this.local_network_topology = local_network_topology;
    this.recv_channels = new Map();

    for (const x of local_nodes) {
      this.recv_channels.set(x, new Map());
    }

    for (const [from, tos] of local_network_topology) {
      if (!local_nodes.has(from)) {
        continue;
      }
      const cs = this.recv_channels.get(from)!;
      for (const to of tos) {
        if (local_nodes.has(to)) {
          cs.set(to, new LocalChannel<Msg>());
        }
      }
    }

    this.send_message_callback = send_message_callback;
  }

  get_channel(from: NodeID, to: NodeID): LocalChannel<Msg> {
    const cs = this.recv_channels.get(to);
    if (cs === undefined) {
      throw new Error(`Node ${to} is not local`);
    }
    if (!cs.has(from)) {
      cs.set(from, new LocalChannel<Msg>());
    }
    return cs.get(from)!;
  }

  handle_message(to: NodeID, msg: Tagged<Msg>): Promise<void> {
    const from = msg.from;
    const c = this.get_channel(from, to);
    return c.send_message(msg.message);
  }

  async send_message(from: NodeID, to: NodeID, msg: Msg): Promise<void> {
    if (!this.local_nodes.has(from)) {
      throw new Error(`Node ${from} is not local`);
    }
    if (!this.local_network_topology.get(from)!.includes(to)) {
      throw new Error(`Node ${from} is not connected to ${to}`);
    }
    if (this.local_nodes.has(to)) {
      await this.get_channel(from, to).send_message(msg);
    } else {
      const tagged = new Tagged(from, msg);
      await this.send_message_callback(to, tagged);
    }
  }

  get_communicator(me: NodeID): MixedCommunicator<Msg> {
    return new MixedCommunicator(this, me);
  }
}

export class MixedCommunicator<Msg> implements Communicator<Msg> {
  readonly hub: MixedHub<Msg>;
  readonly me: NodeID;

  constructor(hub: MixedHub<Msg>, me: NodeID) {
    this.hub = hub;
    this.me = me;
  }

  num_nodes(): Promise<number> {
    return Promise.resolve(this.hub.n_total_nodes);
  }
  neighbors(): Promise<NodeID[]> {
    return Promise.resolve(this.hub.local_network_topology.get(this.me) ?? []);
  }
  send_message(to: NodeID, message: Msg): Promise<void> {
    return this.hub.send_message(this.me, to, message);
  }
  async get_message(from: NodeID): Promise<Tagged<Msg>> {
    const c = this.hub.get_channel(from, this.me);
    const m = await c.get_message();
    return new Tagged(from, m);
  }
}
