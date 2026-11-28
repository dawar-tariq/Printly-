'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import { formatDateTime, timeAgo } from '@/lib/format';
import type { SupportConversation, SupportTicket } from '@/lib/support-client';

type Inbox = { tickets: SupportTicket[]; pagination: { page: number; pages: number; count: number } };
type Filter = 'open' | 'answered' | 'closed' | 'all';

export default function AdminSupportPage() {
  const [filter, setFilter] = useState<Filter>('open');
  const [page, setPage] = useState(1);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const pendingReply = useRef<{ message: string; message_id: string } | null>(null);
  useEffect(() => () => { detailSequence.current++; }, []);

  const loadInbox = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const res = await fetch(`/api/admin/support?status=${filter}&page=${page}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? 'Could not load support requests.');
      if (current === sequence.current) { setInbox(data); setError(''); }
    } catch (err) { if (current === sequence.current) setError(err instanceof Error ? err.message : 'Could not load support requests.'); }
  }, [filter, page]);
  useEffect(() => { if (!selected) void loadInbox(); return () => { sequence.current++; }; }, [loadInbox, selected]);

  const loadConversation = async (id: string, current: number) => {
    const res = await fetch(`/api/admin/support/${id}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message ?? 'Could not load this conversation.');
    // A late response for a previously selected ticket must never appear
    // under a different ticket, where a reply could go to the wrong person.
    if (current === detailSequence.current) setConversation(data);
  };
  const open = async (id: string) => {
    const current = ++detailSequence.current;
    setSelected(id); setConversation(null); setError(''); setNotice(''); setReply(''); pendingReply.current = null; setBusy(true);
    try { await loadConversation(id, current); } catch (err) { if (current === detailSequence.current) setError(err instanceof Error ? err.message : 'Could not load this conversation.'); }
    finally { if (current === detailSequence.current) setBusy(false); }
  };
  const refresh = async () => {
    if (!selected || busy) return;
    const current = detailSequence.current;
    setBusy(true); setError('');
    try { await loadConversation(selected, current); } catch (err) { if (current === detailSequence.current) setError(err instanceof Error ? err.message : 'Could not load this conversation.'); }
    finally { if (current === detailSequence.current) setBusy(false); }
  };
  const backToInbox = () => {
    detailSequence.current++; pendingReply.current = null;
    setSelected(null); setConversation(null); setReply(''); setError(''); setNotice(''); setBusy(false);
  };
  const act = async (action: 'reply' | 'close' | 'reopen') => {
    if (!selected || !conversation || busy) return;
    const current = detailSequence.current;
    let body: unknown;
    if (action === 'reply') {
      const text = reply.trim(); if (!text) return;
      if (!pendingReply.current || pendingReply.current.message !== text) pendingReply.current = { message: text, message_id: crypto.randomUUID() };
      body = { action, ...pendingReply.current };
    } else body = { action, expected_count: conversation.ticket.message_count };
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch(`/api/admin/support/${selected}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? 'Could not update this request.');
      if (current !== detailSequence.current) return;
      if (action === 'reply') { pendingReply.current = null; setReply(''); }
      setNotice(action === 'reply' ? 'Reply sent. The customer must return with their private code to read it.' : 'Status updated.');
      try { await loadConversation(selected, current); } catch { if (current === detailSequence.current) setNotice('Update saved. Refresh to see the latest conversation.'); }
    } catch (err) { if (current === detailSequence.current) setError(err instanceof Error ? `${err.message} Refresh before retrying if the result is uncertain.` : 'Could not update the request.'); }
    finally { if (current === detailSequence.current) setBusy(false); }
  };

  return <div className="pb-12">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="flex items-center gap-2 text-2xl font-extrabold"><MessageCircle size={22} />Support inbox</h1>{selected && <button type="button" onClick={backToInbox} className="btn btn-ghost min-h-10 px-3 text-sm"><ChevronLeft size={15} />Back to inbox</button>}</div>
    <p className="mt-2 text-sm text-neutral-600">Private in-app requests. Customers receive no email or push notification; they check replies using their access code.</p>
    {error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</div>}
    {selected ? <section className="card mt-4 p-4 sm:p-5">
      {!conversation ? <div className="py-8 text-center">{busy ? <Loader2 className="mx-auto animate-spin" /> : <button type="button" onClick={() => void refresh()} className="btn btn-dark min-h-10 px-4">Retry conversation</button>}</div> : <>
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="break-words text-lg font-extrabold">{conversation.ticket.subject}</h2><p className="mt-1 text-xs text-neutral-500">{conversation.ticket.status} · {conversation.ticket.message_count}/100 messages · request {conversation.ticket.id.slice(0, 8)}</p></div><button type="button" disabled={busy} onClick={() => void refresh()} className="btn btn-ghost min-h-10 px-3 text-xs"><RefreshCw size={14} />Refresh</button></div>
        <ol className="mt-4 space-y-3" aria-label="Support messages">{conversation.messages.map((item) => <li key={item.id} className={item.sender === 'admin' ? 'rounded-xl bg-indigo-50 p-3' : 'rounded-xl bg-neutral-100 p-3'}><div className="flex flex-wrap justify-between gap-2 text-xs font-bold"><span>{item.sender === 'admin' ? 'Printly support' : 'Customer'}</span><time className="font-normal text-neutral-500">{formatDateTime(item.created_at)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.body}</p></li>)}</ol>
        <label className="label mt-5">Reply<textarea value={reply} onChange={(event) => setReply(event.target.value)} disabled={busy} maxLength={3000} rows={5} className="input mt-1" placeholder="Write a helpful reply…" /></label>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || !reply.trim() || conversation.ticket.message_count >= 100} onClick={() => void act('reply')} className="btn btn-dark min-h-11 px-4 text-sm">{busy ? <Loader2 size={16} className="animate-spin" /> : 'Send reply'}</button><button type="button" disabled={busy} onClick={() => void act(conversation.ticket.status === 'closed' ? 'reopen' : 'close')} className="btn btn-ghost min-h-11 px-4 text-sm">{conversation.ticket.status === 'closed' ? 'Reopen' : 'Close request'}</button></div>
        {conversation.ticket.message_count >= 100 && <p className="mt-2 text-xs text-neutral-600">Message limit reached. Ask the customer to create another request.</p>}
      </>}
    </section> : <>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter support requests">{(['open', 'answered', 'closed', 'all'] as Filter[]).map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); setInbox(null); }} className={`rounded-lg px-3 py-2 text-sm font-bold capitalize ${filter === value ? 'bg-indigo-700 text-white' : 'bg-white text-neutral-700'}`}>{value === 'open' ? 'Needs reply' : value}</button>)}<button type="button" onClick={() => void loadInbox()} className="btn btn-ghost min-h-10 px-3 text-xs"><RefreshCw size={14} />Refresh</button></div>
      {!inbox ? <div className="grid place-items-center py-14">{!error && <Loader2 className="animate-spin text-indigo-600" />}</div> : <section className="card mt-3 overflow-hidden"><div className="border-b border-neutral-100 px-4 py-3 text-xs font-semibold text-neutral-500">{inbox.pagination.count} request(s)</div><ul className="divide-y divide-neutral-100">{inbox.tickets.map((ticket) => <li key={ticket.id}><button type="button" onClick={() => void open(ticket.id)} className="w-full p-4 text-left hover:bg-neutral-50"><span className="block break-words text-sm font-bold">{ticket.subject}</span><span className="mt-1 block text-xs text-neutral-500">{ticket.status} · {ticket.message_count} message(s) · updated {timeAgo(ticket.updated_at)}</span></button></li>)}{!inbox.tickets.length && <li className="p-6 text-sm text-neutral-500">No requests on this page.</li>}</ul><div className="flex items-center justify-end gap-2 border-t border-neutral-100 p-3 text-xs"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn btn-ghost min-h-9 px-2">Previous</button><span>Page {inbox.pagination.page} of {inbox.pagination.pages}</span><button type="button" disabled={page >= inbox.pagination.pages} onClick={() => setPage(page + 1)} className="btn btn-ghost min-h-9 px-2">Next</button></div></section>}
    </>}
  </div>;
}
