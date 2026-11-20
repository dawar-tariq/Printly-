'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RotateCw, RotateCcw, X } from 'lucide-react';
import { DocumentCanvas, useLoadedDocument } from '@/components/DocumentCanvas';
import { applyDocumentEdits } from '@/lib/document-client';
import { clampMargin, EMPTY_EDIT, hasPageEdit, type CropMargins, type PageEdit } from '@/lib/document-shared';

export function DocumentEditor({ url, mime, name, onClose, onSave }: { url: string; mime: string; name: string; onClose: () => void; onSave: (edited: Blob) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { doc, loading, error } = useLoadedDocument(url, mime);
  const [page, setPage] = useState(1);
  const [edits, setEdits] = useState<Record<number, PageEdit>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = edits[page] ?? EMPTY_EDIT;
  const dirty = Object.values(edits).some(hasPageEdit);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  const setCurrent = (edit: PageEdit) => setEdits((all) => ({ ...all, [page]: edit }));
  const save = async () => {
    if (!doc || !dirty || saving) return;
    setSaving(true); setSaveError(null);
    try {
      const output = await applyDocumentEdits(doc, edits, mime);
      await onSave(output);
      onClose();
    } catch (err) { setSaveError(err instanceof Error ? err.message : 'Could not save the edited file. Please try again.'); }
    finally { setSaving(false); }
  };
  const edges: Array<{ key: keyof CropMargins; label: string; opposite: keyof CropMargins }> = [
    { key: 'left', label: 'Left', opposite: 'right' }, { key: 'right', label: 'Right', opposite: 'left' },
    { key: 'top', label: 'Top', opposite: 'bottom' }, { key: 'bottom', label: 'Bottom', opposite: 'top' },
  ];
  return (
    <dialog ref={dialog} aria-labelledby="document-editor-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-3xl overflow-y-auto rounded-2xl bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-neutral-950/70 sm:max-h-[calc(100dvh-3rem)]">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="min-w-0"><h2 id="document-editor-title" className="font-extrabold">Preview &amp; edit</h2><p className="break-all text-xs text-neutral-500">{name}</p></div>
        <button type="button" disabled={saving} aria-label="Close preview" onClick={onClose} className="shrink-0 rounded-lg p-2 hover:bg-neutral-100"><X size={19} /></button>
      </header>
      <div className="space-y-4 p-4">
        {loading && <div role="status" className="flex min-h-40 items-center justify-center gap-2 text-sm text-neutral-500"><Loader2 className="animate-spin" size={18} />Loading your file…</div>}
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {doc && <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous page" disabled={page <= 1 || saving} onClick={() => setPage((p) => p - 1)} className="btn btn-ghost h-9 w-9 disabled:opacity-40"><ChevronLeft size={17} /></button>
              <label className="text-sm font-semibold">Page <input aria-label="Page number" type="number" min={1} max={doc.pageCount} value={page} disabled={saving} onChange={(event) => setPage(Math.max(1, Math.min(doc.pageCount, Number(event.target.value) || 1)))} className="input mx-1 inline-block h-9 w-16 px-2 text-center text-sm" /> of {doc.pageCount}</label>
              <button type="button" aria-label="Next page" disabled={page >= doc.pageCount || saving} onClick={() => setPage((p) => p + 1)} className="btn btn-ghost h-9 w-9 disabled:opacity-40"><ChevronRight size={17} /></button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saving} onClick={() => setCurrent({ rotation: ((current.rotation + 90) % 360) as PageEdit['rotation'], margins: { ...EMPTY_EDIT.margins } })} className="btn btn-ghost min-h-9 px-3 text-xs"><RotateCw size={15} />Rotate 90°</button>
              <button type="button" disabled={saving} onClick={() => setCurrent({ rotation: 0, margins: { ...EMPTY_EDIT.margins } })} className="btn btn-ghost min-h-9 px-3 text-xs"><RotateCcw size={15} />Reset this page</button>
            </div>
          </div>
          <DocumentCanvas doc={doc} page={page} edit={current} crop />
          <fieldset disabled={saving} className="rounded-2xl border border-neutral-200 p-3 sm:p-4">
            <legend className="px-1 text-sm font-bold">Crop this page</legend>
            <p className="mb-3 text-xs text-neutral-500">Move the edges inward. Rotate first; rotation resets the crop on this page.</p>
            <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
              {edges.map(({ key, label, opposite }) => <label key={key} className="block text-xs font-semibold text-neutral-700">
                <span className="flex justify-between"><span>{label}</span><span>{current.margins[key]}%</span></span>
                <input aria-label={`${label} crop`} type="range" min="0" max={95 - current.margins[opposite]} step="1" value={current.margins[key]}
                  onChange={(event) => setCurrent({ ...current, margins: clampMargin(current.margins, key, Number(event.target.value)) })} className="mt-1 w-full accent-orange-600" />
              </label>)}
            </div>
          </fieldset>
          <p className="text-xs leading-relaxed text-neutral-600">Edits apply only after saving and replace the file sent to the shop. {doc.kind === 'pdf' && 'PDF cropping hides the area outside the crop but does not securely remove it; do not use it to redact sensitive information.'}</p>
          {saveError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={saving} onClick={onClose} className="btn btn-ghost min-h-11 px-4 text-sm">{dirty ? 'Discard changes' : 'Close'}</button>
            <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="btn btn-primary min-h-11 px-4 text-sm">{saving ? <><Loader2 size={16} className="animate-spin" />Saving…</> : 'Save edited file'}</button>
          </div>
        </>}
      </div>
    </dialog>
  );
}
