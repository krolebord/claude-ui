import { proxy, snapshot } from "valtio/vanilla";
import type { ClaudeStateByKey, ClaudeStateKey } from "./claude-types";

const IS_DEV = process.env.NODE_ENV !== "production";

function assertJsonSerializable(value: unknown, path: string): void {
  if (!IS_DEV || typeof value !== "object" || value === null) {
    return;
  }

  try {
    JSON.stringify(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`State at ${path} is not JSON-serializable: ${message}`);
  }
}

export interface ServiceState<
  K extends ClaudeStateKey = ClaudeStateKey,
  T extends ClaudeStateByKey[K] = ClaudeStateByKey[K],
> {
  key: K;
  state: T;
}

export function defineServiceState<K extends ClaudeStateKey>(
  key: K,
  initialState: ClaudeStateByKey[K],
): ServiceState<K> {
  assertJsonSerializable(initialState, key);
  return {
    key,
    state: proxy(initialState),
  };
}

export function getServiceStateSnapshot<K extends ClaudeStateKey>(
  serviceState: ServiceState<K>,
): ClaudeStateByKey[K] {
  const plainSnapshot = snapshot(serviceState.state) as ClaudeStateByKey[K];
  assertJsonSerializable(plainSnapshot, serviceState.key);
  return plainSnapshot;
}
