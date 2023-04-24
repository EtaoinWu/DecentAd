import { NodeID } from "./node-prim.ts";
import { Communicator } from "./node-comm.ts";

export class Node<Msg, Ret = void> {
  me: NodeID;
  comm: Communicator<Msg>;

  constructor(me: NodeID, comm: Communicator<Msg>) {
    this.me = me;
    this.comm = comm;
  }

  run(): Promise<Ret> {
    return Promise.reject();
  }
}
