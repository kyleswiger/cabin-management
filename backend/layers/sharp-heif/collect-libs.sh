#!/usr/bin/env bash
# Collect shared libs into the layer (run inside the build image).
#
# Ship every runtime .so the sharp addon needs that the bare Lambda runtime may
# not provide (libvips, libheif, libde265, glib, image codecs, ...). Base glibc
# libs are skipped; libstdc++/libgcc_s are kept deliberately — harmless if the
# runtime already has them.
#
# A plain script COPY'd into the image, not a RUN heredoc: the legacy Docker
# builder (no BuildKit) silently runs heredoc RUN steps as *empty* commands,
# which is exactly the failure mode that shipped an unusable layer once.
set -eux
NODE_BIN="$(find /layer/nodejs/node_modules/sharp -name 'sharp-*.node' | head -n1)"
test -n "$NODE_BIN"
mkdir -p /layer/lib
ldd "$NODE_BIN" | awk '$3 ~ /^\// {print $3}' | sort -u | while read -r so; do
  case "$(basename "$so")" in
    ld-linux*|libc.so*|libm.so*|libpthread.so*|libdl.so*|librt.so*|libresolv.so*|libutil.so*) continue ;;
  esac
  cp -Ln "$so" /layer/lib/
done
strip --strip-unneeded /layer/lib/*.so* "$NODE_BIN" || true
