import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { QrCode, UploadCloud, Banknote, CheckCircle2, Store, ShieldCheck, Zap, FileText, ArrowRight, Star } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-2 sm:gap-4 text-sm font-medium">
          <Link href="/s/demo-prints" className="hidden sm:inline text-neutral-600 hover:text-neutral-900">Try demo shop</Link>
          <Link href="/shop/signup" className="hidden sm:inline text-neutral-600 hover:text-neutral-900">For shop owners</Link>
          <Link href="/login" className="btn btn-dark px-4 h-9 text-sm">Shop login</Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-14 grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <div className="chip bg-orange-100 text-orange-800 mb-4"><Zap size={13} /> No app download · Works on any phone</div>
          <h1 className="text-4xl sm:text-5xl xl:text-6xl font-extrabold leading-[1.08] tracking-tight">
            Print anything.<br />
            <span className="text-orange-600">Skip the queue.</span>
          </h1>
          <p className="mt-5 text-lg text-neutral-600 max-w-md">
            Scan the shop&apos;s QR, upload your document, pay with UPI, and collect on your phone&apos;s turn. From Lal Chowk to your campus.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/s/demo-prints" className="btn btn-primary h-12 px-6 text-base">
              Try the demo flow <ArrowRight size={18} />
            </Link>
            <Link href="/shop/signup" className="btn btn-ghost h-12 px-6 text-base">
              <Store size={18} /> Get your shop on Printly
            </Link>
          </div>
          <div className="mt-6 flex items-center gap-4 text-sm text-neutral-500">
            <span className="flex items-center gap-1.5"><Star size={15} className="fill-amber-400 text-amber-400" /> 4.6 (128 ratings)</span>
            <span className="flex items-center gap-1.5"><ShieldCheck size={15} /> Files deleted after 30 days</span>
          </div>
        </div>

        {/* Hero card — mini QR flow */}
        <div className="relative">
          <div className="card p-6 max-w-sm mx-auto rotate-[-1deg] shadow-xl">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Demo Prints — Lal Chowk</div>
              <span className="chip bg-green-100 text-green-800">Open now</span>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <div className="w-28 h-28 rounded-xl border-2 border-dashed border-orange-300 grid place-items-center bg-orange-50">
                <QrCode size={72} strokeWidth={1.4} className="text-orange-700" />
              </div>
              <div className="text-sm text-neutral-600">
                <div className="font-bold text-neutral-900 mb-1">Scan to order</div>
                Aisha&apos;s turn: <span className="font-mono font-bold">A-001</span> printing now · ~15 min wait
              </div>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              {['12 pages · B&W · Spiral bind', 'Total ₹92 · UPI paid ✓'].map((t) => (
                <div key={t} className="flex items-center gap-2 bg-neutral-50 rounded-lg px-3 py-2"><CheckCircle2 size={16} className="text-green-600" />{t}</div>
              ))}
            </div>
          </div>
          <div className="absolute -bottom-4 right-2 sm:right-10 card px-4 py-2 text-xs font-semibold shadow-lg rotate-[2deg]">
            <span className="text-orange-700">A-003</span> ready — collect at counter
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-neutral-950 text-neutral-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Three steps. Zero small talk at the counter.</h2>
          <div className="mt-8 grid sm:grid-cols-3 gap-6">
            {[
              { icon: QrCode, step: '1', title: 'Scan the shop QR', body: 'On the window, at the counter, or on the receipt. Opens instantly in your browser.' },
              { icon: UploadCloud, step: '2', title: 'Upload & choose options', body: 'PDF, DOC or images. Copies, colour, paper size, binding. Instant price with GST — no surprises.' },
              { icon: Banknote, step: '3', title: 'Pay & collect', body: 'Pay the shop directly via UPI (or cash). Get a token like A-023. We ping you when it’s ready.' },
            ].map(({ icon: Icon, step, title, body }) => (
              <div key={step} className="rounded-2xl bg-neutral-900 border border-neutral-800 p-6">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-orange-600 grid place-items-center"><Icon size={20} /></span>
                  <span className="text-xs font-mono text-neutral-500">STEP {step}</span>
                </div>
                <h3 className="mt-4 font-bold text-lg">{title}</h3>
                <p className="mt-1.5 text-sm text-neutral-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For shops */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid lg:grid-cols-2 gap-10 items-center">
        <div className="card overflow-hidden">
          <div className="bg-orange-600 text-white px-6 py-3 flex items-center justify-between">
            <span className="font-bold text-sm">Shop dashboard — today</span>
            <span className="chip bg-white/20 text-white">4 orders in queue</span>
          </div>
          <div className="p-5 grid grid-cols-3 gap-3 text-center text-sm">
            {[['New', '1', 'bg-blue-50 text-blue-900'], ['Printing', '1', 'bg-amber-50 text-amber-900'], ['Ready', '1', 'bg-green-50 text-green-900']].map(([lane, n, cls]) => (
              <div key={lane} className={`rounded-xl border p-4 ${cls}`}>
                <div className="text-2xl font-extrabold">{n}</div>
                <div className="text-xs font-semibold mt-0.5 opacity-80">{lane}</div>
              </div>
            ))}
          </div>
          <div className="px-5 pb-5 flex flex-wrap gap-2 text-[11px] text-neutral-500">
            <span className="chip bg-neutral-100">Live queue board</span>
            <span className="chip bg-neutral-100">UPI payment confirm</span>
            <span className="chip bg-neutral-100">Rate card sync</span>
            <span className="chip bg-neutral-100">Daily reports</span>
            <span className="chip bg-neutral-100">Inventory alerts</span>
          </div>
        </div>
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">Run your shop like magic.</h2>
          <p className="mt-3 text-neutral-600">No hardware, no new apps to learn. Orders land in one queue, customers pay you directly on UPI (₹0 fees), and you get the file, the token and the spec — all in one screen.</p>
          <ul className="mt-5 space-y-2.5 text-[15px]">
            {['Zero commission on offline/cash sales', 'Your own UPI QR — money comes straight to your account', 'File arrives before the customer does', 'Works on any phone or the shop PC'].map((t) => (
              <li key={t} className="flex items-start gap-2"><CheckCircle2 size={18} className="text-green-600 mt-0.5 shrink-0" />{t}</li>
            ))}
          </ul>
          <Link href="/shop/signup" className="mt-6 btn btn-dark h-12 px-6 inline-flex">List your shop — free <ArrowRight size={18} /></Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between text-sm text-neutral-500">
          <Logo href="/" />
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline">Made for Indian print shops</span>
            <Link href="/login">Shop / Admin login</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
