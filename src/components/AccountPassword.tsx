'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { createBrowserSupabase } from '@/lib/supabase-client';
import { authAttemptError, checkLoginAttempt } from '@/lib/login-attempt';
import { passwordPolicyError } from '@/lib/password-policy';

export function AccountPassword({ portal }: { portal: 'admin' | 'shop' }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    const policyError = passwordPolicyError(password);
    if (policyError || password !== confirm) {
      setMessage({ text: policyError ?? 'The new passwords do not match.', error: true });
      return;
    }
    setBusy(true);
    try {
      const supabase = createBrowserSupabase();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user?.email) throw new Error('Please sign in again.');
      await checkLoginAttempt(portal);
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
      if (verifyError) throw new Error(authAttemptError(verifyError, true));
      // Supplying the current password is also compatible with enabling
      // Supabase's server-side current-password requirement.
      const { error } = await supabase.auth.updateUser({ password, current_password: current });
      if (error) throw new Error(error.message);
      setCurrent(''); setPassword(''); setConfirm('');
      setMessage({ text: 'Password updated. Keep it private and store it safely.', error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Could not change the password.', error: true });
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={changePassword} className="card mt-5 p-5 space-y-3">
      <h2 className="font-extrabold flex items-center gap-2"><ShieldCheck size={18} />{portal === 'admin' ? 'Administrator password' : 'Shop account password'}</h2>
      <div><label className="label" htmlFor={`${portal}-current-password`}>Current password</label><input id={`${portal}-current-password`} className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
      <div><label className="label" htmlFor={`${portal}-new-password`}>New password (at least 12 characters)</label><input id={`${portal}-new-password`} className="input" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={password} onChange={(e) => setPassword(e.target.value)} /><p className="mt-1 text-xs text-neutral-500">Use a unique password of at most 72 UTF-8 bytes.</p></div>
      <div><label className="label" htmlFor={`${portal}-confirm-password`}>Confirm new password</label><input id={`${portal}-confirm-password`} className="input" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
      {message && <p role="status" className={message.error ? 'text-sm text-red-700' : 'text-sm text-green-700'}>{message.text}</p>}
      <button type="submit" disabled={busy} className="btn btn-dark h-11 px-5 text-sm">{busy ? <Loader2 size={16} className="animate-spin" /> : `Change ${portal === 'admin' ? 'admin' : 'shop'} password`}</button>
    </form>
  );
}
