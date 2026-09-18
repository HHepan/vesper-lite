# Vesper Lite

<div align="center">

**A High-Performance, Single-Turn Agent Runtime with Lossless Waterfall Canvas**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Zero-Native-Deps](https://img.shields.io/badge/Dependencies-100%25%20Pure%20TS%2FJS-purple.svg)]()

[English](README.md) | [中文说明](README_ZH.md)

</div>

---

## 🌟 What is Vesper Lite?

**Vesper Lite** is a lightweight, zero-native-dependency open-source reference implementation of the **Vesper Agent Runtime**. 

Unlike conventional conversational AI frameworks that rely on destructive summarization or simple sliding-window truncation for long contexts, Vesper Lite introduces the **Three-Zone Waterfall Canvas (`Active` / `Folded` / `Pinned`)**, enabling lossless context expansion, structure-preserving fold/unfold interactions, and deterministic tool pipelining.

Built from the ground up for high portability and security:
- **100% Pure TypeScript / JavaScript**: Zero C++ native addon dependencies (`node-pty`, `ssh2`, etc. have been completely decoupled). Installs seamlessly across Windows, macOS, and Linux without compilation errors.
- **Embedded Sandbox Shell (`@vesper/bash`)**: A fully self-developed pure Node.js Bash interpreter featuring 50+ POSIX utilities, pipelines, and path guard interception.
- **Dual Presentation Modes**: Rich Terminal UI (`Ink` based) and Modern WebUI (`React` + `Vite` SPA) with multi-session physical sandbox isolation.

---

## 🏛️ Architecture & Three-Zone Waterfall Canvas

Vesper models conversation context as a **Three-Zone Waterfall Canvas** instead of a flat linear message array:

```
┌───────────────────────────────────────────────────────────────┐
│                      Pinned Zone (Top)                        │
│   • Persistent system guidelines & critical project anchors   │
│   • Never compressed, never folded                            │
├───────────────────────────────────────────────────────────────┤
│                      Folded Zone (Middle)                     │
│   • Historical turns, verbose tool executions, inspections    │
│   • Compact single-line summary with original content stored  │
│   • Reversible: fully expandable back to active state on demand│
├───────────────────────────────────────────────────────────────┤
│                      Active Zone (Bottom)                     │
│   • Live streaming turn, tool execution pipeline              │
│   • Direct perception window for LLM reasoning               │
└───────────────────────────────────────────────────────────────┘
```

When token usage drifts beyond thresholds, historical active blocks automatically compress into lossless folded summaries, keeping the LLM attention budget optimal while retaining full structural fidelity.

---

## 📦 Monorepo Structure

```
vesper-lite/
├── packages/
│   ├── shared/     # Protocol schemas, wire events, and Waterfall Canvas types
│   ├── bash/       # Pure Node.js POSIX Bash sandbox (300+ test suites)
│   ├── core/       # Flow runtime, OpenAI/Anthropic stream provider & tools
│   ├── server/     # Lightweight pure-TS HTTP & isolated WebSocket server
│   ├── tui/        # Terminal client with interactive canvas inspector
│   └── web/        # Modern React SPA WebUI with Waterfall Canvas visualization
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 22.0.0
- pnpm >= 10.0.0

### Installation & Build

```bash
# Clone the repository
git clone https://github.com/your-username/vesper-lite.git
cd vesper-lite

# Install all workspace packages (Fast & zero compilation!)
pnpm install

# Build all packages
pnpm run build

# Run unit test suites
pnpm run test
```

### Running TUI (Terminal Mode)

```bash
export OPENAI_API_KEY="your-api-key"
# export OPENAI_BASE_URL="https://api.openai.com/v1" # optional

./packages/tui/bin/vesper-tui.mjs
```

### Running Web Server & WebUI

```bash
pnpm --filter @vesper/server start
```
Open `http://localhost:18760` in your browser to experience the Waterfall Canvas interface with isolated multi-session workspace!

---

## 🔒 Security & Sandboxing

- **PathGuard Boundaries**: All file system operations (`read`, `write`, `edit`, `glob`, `grep`) are restricted to allowed workspace roots. Traversal outside allowed directories is blocked at the pipeline gateway.
- **Pure Node.js Shell Sandbox**: Built-in `@vesper/bash` provides safe execution of common commands without exposing raw host terminal handles.
- **Physical Session Isolation**: WebUI sessions are completely decoupled without cross-session eavesdropping or execution leakage.

---

## 📄 License

MIT License © 2026. Free for community inspection, study, and extension.
