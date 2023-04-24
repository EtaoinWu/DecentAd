import { NodeID } from "../../comm/node-prim.ts";
import { Item, Price } from "./item.ts";
import { hash } from "../../util/hash.ts";

export type DiffusionMsg = {
  type: "DAM_Diffusion";
  seller: NodeID;
  item: Item;
};

export type GatherMsg = {
  type: "DAM_Gather";
  subtree_max: Price;
};

export type ScatterMsg = {
  type: "DAM_Scatter";
  external_max: Price;
};

export type TransactionUnit = {
  buyer: NodeID;
  transfer: Price;
  allocation: number;
};

export type TransactionResponseMsg = {
  type: "DAM_TResponse";
  transactions: Array<TransactionUnit>;
};

export class DAMWrapper<T> {
  info: T;
  hash: string;
  constructor(info: T, hash?: string) {
    this.info = info;
    this.hash = hash ?? "";
  }
}

type RawMsg =
  | DiffusionMsg
  | GatherMsg
  | ScatterMsg
  | TransactionResponseMsg;

export async function dam_wrap<T extends RawMsg>(
  item: T,
): Promise<DAMWrapper<T>> {
  return new DAMWrapper(item, await hash(JSON.stringify(item)));
}

export function dam_unwrap<T extends RawMsg>(item: DAMWrapper<T>): Promise<T> {
  return Promise.resolve(item.info);
}

export type Msg = DAMWrapper<RawMsg>;

export function encode_msg(msg: Msg): string {
  return JSON.stringify(msg);
}

export function decode_msg(msg: string): Msg {
  return JSON.parse(msg);
}
