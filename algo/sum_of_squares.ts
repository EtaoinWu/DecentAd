import { Node } from "../comm/node-base.ts";
import { Communicator } from "../comm/node-comm.ts";
import { NodeID } from "../comm/node-prim.ts";
import { zip } from "std/collections/mod.ts";

type SOSReadyMsg = {
  type: "SOS_READY";
};

type SOSStartMsg = {
  type: "SOS_START";
  host: NodeID;
};

type SOSRound1ScatterMsg = {
  type: "SOS_R1_SC";
  x: number;
};

type SOSRound1GatherMsg = {
  type: "SOS_R1_GA";
  x_sq: number;
};

type SOSRound2ScatterMsg = {
  type: "SOS_R2_SC";
  sos: number;
};

type SOSRound2ReportMsg = {
  type: "SOS_R2_RE";
  sos: number;
};

export type SOSMsg =
  | SOSReadyMsg
  | SOSStartMsg
  | SOSRound1ScatterMsg
  | SOSRound1GatherMsg
  | SOSRound2ScatterMsg
  | SOSRound2ReportMsg;

export function SOSMsgEncoder(msg: SOSMsg): string {
  return JSON.stringify(msg);
}

export function SOSMsgDecoder(msg: string): SOSMsg {
  return JSON.parse(msg);
}

export class SOSWorkerNode extends Node<SOSMsg> {
  dispatcher: NodeID;

  constructor(me: NodeID, comm: Communicator<SOSMsg>, dispatcher: NodeID) {
    super(me, comm);
    this.dispatcher = dispatcher;
  }

  async run(): Promise<void> {
    await this.comm.send_message(this.dispatcher, { type: "SOS_READY" });
    const start = (await this.comm.get_message(this.dispatcher)).message;
    if (start.type != "SOS_START") {
      throw new Error(`Unexpected message: ${start.type}, expected SOS_START`);
    }
    const host = start.host;
    const x = (await this.comm.get_message(host)).message;
    if (x.type != "SOS_R1_SC") {
      throw new Error(`Unexpected message: ${x.type}, expected SOS_R1_SC`);
    }
    await this.comm.send_message(host, { type: "SOS_R1_GA", x_sq: x.x * x.x });
    const sos = (await this.comm.get_message(host)).message;
    if (sos.type != "SOS_R2_SC") {
      throw new Error(`Unexpected message: ${sos.type}, expected SOS_R2_SC`);
    }
    await this.comm.send_message(this.dispatcher, {
      type: "SOS_R2_RE",
      sos: sos.sos,
    });
  }
}

export class SOSHostNode extends Node<SOSMsg> {
  dispatcher: NodeID;
  workers: NodeID[];

  constructor(
    me: NodeID,
    comm: Communicator<SOSMsg>,
    dispatcher: NodeID,
    workers: NodeID[],
  ) {
    super(me, comm);
    this.dispatcher = dispatcher;
    this.workers = workers;
  }

  async run(): Promise<void> {
    await this.comm.send_message(this.dispatcher, { type: "SOS_READY" });
    const start = (await this.comm.get_message(this.dispatcher)).message;
    if (start.type != "SOS_START") {
      throw new Error(`Unexpected message: ${start.type}, expected SOS_START`);
    }

    const values = this.workers.map((_) => Math.round(Math.random() * 100));
    const sos_baseline = values.reduce((acc, x) => acc + x * x, 0);

    for (const [worker, value] of zip(this.workers, values)) {
      await this.comm.send_message(worker, { type: "SOS_R1_SC", x: value });
    }

    let sum = 0;

    for (const worker of this.workers) {
      const resp = (await this.comm.get_message(worker)).message;
      if (resp.type != "SOS_R1_GA") {
        throw new Error(`Unexpected message: ${resp.type}, expected SOS_R1_GA`);
      }
      sum += resp.x_sq;
    }

    for (const worker of this.workers) {
      await this.comm.send_message(worker, { type: "SOS_R2_SC", sos: sum });
    }

    await this.comm.send_message(this.dispatcher, {
      type: "SOS_R2_RE",
      sos: sos_baseline,
    });
  }
}

export class SOSDispatcherNode extends Node<SOSMsg> {
  workers: NodeID[];
  host: NodeID;
  callback: (sos: number, sums: number[]) => Promise<void>;

  constructor(
    me: NodeID,
    comm: Communicator<SOSMsg>,
    workers: NodeID[],
    host: NodeID,
    callback: (sos: number, sums: number[]) => Promise<void>,
  ) {
    super(me, comm);
    this.workers = workers;
    this.host = host;
    this.callback = callback;
  }

  async run(): Promise<void> {
    const nodes = [...this.workers, this.host];

    await Promise.all(nodes.map(async (node) => {
      const msg = (await this.comm.get_message(node)).message;
      if (msg.type != "SOS_READY") {
        throw new Error(`Unexpected message: ${msg.type}, expected SOS_READY`);
      }
    }));

    await Promise.all(nodes.map(async (node) => {
      await this.comm.send_message(node, {
        type: "SOS_START",
        host: this.host,
      });
    }));

    const sums: Array<number> = [];

    const host_resp = (await this.comm.get_message(this.host)).message;
    if (host_resp.type != "SOS_R2_RE") {
      throw new Error(
        `Unexpected message: ${host_resp.type}, expected SOS_R2_RE`,
      );
    }
    const baseline = host_resp.sos;

    for (const worker of this.workers) {
      const resp = (await this.comm.get_message(worker)).message;
      if (resp.type != "SOS_R2_RE") {
        throw new Error(`Unexpected message: ${resp.type}, expected SOS_R2_RE`);
      }
      sums.push(resp.sos);
    }

    await this.callback(baseline, sums);
  }
}
