# sharp-heif Lambda layer

Build tooling for the custom [sharp](https://sharp.pixelplumbing.com/) Lambda layer the
media-processing Lambda (`backend/src/media/handler.ts`) depends on. See PRD 5.8.

## What it builds

`dist/layer.zip`, a Node Lambda layer for the `nodejs20.x`/`nodejs22.x` x86_64 runtime:

```
nodejs/node_modules/sharp/...   # sharp with its native addon compiled from source
lib/                            # libvips, libheif, libde265, libexif, glib, codecs...
```

Lambda extracts layers to `/opt`. `/opt/nodejs/node_modules` is on `NODE_PATH` (CJS
`require` finds sharp — the handler uses `createRequire` for exactly this reason, since
ESM `import` ignores `NODE_PATH`) and `/opt/lib` is already on the runtime's
`LD_LIBRARY_PATH`, so the shared libraries resolve with **no extra function config**.

Pinned versions are `ARG`s at the top of the `Dockerfile`: libde265, libheif
(decode-only — no x265/aom encoders), libexif (EXIF autorotation), libvips, and sharp.
Keep the sharp version in lockstep with the `sharp` devDependency in
`backend/package.json` (installed there only for its TypeScript types; the esbuild
config marks sharp `external`, so it is never bundled into `dist/media.zip`).

## Why a custom build

The prebuilt sharp binaries ship a libvips **without HEVC-based HEIC/HEIF decode**
(HEVC patent licensing). iPhone photo uploads are HEIC by default, and PRD 5.8 keeps
originals untouched in their native format — so the processing Lambda must decode HEIC
itself. This layer compiles libvips against libheif+libde265 to make
`sharp(heicBuffer)` work.

## How to run

Requires Docker able to build `linux/amd64` images (Buildx/QEMU on Apple Silicon).

```bash
./build.sh          # → dist/layer.zip (first run compiles libvips: ~10-20 min)
```

The Dockerfile ends with a smoke test — `sharp.format.heif.input.supported` must be
true and `vips --vips-config` must report HEIF — so a successful image build means a
working layer.

## Deploy dependency

**`terraform apply` for the media stack requires this artifact.** Terraform publishes
`dist/layer.zip` as the layer version attached to the media Lambda; `dist/` is
gitignored (top-level `dist/` + `*.zip` rules), so a fresh clone must run `./build.sh`
before deploying. Without the layer, the media Lambda fails at init with
`Cannot find module 'sharp'`.
