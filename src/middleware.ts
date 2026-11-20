import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { portalDestination, type Portal } from '@/lib/portal-auth';

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const path = req.nextUrl.pathname.replace(/\/+$/, '') || '/';
  const isEntry = path === '/' || path === '/login' || path === '/shop/signup' || path === '/admin/login';

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );
  // getUser validates and refreshes the session; never trust an unverified cookie alone.
  const { data: { user } } = await supabase.auth.getUser();
  const redirectWithCookies = (destination: string) => {
    const redirect = NextResponse.redirect(new URL(destination, req.url));
    res.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (isEntry) {
    if (!user) return res;
    const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (error || !profile) return res;
    const portal: Portal = profile.role === 'admin' ? 'admin' : 'shop';
    if (path === '/admin/login' && portal !== 'admin') return res;
    // An unlinked shop account must still be able to access the application form.
    // Only redirect the public homepage for an owner/staff member of a real shop.
    if (path === '/' || path === '/shop/signup') {
      if (portal !== 'shop') return path === '/' ? res : redirectWithCookies('/admin');
      const { data: memberships, error: membershipError } = await supabase.from('shop_staff').select('shop_id').eq('user_id', user.id).limit(1);
      if (membershipError || !memberships?.length) return res;
    }
    return redirectWithCookies(portalDestination(portal, path === '/login' || path === '/admin/login' ? req.nextUrl.searchParams.get('next') : null));
  }

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = path === '/admin' || path.startsWith('/admin/') ? '/admin/login' : '/login';
    url.search = '';
    url.searchParams.set('next', `${path}${req.nextUrl.search}`);
    return redirectWithCookies(`${url.pathname}${url.search}`);
  }
  return res;
}

// Public customer order and tracking links remain accessible regardless of shop sign-in.
export const config = { matcher: ['/', '/login', '/shop/:path*', '/admin/:path*'] };
