import { describe, expect, it, vi } from "vitest";
import { defineServiceState } from "../../src/shared/service-state";
import { StateOrchestrator } from "../../src/main/state-orchestrator";

function createServiceStates() {
  return {
    projects: defineServiceState("projects", []),
    sessions: defineServiceState("sessions", {}),
    activeSession: defineServiceState("activeSession", {
      activeSessionId: null,
    }),
  };
}

describe("StateOrchestrator", () => {
  it("returns all registered states with version 0", () => {
    const states = createServiceStates();
    const orchestrator = new StateOrchestrator({
      serviceStates: [
        states.projects,
        states.sessions,
        states.activeSession,
      ],
      callbacks: {
        emitStateSet: vi.fn(),
        emitStateUpdate: vi.fn(),
      },
    });

    const all = orchestrator.getAllStatesSnapshot();
    expect(all.projects.version).toBe(0);
    expect(all.sessions.version).toBe(0);
    expect(all.activeSession.version).toBe(0);
    expect(all.activeSession.state.activeSessionId).toBeNull();
  });

  it("emits monotonic state-update versions with raw ops", async () => {
    const states = createServiceStates();
    const updates: Array<{ version: number; ops: unknown[] }> = [];
    const orchestrator = new StateOrchestrator({
      serviceStates: [
        states.projects,
        states.sessions,
        states.activeSession,
      ],
      callbacks: {
        emitStateSet: vi.fn(),
        emitStateUpdate: (payload) => {
          if (payload.key === "projects") {
            updates.push({
              version: payload.version,
              ops: payload.ops,
            });
          }
        },
      },
    });

    states.projects.state.push({
      path: "/workspace",
      collapsed: false,
    });
    await Promise.resolve();

    states.projects.state[0] = {
      path: "/workspace",
      collapsed: true,
    };
    await Promise.resolve();

    expect(updates).toHaveLength(2);
    expect(updates[0]?.version).toBe(1);
    expect(updates[1]?.version).toBe(2);
    expect(Array.isArray(updates[0]?.ops)).toBe(true);

    const projectState = orchestrator.getStateSnapshot("projects");
    expect(projectState.version).toBe(2);
    expect(projectState.state[0]?.collapsed).toBe(true);
  });

  it("emits state-set events for all static keys", () => {
    const states = createServiceStates();
    const setEvents: string[] = [];
    const orchestrator = new StateOrchestrator({
      serviceStates: [
        states.projects,
        states.sessions,
        states.activeSession,
      ],
      callbacks: {
        emitStateSet: (payload) => {
          setEvents.push(payload.key);
        },
        emitStateUpdate: vi.fn(),
      },
    });

    orchestrator.emitAllStateSets();
    expect(setEvents).toEqual(["projects", "sessions", "activeSession"]);
  });
});

