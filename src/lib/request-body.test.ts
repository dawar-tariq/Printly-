import { describe, expect, it } from 'vitest';
import { MAX_JSON_BODY_BYTES, RequestBodyTooLarge, readBodyBytes, readJsonBody } from './request-body';

function streamedRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (i === chunks.length) controller.close();
    else controller.enqueue(chunks[i++]);
  } });
  return new Request('https://printly.test/api/orders', {
    method: 'POST', headers, body, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

describe('bounded request bodies', () => {
  it('parses valid JSON and rejects invalid or empty bodies', async () => {
    expect(await readJsonBody(new Request('https://printly.test', { method: 'POST', body: '{"ok":true}' }))).toEqual({ ok: true });
    expect(await readJsonBody(new Request('https://printly.test', { method: 'POST', body: '{' }))).toBeNull();
    expect(await readJsonBody(new Request('https://printly.test', { method: 'POST' }))).toBeNull();
  });
  it('accepts a genuinely empty optional body but not invalid or oversized bodies', async () => {
    expect(await readJsonBody(new Request('https://printly.test', { method: 'POST' }), { allowEmpty: true })).toEqual({});
    expect(await readJsonBody(new Request('https://printly.test', { method: 'POST', body: '{' }), { allowEmpty: true })).toBeNull();
    expect(await readJsonBody(streamedRequest([new Uint8Array(MAX_JSON_BODY_BYTES + 1)]), { allowEmpty: true })).toBeNull();
  });
  it('rejects a declared oversized body without reading it', async () => {
    const req = streamedRequest([new Uint8Array(2)], { 'content-length': String(MAX_JSON_BODY_BYTES + 1) });
    await expect(readBodyBytes(req, MAX_JSON_BODY_BYTES)).rejects.toBeInstanceOf(RequestBodyTooLarge);
  });
  it('enforces the byte limit for chunked or falsely declared bodies too', async () => {
    const chunks = [new Uint8Array(MAX_JSON_BODY_BYTES), new Uint8Array(1)];
    await expect(readBodyBytes(streamedRequest(chunks), MAX_JSON_BODY_BYTES)).rejects.toBeInstanceOf(RequestBodyTooLarge);
    await expect(readBodyBytes(streamedRequest(chunks, { 'content-length': '1' }), MAX_JSON_BODY_BYTES)).rejects.toBeInstanceOf(RequestBodyTooLarge);
    expect(await readJsonBody(streamedRequest(chunks))).toBeNull();
  });
  it('counts UTF-8 bytes rather than characters', async () => {
    const request = new Request('https://printly.test', { method: 'POST', body: JSON.stringify({ text: 'ह'.repeat(MAX_JSON_BODY_BYTES / 2) }) });
    expect(await readJsonBody(request)).toBeNull();
  });
});
