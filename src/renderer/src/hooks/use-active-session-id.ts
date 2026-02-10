import type { SessionId } from "@shared/claude-types";
import { useRoute } from "wouter";

export function useActiveSessionId(): SessionId | null {
  const [, params] = useRoute("/session/:sessionId");
  return (params?.sessionId as SessionId) ?? null;
}
