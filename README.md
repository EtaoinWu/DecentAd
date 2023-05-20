# DecentAd

This repo contains a simple framework for decentralized multiagent communication
algorithms.

## Usage

First install dependencies:

```bash
npm i snarkjs -g
cargo install --git https://github.com/iden3/circom.git
```

Then build the zkproof data (use `-j 8` for parallelism):

```bash
make
```

Run the deno test:

```bash
deno test -A --parallel
```
