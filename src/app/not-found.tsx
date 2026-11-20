import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-5 py-12 text-center">
      <div className="w-full max-w-md">
        <div className="flex justify-center"><Logo /></div>
        <div className="card mt-8 p-8 sm:p-10">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-orange-700">Page not found · 404</p>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">We couldn’t find that page.</h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-600">Please check the link or head back to Printly to get started.</p>
          <Link href="/" className="btn btn-dark mt-6 min-h-11 px-5 text-sm">Back to Printly</Link>
        </div>
      </div>
    </main>
  );
}
