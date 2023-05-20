import * as snarkjs from "https://esm.sh/snarkjs@0.6.1?pin=v122";
import { WitnessCalculatorBuilder } from "https://esm.sh/circom_runtime@0.1.22?pin=v122";
import { crypto, Scalar } from "./crypto.ts";

const groth16 = snarkjs.groth16 as {
  prove: (
    zkey: ReturnType<typeof wrap>,
    wtns: ReturnType<typeof wrap>,
  ) => Promise<{
    publicSignals: unknown;
    proof: unknown;
  }>;
  verify: (
    vkey: unknown,
    publicSignals: unknown,
    proof: unknown,
  ) => Promise<boolean>;
};

function wrap(x: Uint8Array) {
  return {
    type: "mem",
    data: x,
  };
}

export async function make_zkprover(
  name: string,
): Promise<ZKProver | DummyProver> {
  const wasm = await Deno.readFile(`./out/${name}.p_js/${name}.p.wasm`);
  return new ZKProver(
    name,
    await WitnessCalculatorBuilder(wasm),
    await Deno.readFile(`./out/${name}.p.final.zkey`),
    JSON.parse(await Deno.readTextFile(`./out/${name}.p.vkey.json`)),
  );
}

interface HasCalculateWTNSBin {
  calculateWTNSBin: (witness: unknown) => Promise<Uint8Array>;
}

export type InputT = Record<string, Scalar | Scalar[]>;

export class ZKProver {
  name: string;
  witnessCalculator: Awaited<ReturnType<typeof WitnessCalculatorBuilder>>;
  zkey: Uint8Array;
  vkey: unknown;

  constructor(
    name: string,
    witnessCalculator: Awaited<ReturnType<typeof WitnessCalculatorBuilder>>,
    zkey: Uint8Array,
    vkey: unknown,
  ) {
    this.name = name;
    this.witnessCalculator = witnessCalculator;
    this.zkey = zkey;
    this.vkey = vkey;
  }

  async calculate_witness<T>(witness: T): Promise<Uint8Array> {
    return await (this.witnessCalculator as HasCalculateWTNSBin)
      .calculateWTNSBin(
        witness,
      );
  }

  canonize(input: InputT) {
    const canonized: InputT = {};
    for (const [k, v] of Object.entries(input)) {
      if (Array.isArray(v)) {
        canonized[k] = v.map((x) => crypto.canonize(x));
      } else {
        canonized[k] = crypto.canonize(v);
      }
    }
    return canonized;
  }

  async prove(bin_witness: Uint8Array) {
    const { proof, publicSignals } = await groth16.prove(
      wrap(this.zkey),
      wrap(bin_witness),
    );
    return { proof, publicSignals };
  }

  async full_prove<T extends InputT>(witness: T) {
    const bin_witness = await this.calculate_witness(this.canonize(witness));
    return await this.prove(bin_witness);
  }

  async verify<T extends InputT, U>(proof: T, publicSignals: U) {
    return await groth16.verify(
      this.vkey,
      publicSignals,
      proof,
    );
  }
}

export class DummyProver {
  constructor() {}

  full_prove<T extends InputT>(_: T) {
    return Promise.resolve({ proof: {}, publicSignals: {} });
  }

  verify<T, U>(_proof: T, _publicSignals: U) {
    return Promise.resolve(true);
  }
}
