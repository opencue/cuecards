type RuntimeEnv = Record<string, string | undefined>;

/** Resolve the public auth origin without baking a preview deployment URL into source. */
export function resolveAuthBaseUrl(env: RuntimeEnv = process.env): string {
  const configured = env.BETTER_AUTH_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const vercelHost = env.VERCEL_URL?.trim();
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  return "http://localhost:3000";
}
