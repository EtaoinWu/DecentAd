import * as snarkjs from "https://esm.sh/snarkjs@0.6.1?pin=v122";
import { WitnessCalculatorBuilder } from "https://esm.sh/circom_runtime@0.1.22?pin=v122";

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

export async function make_zkprover(name: string): Promise<ZKProver> {
  const wasm = await Deno.readFile(`./out/${name}.p_js/${name}.p.wasm`);
  return new ZKProver(
    await WitnessCalculatorBuilder(wasm),
    await Deno.readFile(`./out/${name}.p.final.zkey`),
    JSON.parse(await Deno.readTextFile(`./out/${name}.p.vkey.json`)),
  );
}

interface HasCalculateWTNSBin {
  calculateWTNSBin: (witness: unknown) => Promise<Uint8Array>;
}

export class ZKProver {
  witnessCalculator: Awaited<ReturnType<typeof WitnessCalculatorBuilder>>;
  zkey: Uint8Array;
  vkey: unknown;

  constructor(
    witnessCalculator: Awaited<ReturnType<typeof WitnessCalculatorBuilder>>,
    zkey: Uint8Array,
    vkey: unknown,
  ) {
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

  async prove(bin_witness: Uint8Array) {
    const { proof, publicSignals } = await groth16.prove(
      wrap(this.zkey),
      wrap(bin_witness),
    );
    return { proof, publicSignals };
  }

  async full_prove<T>(witness: T) {
    const bin_witness = await this.calculate_witness(witness);
    return await this.prove(bin_witness);
  }

  async verify<T, U>(proof: T, publicSignals: U) {
    return await groth16.verify(
      this.vkey,
      publicSignals,
      proof,
    );
  }
}
