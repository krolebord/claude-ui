# TODO

## Codex Session True Resumption (future)

- Add true Codex session resumption once Codex CLI exposes custom hooks.
- Use hook events to capture and persist `CODEX_THREAD_ID` in session state (instead of relying on terminal output scraping).
- On resume, start Codex with `codex resume <thread_id>` when a persisted thread id is available.
- Keep current fallback behavior (restart from startup config) when no thread id exists.
- Add tests for:
  - thread id capture + persistence
  - app restart hydration with saved thread id
  - resume path selecting `codex resume <thread_id>`
