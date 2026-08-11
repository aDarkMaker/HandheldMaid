# Handheld Maid (HM)

Cross-platform desktop pet powered by Tauri 2 + Rust + TypeScript with Live2D rendering.

## Architecture

```
HandheldMaid/
├── crates/
│   └── core/              # Rust core: behavior engine, input hooks, system automation
├── apps/
│   └── desktop/           # Tauri 2 desktop app
│       ├── src-tauri/     # Rust backend (thin shell over the core)
│       └── renderer/      # TS frontend (Vite + PixiJS + pixi-live2d-display)
├── packages/
│   └── shared/            # Shared TS types / IPC protocol
└── assets/                # Live2D model assets
```

- **`crates/core`** — platform-agnostic core. Behavior engine, global input
  hooks (`rdev`), system automation (`enigo`). Reused by every frontend.
- **`apps/desktop/src-tauri`** — thin Tauri shell: window lifecycle, IPC
  commands, wires the core. No business logic here.
- **`apps/desktop/renderer`** — TypeScript frontend rendering Live2D via
  PixiJS.
- **`packages/shared`** — types mirrored between Rust and TS to keep the IPC
  contract in sync.

## Toolchain

- [Rust](https://rustup.rs/) (stable)
- [Bun](https://bun.sh/) (JS package manager + runtime)
- [Tauri CLI](https://v2.tauri.app/) (`cargo install tauri-cli --version "^2"`)

## Getting started

```bash
# JS deps
bun install

# Rust tooling (one-time)
cargo install tauri-cli --version "^2"

# Run the desktop app (builds Rust + launches dev server)
cargo tauri dev
```

## Roadmap

- [x] Cross-platform core + behavior engine
- [x] Transparent, frameless, always-on-top window
- [ ] Live2D rendering on the Tauri WebView
- [ ] Chat / voice interaction
- [ ] Screen awareness
- [ ] System automation ("do work on your computer")

## License

MIT
