'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { loadDocument, renderDocumentPage, type LoadedDocument } from '@/lib/document-client';
import { EMPTY_EDIT, type PageEdit } from '@/lib/document-shared';

export function useLoadedDocument(url: string, mime: string) {
  const [doc, setDoc] = useState<LoadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let loaded: LoadedDocument | null = null;
    let cancelled = false;
    setDoc(null); setError(null); setLoading(true);
    loadDocument(url, mime, controller.signal).then((result) => {
      if (cancelled) { result.destroy(); return; }
      loaded = result;
      setDoc(result);
    }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not preview the file.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); loaded?.destroy(); };
  }, [url, mime]);
  return { doc, loading, error };
}

export function DocumentCanvas({ doc, page, edit = EMPTY_EDIT, crop = false }: { doc: LoadedDocument; page: number; edit?: PageEdit; crop?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    renderDocumentPage(doc, page, edit).then((canvas) => {
      if (cancelled || !container.current) return;
      canvas.className = 'block h-auto w-full bg-white';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Preview of page ${page}`);
      container.current.replaceChildren(canvas);
      setWidth(canvas.width);
    }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not render this page.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // Margins are an overlay only; changing them does not need a new render.
  }, [doc, page, edit.rotation]);

  const { left, right, top, bottom } = edit.margins;
  return (
    <div className="rounded-2xl bg-neutral-100 p-3 sm:p-5">
      {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
      {loading && <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-neutral-500" role="status"><Loader2 size={16} className="animate-spin" />Rendering page…</div>}
      <div className="relative mx-auto overflow-hidden bg-white shadow-sm" style={{ width: width ? `min(100%, ${width}px)` : '100%', display: loading || error ? 'none' : undefined }}>
        <div ref={container} />
        {crop && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-dashed border-orange-600" style={{ left: `${left}%`, right: `${right}%`, top: `${top}%`, bottom: `${bottom}%`, boxShadow: '0 0 0 9999px rgba(23, 23, 23, 0.58)' }} />}
      </div>
      {crop && <p className="mt-2 text-center text-xs text-neutral-600">The bright area is what will remain on this page.</p>}
    </div>
  );
}
