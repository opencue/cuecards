import fs from "node:fs";

export function loadAdvisoryFeed(feedPath) { return JSON.parse(fs.readFileSync(feedPath, "utf8")); }
export function loadFeedState(statePath) { if (!statePath || !fs.existsSync(statePath)) return { status: "unknown" }; return JSON.parse(fs.readFileSync(statePath, "utf8")); }
export function isPicoclawAdvisory(advisory) {
  const platforms = Array.isArray(advisory?.platforms) ? advisory.platforms.map(x=>String(x).toLowerCase()) : [];
  const affected = Array.isArray(advisory?.affected) ? advisory.affected.map(x=>String(x).toLowerCase()) : [];
  const blob = `${advisory?.title || ""} ${advisory?.description || ""} ${advisory?.type || ""}`.toLowerCase();
  return platforms.length === 0 || platforms.includes("picoclaw") || platforms.includes("ai-gateway") || affected.some(x=>x.includes("picoclaw")) || blob.includes("picoclaw");
}
export function checkPicoclawAdvisories({ feedPath, statePath, allowUnsigned = false }) {
  const state = loadFeedState(statePath);
  if (!allowUnsigned && state.status !== "verified") throw new Error(`advisory feed state is not verified: ${state.status || "missing"}`);
  const feed = loadAdvisoryFeed(feedPath);
  const advisories = (feed.advisories || []).filter(isPicoclawAdvisory);
  return { status: "ok", feed_version: feed.version || null, verified_state: state.status || "unknown", count: advisories.length, advisories };
}
