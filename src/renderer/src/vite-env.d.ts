/// <reference types="vite/client" />

import type { ClaudeDesktopApi } from "@shared/claude-types";

declare global {
  interface Window {
    claude: ClaudeDesktopApi;
  }
}

export {};
