<div align="center">

# Easyenv

**Browse and edit every `.env` file across all your projects — from one clean GUI.**

No more hunting for `.env.local` files and squinting at them in `vi`. Easyenv finds them all, groups them by git repository, and lets you edit keys and values in a tidy table.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/kei155/easyenv?color=success)](https://github.com/kei155/easyenv/releases)
[![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/kei155/easyenv/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)

<img src="docs/screenshot.png" alt="Easyenv — browse and edit .env files across projects" width="860" />

</div>

## Why

Most projects carry one or more `.env` / `.env.local` files, and they're tedious to open and edit one by one in a terminal editor. Existing tools either manage **system** environment variables (not project files), live inside an editor extension, or are cloud secret managers. Easyenv fills the gap: a small, fully local native app that finds your project `.env` files and edits them as key/value pairs.

## Features

| | |
|---|---|
| 🗂️ **Project grouping** | Files are grouped under their **git repository**, not just the leaf folder. Monorepo role folders (`backend` / `web` / `api`) fold under the parent project. |
| 🌿 **Worktree aware** | `.env` files in linked git worktrees fold under their main repo as **collapsible, per-branch sub-groups** — so a busy worktree monorepo stays readable. |
| 🔎 **Key search** | Search by file, project, path, **or key name**. Matching keys are highlighted as chips. |
| 💾 **Format-preserving** | Comments, blank lines, `export` prefixes, and quote styles are kept exactly. Writes are atomic (temp file + rename). |
| 📋 **Copy anything** | Copy a single key, a value, one `KEY=value` pair, the **whole file as `.env` text** (pastes straight into Vercel & friends), or as **JSON**. |
| 🧩 **JSON view** | See the whole file as a `{ }` object. |
| 👁️ **Value masking** | Toggle to hide/show values. |
| 🔒 **100% local** | No network, no telemetry, no account. Your secrets never leave your machine. |

## Privacy

Easyenv has **zero network access**. It only reads and writes files under the folders you register, plus a small `settings.json` (your registered roots) in the app's config directory. No analytics, no sync, no cloud.

## Install

> Currently built for **Apple Silicon (arm64)**. For Intel, build a universal binary from source (see below).

**Homebrew**

```sh
brew install --cask kei155/easyenv/easyenv
```

**Direct download** — grab the `.dmg` from the [Releases page](https://github.com/kei155/easyenv/releases), open it, and drag **Easyenv** to Applications.

> Easyenv isn't notarized by Apple, so macOS may block it on first launch ("damaged / unidentified developer"). Allow it with:
> ```sh
> xattr -dr com.apple.quarantine /Applications/Easyenv.app
> ```

## Usage

1. Click **➕** next to **Root folders** and pick a folder to scan (e.g. `~/projects`).
2. Easyenv lists every `.env*` under it, grouped by project. Click one to open it.
3. Edit keys/values in the table. **⌘S** (or the Save button) writes back.
4. Use **Copy .env** / **JSON** in the header to copy the whole file, or the per-row buttons for a single key, value, or pair.

## Build from source

Requires [Node.js](https://nodejs.org) and the [Rust toolchain](https://rustup.rs).

```sh
git clone https://github.com/kei155/easyenv.git
cd easyenv
npm install

# run in dev
npm run tauri dev

# build a release .app + .dmg (arm64)
npm run tauri build

# build a universal binary (Intel + Apple Silicon)
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

Artifacts land in `src-tauri/target/release/bundle/`.

## Tech

[Tauri 2](https://tauri.app) · React + TypeScript + Vite · Rust backend (`walkdir` for scanning, a small hand-rolled `.env` parser for format preservation).

## License

[MIT](LICENSE) © Easyenv contributors
