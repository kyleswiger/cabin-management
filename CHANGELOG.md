# Changelog

## 1.0.0 (2026-08-14)


### Features

* add SES email notifications and SMS consent capture ([58404e2](https://github.com/kyleswiger/cabin-management/commit/58404e2268f55055a0b5c2f411a9b2592ae1cf96))
* **api:** albums, media upload, print queue, and signed-cookie media sessions ([3d15277](https://github.com/kyleswiger/cabin-management/commit/3d15277ee73882f7c064d7d82ba2939d224bf341))
* **chores:** allow removing a mis-logged chore ([a572410](https://github.com/kyleswiger/cabin-management/commit/a572410fb0f58c001d0996d17ee652e54a2c0b27))
* **ci:** release automation and a keyless deploy role ([b252191](https://github.com/kyleswiger/cabin-management/commit/b252191c0e7e71fb5f172e8f9befab06b7ce9e0c))
* **ci:** release automation and a keyless deploy role ([2b6df7e](https://github.com/kyleswiger/cabin-management/commit/2b6df7eacd07a0869f875355fd86d4aed3af7176))
* disclose STOP in every outbound text ([14444e9](https://github.com/kyleswiger/cabin-management/commit/14444e928207c159a1ef276e7d9ee0e455991868))
* **frontend:** photo gallery and print queue UI (PRD 5.8, 5.9) ([050cb82](https://github.com/kyleswiger/cabin-management/commit/050cb828ccd2623fdaed2f62236f7030393edc48))
* **gallery:** surface album rename and delete ([c09424c](https://github.com/kyleswiger/cabin-management/commit/c09424ceebd3f83cc1d8efda5ae683334d67f5b4))
* **guestbook:** digital cabin logbook, dashboard tile, post-checkout nudge (PRD 5.10) ([cfce0ea](https://github.com/kyleswiger/cabin-management/commit/cfce0ea2e633214011e3fd91fb01d4fa17d1d52b))
* **infra:** add opt-in SMS origination number ([7d2c5bf](https://github.com/kyleswiger/cabin-management/commit/7d2c5bf22d985f3c12691a943f3b0a132d91fb64))
* **infra:** add opt-in SMS origination number ([5a22e79](https://github.com/kyleswiger/cabin-management/commit/5a22e7902edeaff7d469112dc905ce838e8ee423))
* **infra:** media pipeline — private bucket, signed-cookie CDN, processing Lambda (PRD 5.8) ([5b7348f](https://github.com/kyleswiger/cabin-management/commit/5b7348f60f0fad25af10dab279fa0080a50dcb63))
* **media:** CloudFront key generate/rotate script; rotation-safe public key ([4e9a94a](https://github.com/kyleswiger/cabin-management/commit/4e9a94ab6ac2332ecab59f837de72895abb21bd8))
* **media:** media-processing Lambda and MediaItem contract ([ceb8895](https://github.com/kyleswiger/cabin-management/commit/ceb8895389f5fd7ddffc5eb4a8b99602e740d50d))
* **media:** sharp/libvips+libheif Lambda layer build tooling ([0f73b2e](https://github.com/kyleswiger/cabin-management/commit/0f73b2ef832ad9b209d8c85dd54844645be66d52))
* Phase 4–5 — media gallery, print queue, guestbook, area guide (PRD v2) ([2f1db1a](https://github.com/kyleswiger/cabin-management/commit/2f1db1a45760471201774b7f596acfaa546bba71))
* **seed:** seed the PRD 9.2 reference albums ([218bcd8](https://github.com/kyleswiger/cabin-management/commit/218bcd8649cb499f4ad6a81725ae014396d3ea7a))
* **seed:** seed the PRD 9.2 reference albums ([43b95ed](https://github.com/kyleswiger/cabin-management/commit/43b95ed9e896137f035f6ef7d6da1c7ca8d9d37a))
* SES email notifications and SMS consent capture ([bb95554](https://github.com/kyleswiger/cabin-management/commit/bb955543756e046183e8c3b7e5b734f266f6704f))
* SES email notifications and SMS consent capture (retarget of [#6](https://github.com/kyleswiger/cabin-management/issues/6)) ([e3a5f5b](https://github.com/kyleswiger/cabin-management/commit/e3a5f5bfbc6de3c456b2dfefb1febf8276b76598))
* **treks:** local treks & area guide, full-stack (PRD 5.11) ([a14e64a](https://github.com/kyleswiger/cabin-management/commit/a14e64a8c94780ceb5901efc86f44c037cf47523))


### Bug Fixes

* **api:** write index keys from the values being saved, not the re-read row ([611767a](https://github.com/kyleswiger/cabin-management/commit/611767a1e9f34bba2cc0319101335f3e888a19ae))
* **gallery:** don't send a whitespace-only album title ([2653cb0](https://github.com/kyleswiger/cabin-management/commit/2653cb076898e955e31f487ca0671bd5f436b6f4))
* **gallery:** surface the blank-title error and allow Escape to cancel rename ([1635f19](https://github.com/kyleswiger/cabin-management/commit/1635f195eeaef5b43fa5639512a42f507b0a591e))
* install dependencies before building in deploy.sh ([c7e2a61](https://github.com/kyleswiger/cabin-management/commit/c7e2a61245e021eaa0a90d3712924ff6f6e2f167))
* install dependencies before building in deploy.sh ([b9beb5b](https://github.com/kyleswiger/cabin-management/commit/b9beb5b646e89f4f619a6b63375f82cdaaf5b7a9))
* **integration:** cross-branch fixes from parallel feature work ([7ac24e0](https://github.com/kyleswiger/cabin-management/commit/7ac24e064ad48361e387b8e67ef070880c28297b))
* **layer:** make the sharp/libheif layer build actually work; add CI ([21fa0d0](https://github.com/kyleswiger/cabin-management/commit/21fa0d01c1240fe3dee35352d70d77f2d6f33bce))
* pair consent checkboxes with their disclosure text ([62a2639](https://github.com/kyleswiger/cabin-management/commit/62a26390f7e319c3473d34330b018c289cea526e))
* pair consent checkboxes with their disclosure text ([b22b258](https://github.com/kyleswiger/cabin-management/commit/b22b258312c39b35afa9a34cd90c8fc93f3d877b))
* Phase 4-5 follow-ups — index keys, chore delete, album rename UI, print withdraw ([aac2400](https://github.com/kyleswiger/cabin-management/commit/aac2400347911154fcc7d95a158fe175d2513cfa))
* **prints:** let the requester withdraw their own print request ([515af47](https://github.com/kyleswiger/cabin-management/commit/515af47b695274a7dcbe2dcd2956bcf030f685d0))
* **review:** address PR [#10](https://github.com/kyleswiger/cabin-management/issues/10) findings ([0914b7d](https://github.com/kyleswiger/cabin-management/commit/0914b7d22f6308d1fa44c4400fd2d9ffda6bdd5a))
* **review:** guestbook date handling and index-key writes ([74ee56e](https://github.com/kyleswiger/cabin-management/commit/74ee56ea975e38f8f050371b315a8fafd5572b1a))
* **review:** media pipeline correctness, delete integrity, and deploy ergonomics ([79ca23d](https://github.com/kyleswiger/cabin-management/commit/79ca23d65643231df6d146208ac310b4444bd5df))
