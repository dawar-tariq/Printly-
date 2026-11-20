'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Loader2, Printer, X } from 'lucide-react';
import { DocumentCanvas, useLoadedDocument } from '@/components/DocumentCanvas';
import { MAX_RASTER_PRINT_PAGES, printDocument, suggestedOrientation, type PrintOrientation } from '@/lib/document-print';
import { SERVICE_LABEL } from '@/lib/constants';

export interface FilePrintSpec {
  id: string; file_id: string | null; service: string; paper_size: string | null; color: string | null; sides: string | null;
  paper_gsm: number | null; option: string | null; copies: number; pages: number;
}

export function PrintFileDialog({ url, mime, name, specs, onClose, onChecked }: { url: string; mime: string; name: string; specs: FilePrintSpec[]; onClose: () => void; onChecked: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { doc, loading, error } = useLoadedDocument(url, mime);
  const [page, setPage] = useState(1);
  const [orientation, setOrientation] = useState<PrintOrientation>('portrait');
  const [reviewed, setReviewed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [printAction, setPrintAction] = useState<'dialog' | 'viewer' | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [nativeUrl, setNativeUrl] = useState<string | null>(null);
  const printSpec = specs.find((item) => item.service === 'print' || item.service === 'photocopy') ?? specs[0];
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  useEffect(() => {
    if (!doc) return;
    let active = true;
    void suggestedOrientation(doc).then((value) => { if (active) setOrientation(value); }).catch(() => {});
    const url = URL.createObjectURL(doc.blob);
    setNativeUrl(url);
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [doc]);
  const print = async () => {
    if (!doc || !reviewed || preparing) return;
    setPreparing(true); setPrintError(null);
    try {
      await printDocument(doc, printSpec?.paper_size ?? 'A4', orientation);
      // Opening a dialog does not prove that anything was actually printed.
      setPrintAction('dialog');
    } catch (err) { setPrintError(err instanceof Error ? err.message : 'Could not open print preview.'); }
    finally { setPreparing(false); }
  };
  return (
    <dialog ref={dialog} aria-labelledby="print-file-title" onCancel={(event) => { event.preventDefault(); if (!preparing) onClose(); }}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-4xl overflow-y-auto rounded-2xl bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-neutral-950/70 sm:max-h-[calc(100dvh-3rem)]">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="min-w-0"><h2 id="print-file-title" className="font-extrabold">Preview &amp; print file</h2><p className="break-all text-xs text-neutral-500">{name}</p></div>
        <button type="button" disabled={preparing} aria-label="Close print preview" onClick={onClose} className="shrink-0 rounded-lg p-2 hover:bg-neutral-100"><X size={19} /></button>
      </header>
      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <section className="min-w-0" aria-label="Document preview">
          {loading && <div role="status" className="flex min-h-40 items-center justify-center gap-2 text-sm text-neutral-500"><Loader2 className="animate-spin" size={18} />Loading file…</div>}
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {doc && <>
            <div className="mb-2 flex items-center justify-center gap-2">
              <button type="button" aria-label="Previous page" disabled={page <= 1 || preparing} onClick={() => setPage((p) => p - 1)} className="btn btn-ghost h-9 w-9 disabled:opacity-40"><ChevronLeft size={17} /></button>
              <span className="text-xs font-bold">Page {page} of {doc.pageCount}</span>
              <button type="button" aria-label="Next page" disabled={page >= doc.pageCount || preparing} onClick={() => setPage((p) => p + 1)} className="btn btn-ghost h-9 w-9 disabled:opacity-40"><ChevronRight size={17} /></button>
            </div>
            <DocumentCanvas doc={doc} page={page} />
          </>}
        </section>
        <section className="min-w-0 space-y-3" aria-labelledby="requested-settings">
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <h3 id="requested-settings" className="text-sm font-extrabold">Customer’s request</h3>
            {specs.length ? <ul className="mt-2 space-y-2 text-sm">
              {specs.map((item) => <li key={item.id} className="break-words">
                <strong>{SERVICE_LABEL[item.service] ?? item.service}{item.option ? ` · ${item.option}` : ''}</strong>
                {item.service !== 'bind' && <span className="block text-xs leading-relaxed text-neutral-700">{[item.paper_size, item.color === 'color' ? 'Colour' : item.color === 'bw' ? 'Black & white' : null, item.sides === 'duplex' ? 'Double-sided' : item.sides === 'single' ? 'Single-sided' : null, item.paper_gsm ? `${item.paper_gsm} gsm` : null].filter(Boolean).join(' · ')}</span>}
                <span className="block text-xs text-neutral-700">{item.service === 'bind' ? `${item.copies} set(s)` : `${item.pages} page(s) × ${item.copies} cop${item.copies === 1 ? 'y' : 'ies'}`}</span>
              </li>)}
            </ul> : <p className="mt-2 text-xs text-amber-900">No settings are linked to this file. Check the order’s print specification before printing.</p>}
          </div>
          <p className="text-xs leading-relaxed text-neutral-600">Choose the printer and confirm paper, colour, sides and copies in the device’s print dialog. Printly cannot set every printer option or tell whether paper was printed.</p>
          {doc && <label className="block text-xs font-bold text-neutral-700">Page orientation
            <select value={orientation} onChange={(event) => setOrientation(event.target.value as PrintOrientation)} disabled={preparing} className="input mt-1 h-10 text-sm"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
          </label>}
          <label className="flex items-start gap-2 text-xs leading-relaxed text-neutral-700"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} className="mt-0.5 accent-orange-600" />I will check the customer’s settings in the print dialog.</label>
          {doc && doc.pageCount > MAX_RASTER_PRINT_PAGES ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">For PDFs over {MAX_RASTER_PRINT_PAGES} pages, use the browser PDF viewer below to avoid exhausting this device’s memory. Its print command and support depend on your browser.</p> :
            <button type="button" onClick={() => void print()} disabled={!doc || !reviewed || preparing} className="btn btn-primary min-h-11 w-full px-4 text-sm">{preparing ? <><Loader2 size={16} className="animate-spin" />Preparing all pages…</> : <><Printer size={16} />Open print dialog</>}</button>}
          {doc?.kind === 'pdf' && nativeUrl && (reviewed
            ? <a href={nativeUrl} target="_blank" rel="noopener noreferrer" onClick={() => setPrintAction('viewer')} className="inline-flex items-center gap-1 text-xs font-bold text-orange-800 underline">Open PDF in browser viewer <ExternalLink size={13} /></a>
            : <p className="text-xs text-neutral-500">Check the print-settings box above to open the PDF viewer.</p>)}
          {doc?.kind === 'pdf' && doc.pageCount <= MAX_RASTER_PRINT_PAGES && <p className="text-[11px] leading-relaxed text-neutral-500">This print dialog prepares PDF pages at up to 144 dpi. For very fine details, use the browser PDF viewer or download the file.</p>}
          {printError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{printError}</p>}
          {printAction && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs leading-relaxed text-green-900">
            <p>{printAction === 'dialog' ? 'Print was requested; the dialog may have been blocked or cancelled.' : 'The PDF viewer was opened; use its print command if available.'} Inspect the paper before marking the order ready.</p>
            <button type="button" onClick={() => { onChecked(); onClose(); }} className="mt-2 inline-flex items-center gap-1 font-bold underline"><CheckCircle2 size={14} />I checked the physical print</button>
            <p className="mt-1 text-[11px]">This check is shown only during this visit; it does not change the order status.</p>
          </div>}
        </section>
      </div>
    </dialog>
  );
}
