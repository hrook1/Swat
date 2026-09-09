#!/bin/sh
set -eu
# Run at repository root. Inputs total approximately 1.2GB; never used by Vercel.
mkdir -p data/raw
for file in body-annotations-male-cns-v1.0-minconf-0.5.feather body-neurotransmitters-male-cns-v1.0.feather connectome-weights-male-cns-v1.0-minconf-0.5.feather; do
  curl --fail --location --retry 2 --continue-at - \
    "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/$file" \
    --output "data/raw/$file"
done
