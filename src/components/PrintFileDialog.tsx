'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Loader2, Printer, X } from 'lucide-react';
import { DocumentCanvas, useLoadedDocument } from '@/components/DocumentCanvas';
import { MAX_RASTER_PRINT_PAGES, printDocument, suggestedOrientation, type PrintOrientation } from '@/lib/document-print';
import { SERVICE_LABEL } from '@/lib/constants';
import { duplexSheets, duplexSheetsPerCopy } from '@/lib/duplex';

export interface FilePrintSpec {
  id: string; file_id: string | null; service: string; paper_size: string | null; color: string | null; sides: string | null;
  paper_gsm: number | null; option: string | null; copies: number; pages: number;
}

export function PrintFileDialog({ url, mime, name, specs, onClose, onChecked }: { url: string; mime: string; name: string; specs: FilePrintSpec[]; onClose: () => void; onChecked: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { doc, loading, error } = useLoadedDocument(url, mime);
  const [page, setPage] = useState(1);
  const [orientation, setOrientation] = useState<PrintOrientation>('portrait');
  const [checked, setChecked] = useState({ paper: false, colour: false, sides: false, copies: false });
  const [preparing, setPreparing] = useState(false);
  const [printAction, setPrintAction] = useState<'dialog' | 'viewer' | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [nativeUrl, setNativeUrl] = useState<string | null>(null);
  const printSpec = specs.find((item) => item.service === 'print' || item.service === 'photocopy') ?? specs[0];
  const reviewed = Object.values(checked).every(Boolean);
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
      await printDocument(doc, printSpec?.paper_size ?? 'A4', orientation, printSpec?.sides === 'duplex' ? 'duplex' : 'single');
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
          {printSpec?.sides === 'duplex' && (printSpec.service === 'print' || printSpec.service === 'photocopy') && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
            <p className="font-bold">Double-sided: {duplexSheetsPerCopy(printSpec.pages)} sheet(s) per copy, {duplexSheets(printSpec.pages, printSpec.copies)} total.</p>
            <p className="mt-1">Print the whole file in order: pages 1/2, 3/4 and so on. Leave an odd last page’s reverse blank. Start each file and each copy on a fresh sheet; print one copy per job if the printer cannot guarantee this.</p>
            <p className="mt-1">In the printer dialog, select two-sided printing and one page per side, then check the flip edge and the physical output. Printly cannot turn duplex on for your printer.</p>
            {doc && doc.pageCount % 2 !== 0 && doc.pageCount <= MAX_RASTER_PRINT_PAGES && <p className="mt-1">The Printly-prepared print adds a blank final page; check that your printer keeps it. The browser PDF viewer and downloaded files are unchanged.</p>}
          </div>}
          {doc && printSpec && (printSpec.service === 'print' || printSpec.service === 'photocopy') && doc.pageCount !== printSpec.pages && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">The preview has {doc.pageCount} pages, but the order was priced for {printSpec.pages}. Contact the customer before printing.</p>}
          <p className="text-xs leading-relaxed text-neutral-600">Choose the printer and confirm paper, colour, sides and copies in the device’s print dialog. Printly cannot set every printer option or tell whether paper was printed.</p>
          {doc && <label className="block text-xs font-bold text-neutral-700">Page orientation
            <select value={orientation} onChange={(event) => setOrientation(event.target.value as PrintOrientation)} disabled={preparing} className="input mt-1 h-10 text-sm"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
          </label>}
          <fieldset className="space-y-2 rounded-xl border border-neutral-200 p-3 text-xs leading-relaxed text-neutral-700">
            <legend className="px-1 font-extrabold text-neutral-900">Before printing: check each setting</legend>
            {([
              ['paper', `Paper size and stock: ${printSpec?.paper_size ?? 'check the order'}${printSpec?.paper_gsm ? `, ${printSpec.paper_gsm} gsm` : ''}.`],
              ['colour', `Colour: ${printSpec?.color === 'color' ? 'colour' : printSpec?.color === 'bw' ? 'black and white' : 'check the order'}.`],
              ['sides', `Sides and flip edge: ${printSpec?.sides === 'duplex' ? 'double-sided; one page per side' : printSpec?.sides === 'single' ? 'single-sided' : 'check the order'}.`],
              ['copies', `Pages, orientation and copies: ${printSpec ? `${printSpec.pages} page(s), ${printSpec.copies} cop${printSpec.copies === 1 ? 'y' : 'ies'}` : 'check the order'}.`],
            ] as const).map(([key, label]) => <label key={key} className="flex items-start gap-2"><input type="checkbox" checked={checked[key]} onChange={(event) => setChecked((previous) => ({ ...previous, [key]: event.target.checked }))} className="mt-0.5 accent-orange-600" /><span>{label}</span></label>)}
            <p className="pt-1 text-[11px] text-neutral-500">Ticking these is a reminder to set them in the printer dialog; it does not change the printer or prove that paper was printed.</p>
          </fieldset>
          {doc && doc.pageCount > MAX_RASTER_PRINT_PAGES ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">For PDFs over {MAX_RASTER_PRINT_PAGES} pages, use the browser PDF viewer below to avoid exhausting this device’s memory. Its print command and support depend on your browser.</p> :
            <button type="button" onClick={() => void print()} disabled={!doc || !reviewed || preparing} className="btn btn-primary min-h-11 w-full px-4 text-sm">{preparing ? <><Loader2 size={16} className="animate-spin" />Preparing all pages…</> : <><Printer size={16} />Open print dialog</>}</button>}
          {doc?.kind === 'pdf' && nativeUrl && (reviewed
            ? <a href={nativeUrl} target="_blank" rel="noopener noreferrer" onClick={() => setPrintAction('viewer')} className="inline-flex items-center gap-1 text-xs font-bold text-orange-800 underline">Open PDF in browser viewer <ExternalLink size={13} /></a>
            : <p className="text-xs text-neutral-500">Check all print-settings reminders above to open the PDF viewer.</p>)}
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
