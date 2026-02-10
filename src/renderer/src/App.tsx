import { NewSessionDialog } from "@renderer/components/new-session-dialog";
import { ProjectDefaultsDialog } from "@renderer/components/project-defaults-dialog";
import { SessionPage } from "@renderer/components/session-page";
import { SessionSidebar } from "@renderer/components/session-sidebar";
import { SettingsDialog } from "@renderer/components/settings-dialog";
import { WelcomePage } from "@renderer/components/welcome-page";
import { Toaster } from "@renderer/components/ui/sonner";
import { useKeyboardShortcuts } from "@renderer/hooks/use-keyboard-shortcuts";
import {
  useTerminalSession,
} from "@renderer/services/use-terminal-session";
import { Router, Switch, Route, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";

function AppRoutes() {
  const { state } = useTerminalSession();
  useKeyboardShortcuts();

  return (
    <div className="flex h-screen overflow-hidden">
      <SessionSidebar />

      <main className="flex min-w-0 flex-1 flex-col bg-black/15">
        <Switch>
          <Route path="/session/:sessionId">
            {(params) => <SessionPage sessionId={params.sessionId} />}
          </Route>
          <Route>
            {state.activeSessionId
              ? <Redirect to={`/session/${state.activeSessionId}`} replace />
              : <WelcomePage />}
          </Route>
        </Switch>
      </main>

      <NewSessionDialog />

      <ProjectDefaultsDialog />

      <SettingsDialog />

      <Toaster />
    </div>
  );
}

function App() {
  return (
    <Router hook={useHashLocation}>
      <AppRoutes />
    </Router>
  );
}

export default App;
