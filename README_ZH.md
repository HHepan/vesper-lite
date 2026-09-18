# Vesper Lite (轻量级瀑布流 Agent 运行时)

<div align="center">

**基于三区无损瀑布流画布的高性能 Agent 运行时参考实现**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Zero-Native-Deps](https://img.shields.io/badge/Dependencies-100%25%20Pure%20TS%2FJS-purple.svg)]()

[English](README.md) | [中文说明](README_ZH.md)

</div>

---

## 🌟 什么是 Vesper Lite？

**Vesper Lite** 是 **Vesper Agent Runtime** 的开源轻量级核心参考实现。

针对主流大模型交互框架在面对长文本时普遍采用的“破坏性摘要”或“粗暴截断”痛点，Vesper Lite 开创性地实现了 **三区瀑布流画布协议（Active / Folded / Pinned）**，为单会话 Agent 交互提供了结构完整、无损折叠、随时还原的上下文管理范式。

### 核心亮点：
1. **100% 纯 TypeScript / JS 实现（零原生编译依赖）**：
   - 彻底移除了 `node-pty`、`ssh2` 等重型 C++ 原生构建依赖。在 Windows、macOS、Linux 上无需任何编译环境，秒级 `pnpm install` 安装即用。
2. **纯自研 Node.js 沙箱 Shell（`@vesper/bash`）**：
   - 零系统容器依赖，纯 JS 完整模拟 50+ POSIX 常用命令、管道（`|`）、重定向与通配符展开，内含 300+ 单元测试。
3. **三区瀑布流画布（Waterfall Canvas）**：
   - 上下文分为 **固定区（Pinned）**、**折叠区（Folded）** 与 **活跃区（Active）**。历史巨量输出自动折叠为单行浓缩摘要，但**原始数据无损留存**，支持按需展开。
4. **多端交互体验**：
   - 拥有基于 `Ink` 的极客终端 TUI，以及基于 `React` + `Vite` 构建的现代化 WebUI，支持相互物理隔离的独立多 Session 管理。

---

## 🏛️ 三区瀑布流画布架构

```
┌───────────────────────────────────────────────────────────────┐
│                      固定区 (Pinned Zone)                     │
│   • 长期常驻项目准则、待办任务栏与系统锚点                    │
│   • 永不折叠、永不丢失                                        │
├───────────────────────────────────────────────────────────────┤
│                      折叠区 (Folded Zone)                     │
│   • 历史多轮交互、大型文件读取结果与冗长工具执行输出          │
│   • 压缩为单行摘要呈现，原始结构在内存/DB中无损保留，可展开   │
├───────────────────────────────────────────────────────────────┤
│                      活跃区 (Active Zone)                     │
│   • 当前交互 Turn、流式输出与即时工具调用                     │
│   • 直接参与当前大模型上下文推理感知                          │
└───────────────────────────────────────────────────────────────┘
```

---

## 📦 模块分层结构

```
vesper-lite/
├── packages/
│   ├── shared/     # 画布核心类型、通信协议标准与工具接口定义
│   ├── bash/       # 纯 Node.js 自研沙箱 Shell（通过 303 项单测）
│   ├── core/       # 运行时流状态机、OpenAI/Anthropic 双协议驱动与安全沙箱
│   ├── server/     # 纯 TS 实现的静态 HTTP 托管与独立 Session WS 代理
│   ├── tui/        # 终端交互界面（渲染三区瀑布流画布）
│   └── web/        # React SPA 交互界面（三区画布流式展开、独立多 Session 侧边栏）
```

---

## 🚀 快速上手

### 环境要求
- Node.js >= 22.0.0
- pnpm >= 10.0.0

### 构建与安装

```bash
# 克隆仓库
git clone https://github.com/your-username/vesper-lite.git
cd vesper-lite

# 安装工作区依赖（纯 TS/JS，极速安装）
pnpm install

# 全量构建所有子包
pnpm run build

# 运行自动化测试
pnpm run test
```

### 启动终端 TUI 模式

```bash
export OPENAI_API_KEY="your-api-key"
# export OPENAI_BASE_URL="https://api.openai.com/v1" # 可选

./packages/tui/bin/vesper-tui.mjs
```

### 启动 Web 托管服务与 WebUI

```bash
# 默认端口启动（18760）
pnpm --filter @vesper/server start

# 自定义端口或 Host 启动
pnpm --filter @vesper/server start -- --port 8080
# 或：node packages/server/dist/cli.js --port 8080 --host 0.0.0.0
# 或通过环境变量：PORT=8080 pnpm --filter @vesper/server start
```
在浏览器中打开 `http://localhost:18760` 即可体验纯净的三区瀑布流画布与多会话管理。

---

## 🛡️ 安全合规与沙箱防护

- **PathGuard 路径沙箱**：内置核心工具管道强制校验文件操作边界，任何越权访问工作区以外目录的请求均被原地熔断拦截。
- **Loop Detection 循环熔断**：多轮 Tool Calling 死循环检测与自愈拦截。
- **单体会话物理隔离**：WebUI 与 Server 端的多会话彼此完全孤立，杜绝跨会话越权与状态泄漏。

---

## 📄 开源许可证

本项目基于 MIT License 开源。
