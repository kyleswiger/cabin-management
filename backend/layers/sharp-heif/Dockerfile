# syntax=docker/dockerfile:1
#
# sharp + libvips + libheif Lambda layer (PRD 5.8).
#
# The prebuilt sharp binaries bundle a libvips WITHOUT HEVC-based HEIC/HEIF decode
# (patent licensing), so iPhone photos would fail to process. This image compiles
# libde265 → libheif → libvips from source, then builds sharp against that libvips
# (SHARP_FORCE_GLOBAL_LIBVIPS), and zips the result laid out as a Node Lambda layer:
#
#   nodejs/node_modules/sharp/...   found via NODE_PATH (/opt/nodejs/node_modules)
#   lib/*.so*                       found via LD_LIBRARY_PATH (/opt/lib is on the
#                                   Lambda runtime's default LD_LIBRARY_PATH — no
#                                   extra env var needed on the function)
#
# Amazon Linux 2023 matches the nodejs20.x/nodejs22.x Lambda runtime, so everything
# links against the same glibc. Build with ./build.sh (forces --platform linux/amd64).

FROM public.ecr.aws/amazonlinux/amazonlinux:2023

ARG LIBDE265_VERSION=1.0.16
ARG LIBHEIF_VERSION=1.19.8
ARG LIBEXIF_VERSION=0.6.24
# sharp pins a minimum libvips (0.35.3 → 8.18.3); keep this at what the sharp
# version's common.h demands or the addon compile fails.
ARG VIPS_VERSION=8.18.3
# Keep in lockstep with the sharp devDependency in backend/package.json — the local
# install is what typechecks the media Lambda against these same type definitions.
ARG SHARP_VERSION=0.35.3

# Toolchain + the image-format -devel packages libvips links against. The matching
# runtime .so files are collected into the layer's lib/ at the end.
RUN dnf -y install \
      gcc gcc-c++ make cmake git tar gzip bzip2 xz zip binutils \
      pkgconf-pkg-config python3 python3-pip \
      glib2-devel expat-devel zlib-devel \
      libjpeg-turbo-devel libpng-devel libwebp-devel libtiff-devel lcms2-devel \
      nodejs20 nodejs20-npm && \
    dnf clean all && \
    ln -sf /usr/bin/node-20 /usr/local/bin/node && \
    ln -sf /usr/bin/npm-20 /usr/local/bin/npm && \
    pip3 install --no-cache-dir meson ninja

# Everything installs into /opt with libdir=lib so paths inside the container match
# the paths the layer will have at runtime (/opt/lib is on Lambda's LD_LIBRARY_PATH).
ENV PKG_CONFIG_PATH=/opt/lib/pkgconfig:/opt/lib64/pkgconfig \
    LD_LIBRARY_PATH=/opt/lib

WORKDIR /build

# --- libde265: the HEVC decoder libheif uses for HEIC (no encoder needed) ----------
RUN curl -fsSL "https://github.com/strukturag/libde265/releases/download/v${LIBDE265_VERSION}/libde265-${LIBDE265_VERSION}.tar.gz" | tar xz && \
    cmake -S "libde265-${LIBDE265_VERSION}" -B libde265-build \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt -DCMAKE_INSTALL_LIBDIR=lib \
      -DENABLE_SDL=OFF && \
    cmake --build libde265-build -j"$(nproc)" && \
    cmake --install libde265-build

# --- libheif: decode-only (no x265/aom encoders — originals are never re-encoded) --
RUN curl -fsSL "https://github.com/strukturag/libheif/releases/download/v${LIBHEIF_VERSION}/libheif-${LIBHEIF_VERSION}.tar.gz" | tar xz && \
    cmake -S "libheif-${LIBHEIF_VERSION}" -B libheif-build \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt -DCMAKE_INSTALL_LIBDIR=lib \
      -DWITH_LIBDE265=ON -DWITH_X265=OFF -DWITH_AOM_DECODER=OFF -DWITH_AOM_ENCODER=OFF \
      -DWITH_EXAMPLES=OFF -DBUILD_TESTING=OFF && \
    cmake --build libheif-build -j"$(nproc)" && \
    cmake --install libheif-build

# --- libexif: EXIF orientation for sharp's .rotate() autorotation (media handler) --
RUN curl -fsSL "https://github.com/libexif/libexif/releases/download/v${LIBEXIF_VERSION}/libexif-${LIBEXIF_VERSION}.tar.bz2" | tar xj && \
    cd "libexif-${LIBEXIF_VERSION}" && \
    ./configure --prefix=/opt --libdir=/opt/lib --disable-static --disable-docs && \
    make -j"$(nproc)" && make install

# --- libvips: HEIF enabled via the libheif we just built ---------------------------
RUN curl -fsSL "https://github.com/libvips/libvips/releases/download/v${VIPS_VERSION}/vips-${VIPS_VERSION}.tar.xz" | tar xJ && \
    cd "vips-${VIPS_VERSION}" && \
    meson setup build --prefix=/opt --libdir=lib --buildtype=release \
      -Dheif=enabled -Dexif=enabled -Djpeg=enabled -Dpng=enabled -Dwebp=enabled \
      -Ddeprecated=false -Dexamples=false -Dintrospection=disabled -Dmodules=disabled && \
    ninja -C build && ninja -C build install && \
    /opt/bin/vips --vips-config | grep -i "heif"

# --- sharp: compile the native addon against the global (/opt) libvips -------------
# sharp ≥0.33 has NO install-time compile (npm install only fetches the @img/*
# prebuilts) — building from source is the package's explicit `npm run build`
# (install/build.js), which requires node-addon-api + node-gyp to be requirable
# and honors SHARP_FORCE_GLOBAL_LIBVIPS to link the /opt libvips via pkg-config.
# The compiled addon lands in src/build/Release/sharp-linux-x64.node; the
# @img/sharp-* prebuilts are then deleted so require() can only resolve the
# source build. Only sharp-* — @img also hosts pure-JS runtime deps
# (@img/colour) that sharp needs at require() time.
RUN mkdir -p /layer/nodejs && cd /layer/nodejs && \
    npm init -y >/dev/null && \
    npm install node-addon-api node-gyp "sharp@${SHARP_VERSION}" && \
    cd node_modules/sharp && \
    SHARP_FORCE_GLOBAL_LIBVIPS=1 npm run build && \
    find src/build/Release -name 'sharp-*.node' | grep -q . && \
    rm -rf src/build/Release/obj.target src/build/Release/.deps && \
    cd /layer/nodejs && \
    npm uninstall node-gyp node-addon-api && \
    rm -rf node_modules/@img/sharp-* node_modules/.bin

# --- collect shared libs, smoke-test, zip ------------------------------------------
# COPY'd scripts instead of RUN heredocs: the legacy Docker builder (docker without
# BuildKit) treats heredoc RUN steps as empty commands and "succeeds" — producing a
# layer with no lib/ and no smoke test. Scripts fail loudly on both builders.
COPY collect-libs.sh smoke-test.sh /build/
RUN bash /build/collect-libs.sh
RUN bash /build/smoke-test.sh

RUN cd /layer && zip -qry /layer.zip nodejs lib && unzip -l /layer.zip | tail -n 3
