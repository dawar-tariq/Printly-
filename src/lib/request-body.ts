// Read request bodies with a real byte cap, including chunked requests without
// Content-Length. Platform limits are useful but must not be our only defence.
export const MAX_JSON_BODY_BYTES = 128 * 1024;

export class RequestBodyTooLarge extends Error {
  constructor() { super('Request body is too large.'); }
}

export async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new RequestBodyTooLarge();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyTooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Invalid and over-limit JSON is rejected by each route's schema. A truly
 * empty body can be treated as {} only for routes with an optional body. */
export async function readJsonBody(request: Request, { allowEmpty = false }: { allowEmpty?: boolean } = {}): Promise<unknown> {
  try {
    const bytes = await readBodyBytes(request, MAX_JSON_BODY_BYTES);
    if (allowEmpty && bytes.byteLength === 0) return {};
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return null; }
}
