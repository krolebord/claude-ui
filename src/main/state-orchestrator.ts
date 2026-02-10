import { type INTERNAL_Op, subscribe, unstable_enableOp } from "valtio/vanilla";
import type {
  ClaudeAllStatesSnapshot,
  ClaudeStateKey,
  ClaudeStateSetEvent,
  ClaudeStateUpdateEvent,
} from "../shared/claude-types";
import { CLAUDE_STATE_KEYS } from "../shared/claude-types";
import {
  type ServiceState,
  getServiceStateSnapshot,
} from "../shared/service-state";
import log from "./logger";

interface RegisteredState {
  serviceState: ServiceState;
  version: number;
  unsubscribe: () => void;
}

export interface StateOrchestratorCallbacks {
  emitStateSet: (payload: ClaudeStateSetEvent) => void;
  emitStateUpdate: (payload: ClaudeStateUpdateEvent) => void;
}

interface StateOrchestratorOptions {
  serviceStates: ServiceState[];
  callbacks: StateOrchestratorCallbacks;
}

export class StateOrchestrator {
  private readonly callbacks: StateOrchestratorCallbacks;
  private readonly states = new Map<ClaudeStateKey, RegisteredState>();

  constructor(options: StateOrchestratorOptions) {
    this.callbacks = options.callbacks;
    unstable_enableOp(true);

    for (const serviceState of options.serviceStates) {
      this.registerServiceState(serviceState);
    }
  }

  getAllStatesSnapshot(): ClaudeAllStatesSnapshot {
    return {
      projects: this.getStateSnapshot("projects"),
      sessions: this.getStateSnapshot("sessions"),
      activeSession: this.getStateSnapshot("activeSession"),
    };
  }

  getStateSnapshot<K extends ClaudeStateKey>(key: K): ClaudeStateSetEvent<K> {
    const registered = this.states.get(key);
    if (!registered) {
      throw new Error(`Unknown state key: ${key}`);
    }

    return {
      key,
      state: getServiceStateSnapshot(
        registered.serviceState,
      ) as ClaudeStateSetEvent<K>["state"],
      version: registered.version,
    };
  }

  emitAllStateSets(): void {
    for (const key of CLAUDE_STATE_KEYS) {
      this.callbacks.emitStateSet(this.getStateSnapshot(key));
    }
  }

  dispose(): void {
    for (const registered of this.states.values()) {
      registered.unsubscribe();
    }
    this.states.clear();
  }

  private registerServiceState(serviceState: ServiceState): void {
    if (this.states.has(serviceState.key)) {
      throw new Error(`Duplicate state key registration: ${serviceState.key}`);
    }

    const unsubscribe = subscribe(serviceState.state, (ops) => {
      this.handleStateMutation(serviceState.key, ops);
    });

    this.states.set(serviceState.key, {
      serviceState,
      version: 0,
      unsubscribe,
    });
  }

  private handleStateMutation(key: ClaudeStateKey, ops: INTERNAL_Op[]): void {
    const registered = this.states.get(key);
    if (!registered) {
      return;
    }

    try {
      getServiceStateSnapshot(registered.serviceState);
      const nextVersion = registered.version + 1;
      const payload: ClaudeStateUpdateEvent = {
        key,
        version: nextVersion,
        ops,
      };

      registered.version = nextVersion;
      this.callbacks.emitStateUpdate(payload);
    } catch (error) {
      log.error("Failed to serialize state update", {
        key,
        error,
      });
    }
  }
}
