import * as uuid from "https://deno.land/std@0.182.0/uuid/mod.ts";

// NodeID are uuids
export type NodeID = string;

export function isNodeID(id: string): boolean {
  return uuid.validate(id);
}

export function generateNodeID(): NodeID {
  return crypto.randomUUID();
}
