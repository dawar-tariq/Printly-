'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { validNativeVersion } from '@/lib/owner-app-release';

const SLIDES = [
  { image: '/images/owner-onboarding-qr.webp', eyebrow: 'YOUR SHOP, CONNECTED', title: 'Get orders from anyone, anywhere.', body: 'Customers scan your QR, upload their files and choose their options. You stay in control.' },
  { image: '/images/owner-onboarding-printer.webp', eyebrow: 'LESS COUNTER CLUTTER', title: 'Manage everything in one place.', body: 'Follow orders, manage your inventory and keep your shop moving, right from your phone.' },
  { image: '/images/owner-onboarding-growth.webp', eyebrow: 'MADE FOR YOUR BUSINESS', title: 'Grow your print shop.', body: 'See useful reports, share your shop and spend more time doing what you do best.' },
] as const;
const COMPLETE = 'printly-owner-onboarding-v1';

export default function OwnerWelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    try {
      const version = validNativeVersion(new URLSearchParams(window.location.search).get('android_version'));
      if (version) window.localStorage.setItem('printly-owner-android-version', String(version));
      if (window.localStorage.getItem(COMPLETE) === 'done') { router.replace('/login?next=/shop'); return; }
    } catch { /* Onboarding still works if browser storage is blocked. */ }
    setChecking(false);
  }, [router]);

  const finish = () => {
    try { window.localStorage.setItem(COMPLETE, 'done'); } catch { /* The intro may appear again next time. */ }
    router.push('/login?next=/shop');
  };
  if (checking) return <div className="grid min-h-[100dvh] place-items-center bg-[#fff7ed]"><Logo /></div>;
  const slide = SLIDES[step];

  return <main className="min-h-[100dvh] bg-[#fff7ed] px-5 text-[#231a15] sm:px-8">
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex h-12 items-center justify-between"><Logo /><button type="button" onClick={finish} className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#765c4c] hover:bg-orange-100">Skip</button></header>
      <section className="flex flex-1 flex-col justify-center pb-5 pt-3 text-center" aria-live="polite">
        <div className="mx-auto w-full max-w-[330px] overflow-hidden rounded-[2.5rem] bg-[#fff4e5]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide.image} alt="" className="aspect-square w-full object-cover mix-blend-multiply" />
        </div>
        <p className="mt-5 text-[10px] font-extrabold tracking-[.18em] text-orange-700">{slide.eyebrow}</p>
        <h1 className="mx-auto mt-3 max-w-[19rem] text-[2rem] font-black leading-[1.1] tracking-[-.045em]">{slide.title}</h1>
        <p className="mx-auto mt-3 max-w-[19rem] text-sm leading-6 text-[#76665d]">{slide.body}</p>
        <div className="mt-6 flex justify-center gap-2" aria-label={`Introduction ${step + 1} of ${SLIDES.length}`}>
          {SLIDES.map((item, index) => <button key={item.eyebrow} type="button" onClick={() => setStep(index)} aria-label={`Show introduction ${index + 1}`} aria-current={step === index ? 'step' : undefined} className={`h-2 rounded-full transition-all ${step === index ? 'w-6 bg-orange-600' : 'w-2 bg-orange-200'}`} />)}
        </div>
      </section>
      <div className="flex items-center gap-2">{step > 0 && <button type="button" onClick={() => setStep(step - 1)} aria-label="Previous introduction" className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-orange-200 bg-white text-orange-800"><ArrowLeft size={20} /></button>}
        <button type="button" onClick={() => step === SLIDES.length - 1 ? finish() : setStep(step + 1)} className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#ff7811] to-[#e94c00] text-sm font-extrabold text-white shadow-[0_8px_20px_rgba(230,78,0,.18)]">{step === SLIDES.length - 1 ? 'Get started' : 'Next'}<ArrowRight size={18} /></button>
      </div>
      <p className="mt-4 text-center text-[11px] text-[#958478]">Built for the shops behind every good print.</p>
    </div>
  </main>;
}
