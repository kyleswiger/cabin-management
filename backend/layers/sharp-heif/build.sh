#!/usr/bin/env bash
#
# Build the sharp/libvips+libheif Lambda layer (PRD 5.8) → dist/layer.zip
#
# Requires Docker able to build linux/amd64 images. Everything happens inside the
# container (see Dockerfile); this script just builds the image and extracts the
# artifact. Terraform points the media Lambda's layer at dist/layer.zip, so run
# this before the first deploy and after any version bump in the Dockerfile ARGs.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE_TAG="${IMAGE_TAG:-cabin-sharp-heif-layer}"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required to build the layer" >&2
  exit 1
fi

echo "Building ${IMAGE_TAG} (linux/amd64 — first run compiles libvips, expect ~10-20 min)..."
docker build --platform linux/amd64 -t "${IMAGE_TAG}" .

mkdir -p dist
cid="$(docker create --platform linux/amd64 "${IMAGE_TAG}")"
trap 'docker rm -f "${cid}" >/dev/null 2>&1 || true' EXIT
docker cp "${cid}:/layer.zip" dist/layer.zip

echo "Layer artifact: $(pwd)/dist/layer.zip"
unzip -l dist/layer.zip | awk 'NR <= 4 || /sharp\.node|\.so/ {print}' | head -n 40
