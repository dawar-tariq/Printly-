import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({ base: '' }));
vi.mock('@/lib/supabase-client', () => ({ get SUPABASE_URL() { return settings.base; }, SUPABASE_ANON: 'public-key' }));
import { createResumableTransfer, resumableEndpoint } from './resumable-upload';

let server: Server | undefined;
afterEach(async () => { if (server) { server.closeAllConnections(); server.close(); await once(server, 'close'); server = undefined; } });

it('uses the signed direct-storage endpoint for hosted Supabase projects', () => {
  expect(resumableEndpoint('https://example.supabase.co')).toBe('https://example.storage.supabase.co/storage/v1/upload/resumable/sign');
  expect(resumableEndpoint('https://example.storage.supabase.co/')).toBe('https://example.storage.supabase.co/storage/v1/upload/resumable/sign');
  expect(resumableEndpoint('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321/storage/v1/upload/resumable/sign');
});

it('resumes the real tus client from the server offset after a failed chunk, without reissuing a signed link', async () => {
  const calls: Array<{ method: string; path: string; offset: string | undefined; apikey: string | undefined; signature: string | undefined }> = [];
  let chunks = Buffer.alloc(0);
  let failPatch = true;
  server = createServer(async (req, res) => {
    calls.push({ method: req.method ?? '', path: req.url ?? '', offset: req.headers['upload-offset'] as string | undefined, apikey: req.headers.apikey as string | undefined, signature: req.headers['x-signature'] as string | undefined });
    res.setHeader('Tus-Resumable', '1.0.0');
    if (req.method === 'POST') {
      for await (const chunk of req) chunks = Buffer.concat([chunks, Buffer.from(chunk)]);
      res.writeHead(201, { Location: '/uploads/resume-1', 'Upload-Offset': String(chunks.length) }); res.end(); return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Upload-Offset': String(chunks.length), 'Upload-Length': String(6 * 1024 * 1024 + 1024) }); res.end(); return;
    }
    if (req.method === 'PATCH') {
      if (failPatch) { failPatch = false; req.resume(); res.writeHead(403); res.end(); return; }
      for await (const chunk of req) chunks = Buffer.concat([chunks, Buffer.from(chunk)]);
      res.writeHead(204, { 'Upload-Offset': String(chunks.length) }); res.end(); return;
    }
    res.writeHead(405); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start the local test server');
  settings.base = `http://127.0.0.1:${address.port}`;
  const bytes = Buffer.alloc(6 * 1024 * 1024 + 1024, 0x5a);
  // The Node build of tus reads Buffers; the browser build reads File/Blob.
  const file = bytes as unknown as File;
  const progress: number[] = [];
  const upload = createResumableTransfer({ file, mime: 'application/pdf', path: 'shop/order/file.pdf', token: 'signed-token', onProgress: (sent) => progress.push(sent) });
  await expect(upload.start()).rejects.toThrow(/interrupted/i);
  expect(chunks.length).toBe(6 * 1024 * 1024);
  await upload.start();
  expect(chunks.equals(bytes)).toBe(true);
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  expect(calls.some((call) => call.method === 'HEAD' && call.path === '/uploads/resume-1')).toBe(true);
  expect(calls.filter((call) => call.method === 'PATCH').at(-1)?.offset).toBe(String(6 * 1024 * 1024));
  expect(calls.every((call) => call.apikey === 'public-key' && call.signature === 'signed-token')).toBe(true);
  expect(progress.at(-1)).toBe(bytes.length);
}, 30000);

it('does not silently create a second upload when the resume URL has expired', async () => {
  const calls: string[] = [];
  server = createServer(async (req, res) => {
    calls.push(req.method ?? '');
    res.setHeader('Tus-Resumable', '1.0.0');
    if (req.method === 'POST') { req.resume(); await once(req, 'end'); res.writeHead(201, { Location: '/uploads/expired', 'Upload-Offset': String(6 * 1024 * 1024) }); }
    else if (req.method === 'PATCH') { req.resume(); res.writeHead(403); }
    else if (req.method === 'HEAD') res.writeHead(410);
    else res.writeHead(405);
    res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start the local test server');
  settings.base = `http://127.0.0.1:${address.port}`;
  const file = Buffer.alloc(6 * 1024 * 1024 + 1) as unknown as File;
  const upload = createResumableTransfer({ file, mime: 'application/pdf', path: 'shop/order/expired.pdf', token: 'expired-token', onProgress: () => {} });
  await expect(upload.start()).rejects.toThrow(/interrupted/i);
  await expect(upload.start()).rejects.toThrow(/expired/i);
  await expect(upload.start()).rejects.toThrow(/expired/i);
  expect(calls.filter((method) => method === 'POST')).toHaveLength(1);
  expect(calls.filter((method) => method === 'HEAD')).toHaveLength(2);
}, 30000);

it('retries a transient failed resume check without restarting the upload', async () => {
  const calls: string[] = [];
  let offset = 0, failedPatch = false, failedHead = false;
  const size = 6 * 1024 * 1024 + 1;
  server = createServer(async (req, res) => {
    calls.push(req.method ?? '');
    res.setHeader('Tus-Resumable', '1.0.0');
    if (req.method === 'POST') {
      for await (const chunk of req) offset += Buffer.byteLength(chunk);
      res.writeHead(201, { Location: '/uploads/transient', 'Upload-Offset': String(offset) });
    } else if (req.method === 'HEAD') {
      if (!failedHead) { failedHead = true; res.writeHead(503); }
      else res.writeHead(200, { 'Upload-Offset': String(offset), 'Upload-Length': String(size) });
    } else if (req.method === 'PATCH') {
      if (!failedPatch) { failedPatch = true; req.resume(); res.writeHead(500); }
      else { for await (const chunk of req) offset += Buffer.byteLength(chunk); res.writeHead(204, { 'Upload-Offset': String(offset) }); }
    } else res.writeHead(405);
    res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start the local test server');
  settings.base = `http://127.0.0.1:${address.port}`;
  const upload = createResumableTransfer({ file: Buffer.alloc(size) as unknown as File, mime: 'application/pdf', path: 'shop/order/file.pdf', token: 'signed-token', onProgress: () => {} });
  await upload.start();
  expect(offset).toBe(size);
  expect(calls.filter((method) => method === 'POST')).toHaveLength(1);
  expect(calls.filter((method) => method === 'HEAD')).toHaveLength(2);
}, 30000);

it('does not send a request if cancelled while the client is still initializing', async () => {
  let requests = 0;
  server = createServer((_req, res) => { requests++; res.writeHead(500); res.end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start the local test server');
  settings.base = `http://127.0.0.1:${address.port}`;
  const upload = createResumableTransfer({ file: Buffer.from('data') as unknown as File, mime: 'application/pdf', path: 'shop/order/file.pdf', token: 'signed-token', onProgress: () => {} });
  const started = upload.start();
  const rejected = expect(started).rejects.toThrow(/cancelled/i);
  await upload.abort(); await rejected;
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(requests).toBe(0);
});
