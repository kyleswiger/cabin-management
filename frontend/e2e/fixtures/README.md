# e2e fixtures

`e2e-photo.jpg` is generated and committed — nothing to do.

`e2e-photo-c003.heic` is **not committed** and you have to supply it yourself. Drop any
real iPhone HEIC at that exact path and `gallery.spec.ts` picks it up automatically; no
spec change is needed.

Without it the upload test still runs, just JPEG-only, so the libvips+libheif Lambda
layer — the whole reason `backend/layers/sharp-heif/` exists — goes unexercised. Worth
supplying locally before touching anything in the media pipeline.

It must be a genuinely HEVC-coded HEIC. The layer builds libheif with libde265 and
`WITH_AOM_DECODER=OFF`, so an AV1-coded (AVIF-in-HEIF) file fails to decode for reasons
that have nothing to do with the app — a confusing red herring. Photos straight off an
iPhone are HEVC.

The obvious public samples (nokiatech's HEIF conformance files) declare no license, which
is why this repo ships none.
