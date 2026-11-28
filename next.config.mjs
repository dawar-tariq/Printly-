import { isolatedTestDeploymentAllowed } from './src/lib/isolated-test-environment.mjs';

// Next can prerender pages during the build, before middleware has a chance to
// run. Refuse an unsafe dedicated test deployment before it contacts a backend.
if (!isolatedTestDeploymentAllowed(process.env)) {
  throw new Error('The isolated native test deployment is not configured safely.');
}

// Next requires inline bootstrapping scripts and inline styles. The policy still
// restricts their sources, blocks plugins and cross-origin framing, and keeps
// signed file URLs and tracking links out of referrers. Development omits CSP
// and frame restrictions so local tooling and embedded previews continue to work.
const production = process.env.NODE_ENV === 'production';
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' https://www.dropbox.com",
  "style-src 'self' 'unsafe-inline'",
  // The admin preview accepts only public images in this repository; pin the
  // CSP to the same repository prefix rather than allowing all GitHub images.
  "img-src 'self' data: blob: https://*.supabase.co https://*.dropbox.com https://*.dropboxusercontent.com https://raw.githubusercontent.com/dawar-tariq/Printly-/",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.dropbox.com https://*.dropboxapi.com https://*.dropboxusercontent.com",
  "frame-src 'self' blob: https://www.dropbox.com https://*.dropbox.com",
  "worker-src 'self' blob:",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ...(process.env.PRINTLY_ISOLATED_TEST === '1' ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] : []),
        ...(production ? [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ] : []),
      ],
    }, {
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'private, no-store' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    }, {
      source: '/track/:path*',
      headers: [{ key: 'Cache-Control', value: 'private, no-store' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    }, {
      source: '/support/:path*',
      headers: [{ key: 'Cache-Control', value: 'private, no-store' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    }, {
      source: '/admin/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    }, {
      source: '/s/:slug/order/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    }];
  },
  images: { remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }] },
  // The standee renderer loads local font files at runtime in the serverless function.
  outputFileTracingIncludes: { '/api/shop/standee': ['./src/assets/standee-fonts/*.ttf'] },
  serverExternalPackages: ['@resvg/resvg-js', 'pdfkit', 'svg-to-pdfkit', 'fontkit', 'bidi-js'],
  experimental: {},
};
export default nextConfig;
