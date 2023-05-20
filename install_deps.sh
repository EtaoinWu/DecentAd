#!/bin/bash

echo "Installing dependencies for the project -- circom, snarkjs"

npm install -g snarkjs

cd deps
git clone https://github.com/iden3/circom.git
cd circom
cargo build --release
cargo install --path circom
cd ..
cd ..
