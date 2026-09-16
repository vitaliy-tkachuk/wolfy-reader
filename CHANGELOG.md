# Changelog

## [0.2.0](https://github.com/vitaliy-tkachuk/wolfy-reader/compare/wolfy-reader-v0.1.0...wolfy-reader-v0.2.0) (2026-09-16)


### Features

* adopt graphify knowledge graph as the first context tool ([fa5cee7](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/fa5cee7b287fef8a8ea4f7926f67bae315d52e5a))
* **core:** add Book model, typed errors, and open() format seam ([1bc4d1d](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/1bc4d1d03abaa687efe7512efb2039376b2ccbd8))
* **core:** add Position model with content-anchored capture ([f7a96a2](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/f7a96a2250f8eaa5cc5da646cc1dc69106ef8445))
* **core:** add Section.resolve() so formats own reference resolution ([4b84283](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/4b842837d1528312dbc06ef5cdbf5675c2b3dc0c))
* **core:** resolve positions by content with soft-miss degradation ([0364899](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/0364899cee089741fa8e99dfb03b64a5221bc91e))
* **demo:** open a real book and show what the decoder produced ([5db2c21](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/5db2c21a1b5bfea5d6a7793a77366c2c9ec745f1))
* **demo:** serve the demo over localhost with npm run demo ([df69aad](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/df69aad1d8c6d49e40c9966760351f15dee7a520))
* **epub:** decode container, OPF metadata, manifest and spine ([9231523](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/92315234210d578f82f9b25a68474314e49c2ed0))
* **epub:** resolve hrefs against the OPF and build the TOC ([c205af2](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/c205af22ca589537462ac2d0e374213412a6225c))
* **fb2:** decode FictionBook 2 into a Book through the format seam ([8e0d58f](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/8e0d58fdde4f5094e12d79212ba327a4b9b2079a))
* **fb2:** survive sloppy markup and claim UTF-16 FictionBooks ([d7cbd94](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/d7cbd94a9d43a286f3e51a7ba0646718a2e1b66b))
* **layout:** add content-anchored paginator with page↔position mapping ([8825d83](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/8825d83c7c48b187134a2becdd0d47b1ecc70fc9))
* **reader:** add draw-only decorations API over content anchors ([49f32c4](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/49f32c4d86281d0c0bf06fdfc3c3d7d5e54871ad))
* **reader:** add image containment and host-side tap-to-zoom ([fd357ea](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/fd357ea2fa78ebf7842f52aeb41d30cbfa6eb816))
* **reader:** add keyboard, swipe, and tap-zone input with RTL awareness ([eeb8a2e](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/eeb8a2e28d696d7062ed20c47ff5a3cdba2425e2))
* **reader:** add position-preserving typography controls ([ee1c26a](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/ee1c26aad0d5e1b73a802b87cea7cdfc870a3af5))
* **reader:** add public reader facade with navigation, events, and position-preserving mode switch ([b0b3356](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/b0b3356179a3356f81dcba5d035a2789266602cc))
* **reader:** add theme appearance system with live setAppearance ([4320061](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/4320061173348f692ee0f97ea1c8c8dac0a1a6da))
* **reader:** emit selection events with resolvable Position ([4f61eda](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/4f61edaf815af7c922ebc27f99bf56d5da97b174))
* **reader:** expose sentence ranges as the TTS enabler ([4bc5db4](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/4bc5db423fb5db697bf964e155565cbcdfdf1beb))
* **reader:** highlight a search hit on jump via decorate ([b6d8c7b](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/b6d8c7b0b5c6b04a1e12d7f7637453819c579d3b))
* **search:** add whole-book search with jumpable hits ([c498707](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/c498707d13b49e45b1be4cc5c0c485cc770df67b))
* **search:** capture anchors over the canonical reading text the frame shows ([639fe30](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/639fe30c3d8e033ec40583e1ecc1e9f48edc110d))
* **text:** decode plain text into a Book through the format seam ([0243fd2](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/0243fd28d432378c2059e0184a2312fd534ccb5c))
* **view:** make image zoom keyboard-operable and prove the pointer-free path ([9033cf5](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/9033cf55533f4b246611f899397d4711dccea329))
* **view:** render sections in a hardened sandboxed frame ([65938d8](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/65938d862eef8ef3c4262206b47decf520a64778))
* **zip:** add from-scratch ZIP reader over the bytes-in contract ([850264b](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/850264b2fdb33594e4f38e8106bd3e30c158ac25))
* **zip:** verify CRC-32 over decompressed bytes on entry read ([a2e69d6](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/a2e69d6d9cd1cc6db57b05fd26cbe89bcb71a1ce))


### Bug Fixes

* **appearance:** make margin actual page-edge whitespace, not just column gap ([e6b6c88](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/e6b6c88b8404febe42e826fab5d241bc131395d6))
* **demo:** dedup highlights by span so re-highlighting doesn't stack ([9f57dea](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/9f57dea1622c975fce6cc516e93091c40aea3cb0))
* **demo:** ignore benign superseded-render cancellation ([657f242](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/657f2426bd8b011cc72fffb4076f77f2c8f77e2a))
* **layout:** paint every page — chunk box must not clip its own columns ([59673f8](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/59673f83df385bcd121624774771aac2351889e7))
* **reader:** correct back-stack, Space paging, and nav-key gating ([f87ce0c](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/f87ce0c342e1829d04f138d0c5b8014ac154ec9e))
* **reader:** don't turn the page when a drag selects text ([aab53ba](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/aab53bac97682d902d5440a678c5d71fb7ecb7f0))
* **reader:** highlight whole sentences and whole selections ([e66f806](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/e66f8067c1ebd57f1283e5b184d51e625b3a9e83))
* **reader:** resolve in-book links to sections via a format seam ([bd7ddff](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/bd7ddff2b6e84ea152ab11f064b86fc507bbcfcd))
* **reader:** stop the iframe scrolling — clip the frame, re-paginate on resize ([05d5c2b](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/05d5c2b18f0c43834d130fe3a719b44902b4c238))


### Performance

* **position:** segment once per text, kill O(n²) capture and resolve ([b8c7749](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/b8c774985de11fae34251ce6ea0737ff237df17b))
* **view:** cache section-invariant render inputs and binary-search page offsets ([a42485a](https://github.com/vitaliy-tkachuk/wolfy-reader/commit/a42485a04fe473fddfec268be21a95d826bb472c))
