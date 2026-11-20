'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { createBrowserSupabase } from '@/lib/supabase-client';

export function AdminPassword() {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (password.length < 12 || password !== confirm) {
      setMessage({ text: password.length < 12 ? 'Use at least 12 characters.' : 'The new passwords do not match.', error: true });
      return;
    }
    setBusy(true);
    try {
      const supabase = createBrowserSupabase();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user?.email) throw new Error('Please sign in again.');
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
      if (verifyError) throw new Error('Current password is incorrect.');
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      setCurrent(''); setPassword(''); setConfirm('');
      setMessage({ text: 'Password updated. Keep it private and store it safely.', error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Could not change the password.', error: true });
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={changePassword} className="card mt-5 p-5 space-y-3">
      <h2 className="font-extrabold flex items-center gap-2"><ShieldCheck size={18} />Administrator password</h2>
      <p className="text-xs text-amber-900 bg-amber-50 rounded-xl p-3">The original demo password was publicly visible. Change it before using Printly with real shop data.</p>
      <div><label className="label" htmlFor="current-admin-password">Current password</label><input id="current-admin-password" className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
      <div><label className="label" htmlFor="new-admin-password">New password (at least 12 characters)</label><input id="new-admin-password" className="input" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <div><label className="label" htmlFor="confirm-admin-password">Confirm new password</label><input id="confirm-admin-password" className="input" type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
      {message && <p role="status" className={message.error ? 'text-sm text-red-700' : 'text-sm text-green-700'}>{message.text}</p>}
      <button type="submit" disabled={busy} className="btn btn-dark h-11 px-5 text-sm">{busy ? <Loader2 size={16} className="animate-spin" /> : 'Change admin password'}</button>
    </form>
  );
}
