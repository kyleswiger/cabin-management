#!/usr/bin/env bash
# Smoke test (run inside the build image): sharp must load from the *collected*
# lib/ dir and report HEIC (HEVC) decode — proving the layer is self-contained
# the same way it will be under /opt at runtime. The prebuilt sharp also reports
# a "heif" format but only with fileSuffix [".avif"]; libvips includes ".heic"
# only when libheif has an HEVC decoder, which is the whole point of this build.
#
# Plain COPY'd script, not a RUN heredoc — see collect-libs.sh for why.
set -eux
cd /layer/nodejs
test -d /layer/lib
LD_LIBRARY_PATH=/layer/lib node -e "
const sharp = require('sharp');
console.log(sharp.versions);
console.log('heif input:', JSON.stringify(sharp.format.heif?.input));
if (!sharp.format.heif?.input?.fileSuffix?.includes('.heic')) {
  throw new Error('sharp built without HEIC (HEVC) decode support');
}
"
