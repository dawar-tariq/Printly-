'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CUSTOMER_CONTACT_KEY, forgetCustomerContact, normaliseCustomerContact, rememberedCustomerContact, saveCustomerContact, type CustomerContact } from './remembered-customer-contact';

type ContactStatus = 'saved' | 'incomplete' | 'unavailable' | 'cleared' | 'removeFailed' | 'changed' | 'pending' | null;

/** Optional, browser-local contact information; this never stores a checkout. */
export function useRememberedCustomerContact() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [remember, setRemember] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<ContactStatus>(null);
  const consent = useRef(false);
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    const saved = rememberedCustomerContact();
    if (saved) {
      setName(saved.name); setPhone(saved.phone); setEmail(saved.email);
      consent.current = true; setRemember(true); setHasSaved(true);
      lastSaved.current = JSON.stringify(saved); setStatus('saved');
    }
    setReady(true);

    // Do not silently re-save stale details after another tab clears or edits
    // them, and never overwrite an order the customer is currently editing.
    const changed = (event: StorageEvent) => {
      if (event.key !== CUSTOMER_CONTACT_KEY && event.key !== null) return;
      consent.current = false; setRemember(false); lastSaved.current = null;
      setHasSaved(!!rememberedCustomerContact()); setStatus('changed');
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  const persist = useCallback((contact: CustomerContact) => {
    if (!consent.current) return;
    if (lastSaved.current === JSON.stringify(contact)) { setStatus('saved'); return; }
    if (saveCustomerContact(contact)) {
      lastSaved.current = JSON.stringify(contact); setHasSaved(true); setStatus('saved');
    } else setStatus('unavailable');
  }, []);

  useEffect(() => {
    if (!ready || !remember) return;
    const contact = normaliseCustomerContact({ name, phone, email });
    if (!contact) { setStatus('incomplete'); return; }
    if (lastSaved.current === JSON.stringify(contact)) { setStatus('saved'); return; }
    setStatus('pending');
    const timer = window.setTimeout(() => persist(contact), 300);
    return () => window.clearTimeout(timer);
  }, [ready, remember, name, phone, email, persist]);

  const clear = useCallback(() => {
    consent.current = false; setRemember(false); lastSaved.current = null;
    if (forgetCustomerContact()) { setHasSaved(false); setStatus('cleared'); }
    else setStatus('removeFailed');
  }, []);
  const choose = useCallback((checked: boolean) => {
    if (!checked) { clear(); return; }
    consent.current = true; setRemember(true);
  }, [clear]);

  // Flush a pending edit before navigating away at checkout. Storage failure
  // must never prevent or repeat a payment.
  const saveNow = useCallback(() => {
    if (!consent.current) return;
    const contact = normaliseCustomerContact({ name, phone, email });
    if (contact) persist(contact); else setStatus('incomplete');
  }, [name, phone, email, persist]);

  return { name, setName, phone, setPhone, email, setEmail, remember, choose, hasSaved, clear, status, saveNow };
}
