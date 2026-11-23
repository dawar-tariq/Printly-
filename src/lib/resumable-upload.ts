import { Upload, defaultOptions } from 'tus-js-client';
import { SUPABASE_ANON, SUPABASE_URL } from '@/lib/supabase-client';

/** Supabase's hosted direct-storage hostname avoids proxying large file chunks. */
export function resumableEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.storage.supabase.co')) {
    url.hostname = `${url.hostname.slice(0, -'.supabase.co'.length)}.storage.supabase.co`;
  }
  url.pathname = '/storage/v1/upload/resumable/sign';
  url.search = ''; url.hash = '';
  return url.toString();
}

export interface ResumableTransfer {
  start: () => Promise<void>;
  abort: () => Promise<void>;
}

class ResumeResponseError extends Error {
  constructor(readonly status: number) { super('The resumable upload could not be checked.'); }
}

/**
 * The signed token and resumable URL stay in memory. A retry of this object
 * resumes the same upload; closing/reloading the page deliberately does not
 * persist file credentials or file bytes on the device.
 */
export function createResumableTransfer({ file, mime, path, token, onProgress }: {
  file: File; mime: string; path: string; token: string; onProgress: (sent: number, total: number) => void;
}): ResumableTransfer {
  let rejectActive: ((reason?: unknown) => void) | null = null;
  let active = false;
  let stopped = false;
  const upload = new Upload(file, {
    endpoint: resumableEndpoint(SUPABASE_URL),
    headers: { apikey: SUPABASE_ANON, 'x-signature': token },
    metadata: { bucketName: 'order-files', objectName: path, contentType: mime },
    chunkSize: 6 * 1024 * 1024,
    uploadDataDuringCreation: true,
    retryDelays: [0, 1_000, 3_000, 8_000, 15_000],
    storeFingerprintForResuming: false,
    // tus initialises its file asynchronously. Do not send a request if the
    // operator cancelled before that initialisation completed.
    onBeforeRequest: () => { if (stopped) throw new Error('Upload cancelled'); },
    // tus-js-client normally creates a new upload after any failed HEAD. A
    // failed/expired resume must not silently restart against the same signed
    // path; preserve the known URL and let the customer retry or remove it.
    onAfterResponse: (request, response) => {
      const status = response.getStatus();
      if (request.getMethod() === 'HEAD' && status !== 423 && (status < 200 || status >= 300)) throw new ResumeResponseError(status);
    },
    onShouldRetry: (error, attempt, options) => {
      if (stopped) return false;
      if (error.causingError instanceof ResumeResponseError && error.causingError.status < 500) return false;
      return defaultOptions.onShouldRetry?.(error, attempt, options) ?? false;
    },
    onProgress: (sent, total) => { if (!stopped) onProgress(sent, total); },
  });
  return {
    start: () => {
      if (active) return Promise.reject(new Error('Upload already running'));
      stopped = false; active = true;
      return new Promise<void>((resolve, reject) => {
        rejectActive = reject;
        upload.options.onSuccess = () => { active = false; rejectActive = null; resolve(); };
        upload.options.onError = () => { active = false; rejectActive = null; reject(new Error('Upload interrupted. Reconnect and resume, or remove and add the file again if the upload expired.')); };
        upload.start();
      });
    },
    abort: async () => {
      stopped = true;
      if (rejectActive) rejectActive(new Error('Upload cancelled.'));
      rejectActive = null; active = false;
      await upload.abort();
    },
  };
}
