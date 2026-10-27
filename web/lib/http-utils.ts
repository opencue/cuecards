/**
 * Shared HTTP utilities for Fetch-API-based request handlers in web/.
 */

/**
 * Read a `Request` body up to `maxBytes`, returning a `Buffer`.
 * Throws an error with `code: "BODY_TOO_LARGE"` when the limit is exceeded,
 * so callers can return a 413 response. Returns an empty Buffer when the
 * request has no body.
 */
export async function readLimitedBody(req: Request, maxBytes: number): Promise<Buffer> {
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        const err = new Error("Request body exceeds size limit");
        (err as NodeJS.ErrnoException).code = "BODY_TOO_LARGE";
        throw err;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}
