# Claude UI

## Project Description
Desktop Electron app that embeds Claude CLI in an xterm terminal, with session lifecycle/state routed through Electron IPC. The app now supports a multi-session backend foundation while keeping a single active terminal pane in the UI.

## Tech Stack
- Electron + Vite + React + TypeScript
- Tailwind CSS + Radix UI primitives
- `node-pty` for terminal process management
- xterm.js (`@xterm/xterm`, `@xterm/addon-fit`) for terminal rendering
- Biome for lint/format
- Vitest for unit tests
- pnpm for package management

## Common Patterns
- IPC contracts are centralized in `src/shared/claude-types.ts`.
- Preload exposes a typed `window.claude` bridge (`src/preload/index.ts`).
- Main process orchestration lives in services (for example `src/main/claude-session-service.ts`).
- Renderer state orchestration is service-based and React-independent (`src/renderer/src/services/terminal-session-service.ts`), consumed with `useSyncExternalStore` via `use-terminal-session.ts`.
- UI components stay mostly presentation-focused; session/process logic belongs in services, not React components.
- Session operations are session-id based (`start/stop/write/resize/set-active`), and terminal output is routed only for the active session.

## Common Commands
- Install deps: `pnpm install`
- Run app (dev): `pnpm dev`
- Build: `pnpm build`
- Preview build: `pnpm preview`
- Type check: `pnpm typecheck`
- Lint: `pnpm lint`
- Format: `pnpm format`
- Format check: `pnpm format:check`
- Run unit tests: `pnpm exec vitest --run`
- Run targeted tests:
  - `pnpm exec vitest --run test/main/claude-session-service.spec.ts`
  - `pnpm exec vitest --run test/renderer/terminal-session-service.spec.ts`
