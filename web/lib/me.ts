/**
 * Shared `/api/v1/me` logic. Resolves the caller from either a session cookie
 * (browser) or an `Authorization: Bearer <api-key>` header (programmatic),
 * because the apiKey plugin is configured with `enableSessionForAPIKeys`.
 *
 * Returns a plain `{ status, body }` so both transports — the Bun dev server
 * (web `Headers`) and the Vercel Node function — can reuse it.
 */
import { auth } from "./auth.js";

export type MeResult = {
  status: number;
  body:
    | { ok: true; data: { id: string; email: string; name: string } }
    | { ok: false; error: string };
};

export async function getMe(headers: Headers): Promise<MeResult> {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  }
  const { id, email, name } = session.user;
  return { status: 200, body: { ok: true, data: { id, email, name } } };
}
