'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Copy, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { CustomerLanguagePicker } from '@/components/CustomerLanguagePicker';
import { useCustomerLanguage } from '@/lib/customer-language';
import { formatDateTime } from '@/lib/format';
import { newSupportAccess, parseSupportCode, supportCode, type SupportAccess, type SupportConversation } from '@/lib/support-client';

async function api(path: string, body: unknown) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message ?? 'Could not reach support. Please try again.');
  return result;
}

export default function SupportPage() {
  const { language, setLanguage, t } = useCustomerLanguage();
  const [mode, setMode] = useState<'new' | 'open'>('new');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [access, setAccess] = useState<SupportAccess | null>(null);
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const creation = useRef<{ access: SupportAccess; message_id: string; subject: string; message: string } | null>(null);
  const pendingReply = useRef<{ message: string; message_id: string } | null>(null);

  const load = async (credentials: SupportAccess) => {
    const result = await api('/api/support/conversation', { action: 'read', ...credentials });
    setAccess(credentials); setConversation(result as SupportConversation);
  };
  const create = async () => {
    if (busy) return;
    setError(''); setNotice('');
    if (!creation.current && (subject.trim().length < 3 || !message.trim())) { setError('Enter a subject and a message.'); return; }
    try {
      if (!creation.current) {
        creation.current = { access: newSupportAccess(), message_id: crypto.randomUUID(), subject: subject.trim(), message: message.trim() };
        // Show the code even if the network response is lost.
        setAccess(creation.current.access);
      }
      const current = creation.current;
      setBusy(true);
      await api('/api/support', { ...current.access, message_id: current.message_id, subject: current.subject, message: current.message });
      setNotice('Request sent. Save your private code and return here to check for a reply.');
      try { await load(current.access); } catch { setNotice('Request sent. Save your code and use Refresh to check the conversation.'); }
    } catch (err) {
      setError(err instanceof Error ? `${err.message} If sending was interrupted, keep your code and retry the same request.` : 'Could not send the request. Please retry.');
    } finally { setBusy(false); }
  };
  const open = async () => {
    if (busy) return;
    const credentials = parseSupportCode(codeInput);
    if (!credentials) { setError('Check the full private access code and try again.'); return; }
    setBusy(true); setError(''); setNotice('');
    try { await load(credentials); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not open the conversation.'); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    if (!access || busy) return;
    setBusy(true); setError('');
    try { await load(access); setNotice('Conversation refreshed.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not refresh the conversation.'); }
    finally { setBusy(false); }
  };
  const sendReply = async () => {
    if (!access || busy || !reply.trim()) return;
    const text = reply.trim();
    if (!pendingReply.current || pendingReply.current.message !== text) pendingReply.current = { message: text, message_id: crypto.randomUUID() };
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/api/support/conversation', { action: 'reply', ...access, ...pendingReply.current });
      pendingReply.current = null; setReply('');
      try { await load(access); setNotice('Reply sent.'); }
      catch { setNotice('Reply sent. Refresh to see the conversation.'); }
    } catch (err) { setError(err instanceof Error ? `${err.message} Retry the same message if the response was lost.` : 'Could not send the reply.'); }
    finally { setBusy(false); }
  };
  const startOver = () => {
    if (access && !window.confirm('Have you saved your private code? You will need it to read this conversation again.')) return;
    creation.current = null; pendingReply.current = null; setAccess(null); setConversation(null); setCodeInput(''); setSubject(''); setMessage(''); setReply(''); setError(''); setNotice(''); setMode('new');
  };

  return <div lang={language} dir={language === 'ur' ? 'rtl' : 'ltr'} className="min-h-screen bg-neutral-50">
    <header className="mx-auto flex h-16 max-w-2xl items-center justify-between gap-3 px-4"><Logo /><div className="flex items-center gap-3"><CustomerLanguagePicker language={language} onChange={setLanguage} /><Link href="/contact" className="text-sm font-bold text-orange-800 underline">Help</Link></div></header>
    <main className="mx-auto max-w-2xl px-4 pb-16">
      {language !== 'en' && <p className="mb-3 text-xs text-neutral-600">{t.limitedTranslation}</p>}
      <div className="mb-5"><h1 className="flex items-center gap-2 text-2xl font-extrabold"><MessageCircle size={23} />{t.supportTitle}</h1><p className="mt-2 text-sm leading-relaxed text-neutral-600">{t.supportIntro}</p></div>
      {access && <section className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4" aria-labelledby="support-code-title">
        <h2 id="support-code-title" className="font-extrabold text-amber-950">{t.saveCode}</h2>
        <p className="mt-1 text-xs leading-relaxed text-amber-900">{t.codeWarning}</p>
        <textarea aria-label={t.yourCode} dir="ltr" readOnly value={supportCode(access)} onFocus={(event) => event.currentTarget.select()} rows={3} className="input mt-3 w-full break-all font-mono text-xs" />
        <button type="button" className="btn btn-ghost mt-2 min-h-10 px-3 text-xs" onClick={() => void navigator.clipboard?.writeText(supportCode(access)).then(() => setNotice('Code copied. Store it somewhere private.')).catch(() => setNotice('Select and copy the code above.'))}><Copy size={14} />{t.copyCode}</button>
      </section>}
      {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">{notice}</div>}
      {conversation ? <section className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="break-words text-lg font-extrabold">{conversation.ticket.subject}</h2><p className="mt-1 text-xs text-neutral-500">{conversation.ticket.status === 'answered' ? t.supportReplied : conversation.ticket.status === 'closed' ? t.supportClosed : t.supportWaiting} · {conversation.ticket.message_count}/100 messages</p></div><button type="button" onClick={() => void refresh()} disabled={busy} className="btn btn-ghost min-h-10 px-3 text-xs"><RefreshCw size={14} />{t.refresh}</button></div>
        <ol className="mt-4 space-y-3" aria-label="Support messages">{conversation.messages.map((item) => <li key={item.id} className={item.sender === 'admin' ? 'rounded-xl bg-orange-50 p-3' : 'rounded-xl bg-neutral-100 p-3'}><div className="flex flex-wrap justify-between gap-2 text-xs font-bold"><span>{item.sender === 'admin' ? 'Printly support' : 'You'}</span><time className="font-normal text-neutral-500">{formatDateTime(item.created_at)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.body}</p></li>)}</ol>
        <label className="label mt-5">{t.reply}<textarea value={reply} onChange={(event) => setReply(event.target.value)} disabled={busy} maxLength={3000} rows={4} className="input mt-1" placeholder="Write a message…" /></label>
        <button type="button" disabled={busy || !reply.trim() || conversation.ticket.message_count >= 100} onClick={() => void sendReply()} className="btn btn-primary mt-3 min-h-11 px-5 text-sm">{busy ? <Loader2 className="animate-spin" size={16} /> : t.sendReply}</button>
        {conversation.ticket.message_count >= 100 && <p className="mt-2 text-xs text-neutral-600">This conversation is full. Start a new request if you still need help.</p>}
        <button type="button" disabled={busy} onClick={startOver} className="ml-2 mt-3 text-xs font-bold text-neutral-600 underline">{t.startAnother}</button>
      </section> : <section className="card p-4 sm:p-5">
        {!access && <div className="mb-4 flex gap-2" role="group" aria-label="Support action"><button type="button" disabled={busy} aria-pressed={mode === 'new'} onClick={() => { setMode('new'); setError(''); }} className={`rounded-lg px-3 py-2 text-sm font-bold ${mode === 'new' ? 'bg-neutral-900 text-white' : 'bg-neutral-100'}`}>{t.newRequest}</button><button type="button" disabled={busy} aria-pressed={mode === 'open'} onClick={() => { setMode('open'); setError(''); }} className={`rounded-lg px-3 py-2 text-sm font-bold ${mode === 'open' ? 'bg-neutral-900 text-white' : 'bg-neutral-100'}`}>{t.openRequest}</button></div>}
        {mode === 'new' ? <>
          <h2 className="font-extrabold">{t.tellUs}</h2>
          <p className="mt-1 text-xs text-neutral-600">{t.supportHint}</p>
          <label className="label mt-4">{t.subject}<input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={!!creation.current || busy} minLength={3} maxLength={120} className="input mt-1" /></label>
          <label className="label mt-3">{t.message}<textarea value={message} onChange={(event) => setMessage(event.target.value)} disabled={!!creation.current || busy} maxLength={3000} rows={5} className="input mt-1" /></label>
          <button type="button" disabled={busy} onClick={() => void create()} className="btn btn-primary mt-4 min-h-11 px-5 text-sm">{busy ? <Loader2 className="animate-spin" size={16} /> : creation.current ? t.retryRequest : t.sendRequest}</button>
          {access && <><button type="button" disabled={busy} onClick={() => void refresh()} className="btn btn-ghost mt-4 min-h-11 px-4 text-sm">Open with this code</button><button type="button" disabled={busy} onClick={startOver} className="mt-3 block text-xs font-bold text-neutral-600 underline">Discard and start another request</button></>}
        </> : <>
          <h2 className="font-extrabold">Open your conversation</h2><p className="mt-1 text-xs text-neutral-600">{t.enterCode}</p>
          <label className="label mt-4">{t.privateCode}<textarea dir="ltr" value={codeInput} onChange={(event) => setCodeInput(event.target.value)} disabled={busy} autoComplete="off" rows={3} className="input mt-1 break-all font-mono text-xs" /></label>
          <button type="button" disabled={busy} onClick={() => void open()} className="btn btn-primary mt-4 min-h-11 px-5 text-sm">{busy ? <Loader2 className="animate-spin" size={16} /> : t.openConversation}</button>
        </>}
      </section>}
      <p className="mt-5 text-xs text-neutral-500">Support is handled by the Printly team in this portal. Do not share your private code with the shop or anyone you do not trust.</p>
    </main>
  </div>;
}
