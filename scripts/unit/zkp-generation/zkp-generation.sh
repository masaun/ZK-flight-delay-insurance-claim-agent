#!/bin/sh
echo "Running the unit test of ZK Proof generation..."
cd "$(dirname "$0")/../.."

# Use npx to run tsx with the test file
npx tsx unit/zkp-generation/zkp-generation.ts