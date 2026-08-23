import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActiveProfile } from "./components/ActiveProfile";
import { ActiveSessions } from "./components/ActiveSessions";
import { SkillActivation } from "./components/SkillActivation";
import { TokenCostChart } from "./components/TokenCostChart";
import { ActivityChart } from "./components/ActivityChart";
import { PairSuggestions } from "./components/PairSuggestions";
import { TriggerGaps } from "./components/TriggerGaps";
import { GateTimeline } from "./components/GateTimeline";
import { StatsOverview } from "./components/StatsOverview";
import { OfflineCTA } from "./components/OfflineCTA";
import { MergeStudio } from "./routes/MergeStudio";
import { fetcher, getCueMode } from "./lib/fetcher";

type Route = "dashboard" | "merge";

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    window.location.hash === "#/merge" ? "merge" : "dashboard");
  useEffect(() => {
    const on = () => setRoute(window.location.hash === "#/merge" ? "merge" : "dashboard");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function App() {
  const mode = getCueMode();
  const route = useHashRoute();

  // One shared probe against /status: tells us whether the dashboard server
  // is reachable. If not, render a single big CTA banner instead of six
  // cards all repeating the same "non-JSON" error.
  const probe = useQuery({
    queryKey: ["status"],
    queryFn: () => fetcher<unknown>("/status"),
  });
  const offline = mode === "local" && probe.isError &&
    (probe.error as Error).message.startsWith("dashboard-server-unreachable");

  return (
    <div className="app">
      <header className="app-header">
        <div className="row" style={{ gap: 18 }}>
          <div className="brand">cue</div>
          <nav className="nav-tabs">
            <a className={route === "dashboard" ? "on" : ""} href="#/">dashboard</a>
            <a className={route === "merge" ? "on" : ""} href="#/merge">merge studio</a>
          </nav>
        </div>
        <div className="header-status">
          {mode === "demo" ? (
            <span className="badge demo">demo data · Vercel preview</span>
          ) : offline ? (
            <span className="badge demo">server offline</span>
          ) : (
            <span className="badge live">live · 127.0.0.1</span>
          )}
        </div>
      </header>

      {route === "merge" ? (
        <main>
          <MergeStudio />
        </main>
      ) : offline ? (
        <OfflineCTA message={(probe.error as Error).message} />
      ) : (
        <main className="app-grid">
          <StatsOverview />
          <ActivityChart />
          <ActiveProfile />
          <ActiveSessions />
          <SkillActivation />
          <TokenCostChart />
          <div className="grid-row-pair">
            <PairSuggestions />
            <TriggerGaps />
          </div>
          <GateTimeline />
        </main>
      )}

      <footer className="app-footer">
        {route === "merge" ? (
          <>Compose profiles into one. Writes to <code>profiles/&lt;name&gt;/profile.yaml</code> (local only). Mirror of <code>cue merge</code>.</>
        ) : (
          <>Read-only. Every card links to the CLI command that drives it. Source data: <code>~/.config/cue/*</code></>
        )}
      </footer>
    </div>
  );
}
