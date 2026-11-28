export type Portal = 'shop' | 'admin';

/** Never send a signed-in user to an external URL or the other portal. */
export function portalDestination(portal: Portal, requested: string | null): string {
  const root = portal === 'admin' ? '/admin' : '/shop';
  if (!requested || requested.startsWith('//') || requested.includes('\\')) return root;
  try {
    const url = new URL(requested, 'https://printly.invalid');
    if (url.origin !== 'https://printly.invalid') return root;
    if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return root;
    if (url.pathname === '/admin/login' || url.pathname === '/shop/signup') return root;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return root;
  }
}
