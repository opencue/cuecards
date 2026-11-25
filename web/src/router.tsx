import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Link, notFound, Outlet, redirect } from "@tanstack/react-router";
import { StudioApp } from "./studio/StudioApp";
import { Welcome } from "./studio/views/Welcome";
import { WorkspacesPage } from "./workspaces/Workspaces";
import { parseHomeSearch, parseProfileId, parseStudioView, parseWorkspaceSearch } from "./route-search";
import { isDemoMode } from "./lib/fetcher";

const root = createRootRoute({
  component: Outlet,
  notFoundComponent: () => <main className="ws-shell"><h1>Page not found</h1><Link to="/">Back to Studio</Link></main>,
  errorComponent: () => <main className="ws-shell"><h1>This page could not load</h1><a href="/">Reload Studio</a></main>,
});
const home = createRoute({
  getParentRoute: () => root, path: "/", component: StudioRoute,
  validateSearch: parseHomeSearch,
});
const PublicMarket = lazyRouteComponent(() => import("./studio/views/PublicMarket"), "PublicMarket");
function StudioRoute() {
  const search = home.useSearch();
  const { view } = search;
  const navigate = home.useNavigate();
  if (isDemoMode()) {
    if (!view || view === "welcome") return <Welcome />;
    if (view === "market") return <PublicMarket search={search} onSearchChange={(next, replace) => {
      void navigate({ search: previous => ({ ...previous, ...next }), hash: true, hashScrollIntoView: false, resetScroll: false, replace });
    }} />;
  }
  return <StudioApp view={view ?? "inventory"} onViewChange={next => void navigate({ search: { view: next } })} />;
}
const legacyStudio = createRoute({
  getParentRoute: () => root, path: "/studio/$view",
  beforeLoad: ({ params }) => { throw redirect({ to: "/", search: { view: parseStudioView(params.view) } }); },
});
const workspaces = createRoute({
  getParentRoute: () => root, path: "/workspaces", component: WorkspacesPage,
  validateSearch: parseWorkspaceSearch,
});
const skills = createRoute({
  getParentRoute: () => root, path: "/skills",
  component: lazyRouteComponent(() => import("./routes/SkillCatalog"), "SkillCatalog"),
});
const profile = createRoute({
  getParentRoute: () => root, path: "/profiles/$id",
  beforeLoad: ({ params }) => { if (!isDemoMode() || !parseProfileId(params.id)) throw notFound(); },
  component: lazyRouteComponent(() => import("./studio/views/PublicProfileDetail"), "PublicProfileDetail"),
});
export const router = createRouter({ routeTree: root.addChildren([home, skills, profile, workspaces, legacyStudio]) });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
