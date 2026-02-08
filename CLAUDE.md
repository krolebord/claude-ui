# Claude UI

## Project Description
Desktop Electron app that embeds Claude CLI in an xterm terminal. Runtime state and session lifecycle are orchestrated through Electron IPC, with a multi-session backend and a single active terminal pane in the renderer.

`AGENTS.md` is a symlink to this file, so keep this document accurate and implementation-specific.

## Tech Stack
- Electron + Vite + React + TypeScript
- Tailwind CSS + Radix UI primitives
- `node-pty` for Claude CLI terminal process management
- xterm.js (`@xterm/xterm`, `@xterm/addon-fit`) for terminal rendering
- `electron-store` for persisted local UI/session metadata
- `nano-spawn` for generated session title requests
- Biome for lint/format
- Vitest for unit tests
- pnpm for package management

## High-Level Architecture
### Process boundaries
- Main process (`src/main`): owns session lifecycle, Claude process management, hook/event monitoring, persistence, and IPC handlers.
- Preload (`src/preload/index.ts`): exposes a typed `window.claude` bridge with `invoke/send/on` wrappers.
- Shared contracts (`src/shared/claude-types.ts`): canonical IPC channels, DTOs, and event payload types.
- Renderer (`src/renderer/src`): state service + React UI; no direct Node/Electron main APIs.

### Core services
- `src/main/claude-session-service.ts`
  - Source of truth for sessions/projects/active session.
  - Creates and coordinates one `ClaudeSessionManager` and one `ClaudeActivityMonitor` per session.
  - Hydrates persisted snapshots at startup.
  - Emits scoped session events back to renderer.
- `src/main/claude-session.ts`
  - Wraps `node-pty` spawn/write/resize/stop lifecycle.
  - Launches `claude` in interactive shell (`-ilc` on Unix, `cmd /c` on Windows).
  - Supports `--session-id`, `--resume`, `--model`, and `--dangerously-skip-permissions`.
- `src/main/claude-activity-monitor.ts`
  - Watches NDJSON state file written by Claude hook plugin.
  - Watch-first with polling fallback.
  - Reduces hook events into activity states (`working`, `awaiting_approval`, etc.).
- `src/main/claude-state-plugin.ts`
  - Creates managed Claude plugin under app user data.
  - Registers Claude hook events and writes normalized NDJSON events.
- `src/main/claude-project-store.ts`
  - Persists project list/collapse state in `electron-store`.
- `src/main/claude-session-snapshot-store.ts`
  - Persists session snapshots and `activeSessionId` in `electron-store`.
- `src/renderer/src/services/terminal-session-service.ts`
  - Renderer-side state orchestration (React-independent).
  - Handles all IPC calls/events and terminal attachment.
  - Maintains per-session output ring buffers (10,000 lines, 2MB cap).
- `src/renderer/src/services/use-terminal-session.ts`
  - React binding via `useSyncExternalStore`.

## Session Lifecycle and Data Flow
1. Renderer calls `startClaudeSession` with cwd + terminal size (+ optional session config).
2. Main service creates session record, monitor, and PTY manager.
3. Main service creates state file and starts monitor.
4. PTY manager launches `claude`; service marks session active when startup succeeds.
5. Main emits session events (`data/status/error/exit/activity/hook/title`) via IPC.
6. Renderer updates local state and routes output only for `activeSessionId`.
7. Session switching is authoritative from main: renderer requests switch, then updates only after `active-session-changed` event.

## Persistence Model
- Projects (`projects`): normalized unique paths + `collapsed` flag.
- Sessions (`sessionSnapshots`): session metadata (`status`, `activityState`, `sessionName`, timestamps, errors).
- Active session (`activeSessionId`): persisted if it still exists.
- On app restart:
  - Snapshots are hydrated as stopped sessions (`status: "stopped"`, `activityState: "idle"`).
  - Existing IDs remain resumable through `resumeSessionId`.

## Important Implementation Invariants
- Shared types in `src/shared/claude-types.ts` are the IPC contract. Keep preload/main/renderer in sync.
- Session operations are always `sessionId` scoped.
- Terminal writes are sent only for the active session; inactive session output is buffered for replay on activation.
- Session switch UI state changes only after main emits `active-session-changed`.
- Renderer business logic belongs in `terminal-session-service`; components stay presentation-focused.
- Session title auto-generation triggers once, only for unnamed sessions, on first non-empty `UserPromptSubmit`.

## Directory Structure
```text
src/
  main/
    index.ts                           # Electron bootstrap + IPC wiring
    claude-session-service.ts          # Main orchestration / source of truth
    claude-session.ts                  # PTY lifecycle for claude process
    claude-activity-monitor.ts         # Hook event file monitor
    claude-state-plugin.ts             # Managed plugin generator
    claude-project-store.ts            # Persisted project list
    claude-session-snapshot-store.ts   # Persisted session snapshots
    generate-session-title.ts          # Optional auto-title generation
  preload/
    index.ts                           # window.claude bridge
  shared/
    claude-types.ts                    # IPC channels and shared contracts
  renderer/src/
    services/
      terminal-session-service.ts      # Renderer state orchestration
      use-terminal-session.ts          # React store subscription
    components/
      terminal-pane.tsx                # xterm integration
      session-sidebar.tsx              # Project/session navigation
      new-session-dialog.tsx           # Session creation options
```

## Test Coverage Map
- `test/main/claude-session-service.spec.ts`
  - Multi-session behavior, persistence, resume/delete/active transitions, event scoping, title generation triggers.
- `test/main/claude-activity-monitor.spec.ts`
  - Watch-first flow, polling fallback, malformed line handling, state transitions.
- `test/renderer/terminal-session-service.spec.ts`
  - Renderer state actions, IPC bridging, active-session replay semantics, output ring-buffer limits.

## Logs
- App logs (via `electron-log`): `~/Library/Logs/claude-ui/main.log`
- Both dev (`pnpm dev`) and production (built app) logs go to the same file.
- Unit tests also write to this log file.

## Common Commands
- Install deps: `pnpm install`
- Run app (dev): `pnpm dev`
- Build: `pnpm build`
- Type check: `pnpm typecheck`
- Format (lint + format fix): `pnpm format`
- Run unit tests: `pnpm exec vitest --run`
- Run targeted tests:
  - `pnpm exec vitest --run test/main/claude-session-service.spec.ts`
  - `pnpm exec vitest --run test/main/claude-activity-monitor.spec.ts`
  - `pnpm exec vitest --run test/renderer/terminal-session-service.spec.ts`
