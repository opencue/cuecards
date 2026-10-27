/**
 * Static asset serving utilities extracted from dashboard-server.ts.
 * Serves profile and plugin logo images; maps file extensions to MIME types.
 */

import { readFile, stat as statAsync } from "node:fs/promises";
import { join, resolve } from "node:path";

import { loadProfile } from "./profile-loader";

const REPO_ROOT = resolve(new URL(import.meta.url).pathname, "..", "..", "..");

/** Absolute path to the profiles directory (overridable via env). */
export function mergeProfilesDir(): string {
  return process.env.CUE_PROFILES_DIR ?? join(REPO_ROOT, "profiles");
}

/** Directory holding generated plugin logos, keyed by `<plugin-name>.png`. */
export function pluginLogosDir(): string {
  return process.env.CUE_PLUGIN_LOGOS_DIR ?? join(REPO_ROOT, "resources", "plugin-logos");
}

export function contentTypeFor(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js"))   return "application/javascript; charset=utf-8";
  if (path.endsWith(".css"))  return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".svg"))  return "image/svg+xml";
  if (path.endsWith(".png"))  return "image/png";
  return "application/octet-stream";
}

/**
 * Serve a profile's logo image (`profiles/<name>/<iconImage>`) as raw bytes.
 * Read-only and path-traversal-safe: the profile name is restricted to a
 * single dir segment, the iconImage must be a bare filename, and the resolved
 * path must stay inside the profiles dir. 404 when the profile has no logo.
 */
export async function serveProfileIcon(rawName: string | null): Promise<Response> {
  if (!rawName) return new Response("missing profile", { status: 400 });
  // Composite selectors (a+b) → use the first part's logo.
  const name = rawName.split("+")[0]!.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) {
    return new Response("bad profile", { status: 400 });
  }
  let iconImage: string | undefined;
  try {
    iconImage = (await loadProfile(name)).iconImage;
  } catch {
    return new Response("not found", { status: 404 });
  }
  if (!iconImage || iconImage.includes("/") || iconImage.includes("\\") || iconImage.includes("..")) {
    return new Response("no icon", { status: 404 });
  }
  const dir = mergeProfilesDir();
  const file = resolve(join(dir, name, iconImage));
  if (!file.startsWith(resolve(dir))) return new Response("forbidden", { status: 403 });
  try {
    const st = await statAsync(file);
    if (!st.isFile()) return new Response("not found", { status: 404 });
    return new Response(await readFile(file), {
      headers: { "Content-Type": contentTypeFor(file), "Cache-Control": "max-age=3600" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

/**
 * Serve a plugin's logo image as raw bytes. Two sources, tried in order:
 *   1. Reuse — a cue profile sharing the plugin's bare name that ships its own
 *      logo (the `resend` / `vercel` / `stripe` plugins map straight onto
 *      profiles/<name>/<iconImage>).
 *   2. Generated — a PNG under the plugin-logos dir keyed by the plugin name.
 * Path-traversal-safe exactly like serveProfileIcon. 404 when neither exists.
 */
export async function servePluginIcon(rawId: string | null): Promise<Response> {
  if (!rawId) return new Response("missing plugin", { status: 400 });
  // Plugin ids are "name@marketplace" — the logo keys off the bare name.
  const name = rawId.split("@")[0]!.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) {
    return new Response("bad plugin", { status: 400 });
  }

  // 1. Reuse a same-named profile's logo when it ships one.
  try {
    const iconImage = (await loadProfile(name)).iconImage;
    if (iconImage && !iconImage.includes("/") && !iconImage.includes("\\") && !iconImage.includes("..")) {
      const pdir = mergeProfilesDir();
      const pfile = resolve(join(pdir, name, iconImage));
      if (pfile.startsWith(resolve(pdir))) {
        try {
          const st = await statAsync(pfile);
          if (st.isFile()) {
            return new Response(await readFile(pfile), {
              headers: { "Content-Type": contentTypeFor(pfile), "Cache-Control": "max-age=3600" },
            });
          }
        } catch { /* fall through to generated art */ }
      }
    }
  } catch {
    // No same-named profile — fall through to generated art.
  }

  // 2. Generated logo under the plugin-logos dir.
  const gdir = pluginLogosDir();
  const gfile = resolve(join(gdir, name + ".png"));
  if (!gfile.startsWith(resolve(gdir))) return new Response("forbidden", { status: 403 });
  try {
    const st = await statAsync(gfile);
    if (st.isFile()) {
      return new Response(await readFile(gfile), {
        headers: { "Content-Type": "image/png", "Cache-Control": "max-age=3600" },
      });
    }
  } catch { /* not found */ }
  return new Response("not found", { status: 404 });
}
