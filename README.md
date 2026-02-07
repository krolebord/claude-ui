# Claude UI

Desktop Electron app that embeds Claude CLI in an xterm terminal, with session lifecycle/state routed through Electron IPC.

English | [简体中文](README.zh-CN.md)

## Features

- Multi-session backend with a single active terminal pane
- Project-based session organization with persisted project list
- Session controls: start, stop, resume, delete, switch active
- Live session status + activity state updates from Claude hook events
- Optional session naming, model selection, and `--dangerously-skip-permissions`

## Tech Stack

- Electron + Vite + React + TypeScript
- Tailwind CSS + Radix UI primitives
- `node-pty` for terminal process management
- xterm.js (`@xterm/xterm`, `@xterm/addon-fit`) for terminal rendering
- Vitest for unit tests
- Biome for linting/formatting
- pnpm for package management

## Prerequisites

- Node.js 18+
- pnpm
- Claude CLI installed and available in `PATH`

## Development

```sh
pnpm install
pnpm dev
```

## Build

```sh
pnpm build
pnpm preview
```

## Install In Applications (macOS)

Build a macOS app bundle and install it to your Applications folder:

```sh
pnpm app:install
```

Update later (rebuild + replace installed app):

```sh
pnpm app:update
```

Notes:

- Default install path is `/Applications`.
- If `/Applications` is not writable, it falls back to `~/Applications`.
- Override install destination with `CLAUDE_UI_INSTALL_DIR=/path/to/folder`.

## Quality Checks

```sh
pnpm typecheck
pnpm lint
pnpm format:check
```

## Test

```sh
pnpm exec vitest --run
```

Targeted:

```sh
pnpm exec vitest --run test/main/claude-session-service.spec.ts
pnpm exec vitest --run test/renderer/terminal-session-service.spec.ts
```

## Architecture

- IPC contracts: `src/shared/claude-types.ts`
- Preload bridge: `src/preload/index.ts` (`window.claude`)
- Main orchestration: `src/main/claude-session-service.ts`
- Renderer state service: `src/renderer/src/services/terminal-session-service.ts`
- React binding: `src/renderer/src/services/use-terminal-session.ts`

## License

MIT
