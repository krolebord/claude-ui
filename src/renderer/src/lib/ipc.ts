import type {
  ClaudeActivityState,
  ClaudeSessionStatus,
  StartClaudeInput,
  StartClaudeResult,
  StopClaudeResult,
} from "@shared/claude-types";

export const claudeIpc = {
  selectFolder: (): Promise<string | null> => window.claude.selectFolder(),
  getStatus: (): Promise<ClaudeSessionStatus> => window.claude.getStatus(),
  getActivityState: (): Promise<ClaudeActivityState> =>
    window.claude.getActivityState(),
  getActivityWarning: (): Promise<string | null> =>
    window.claude.getActivityWarning(),
  startClaude: (input: StartClaudeInput): Promise<StartClaudeResult> =>
    window.claude.startClaude(input),
  stopClaude: (): Promise<StopClaudeResult> => window.claude.stopClaude(),
  writeToClaude: (data: string): void => window.claude.writeToClaude(data),
  resizeClaude: (cols: number, rows: number): void =>
    window.claude.resizeClaude(cols, rows),
};
