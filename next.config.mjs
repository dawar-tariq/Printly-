/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }] },
  // The standee renderer loads local font files at runtime in the serverless function.
  outputFileTracingIncludes: { '/api/shop/standee': ['./src/assets/standee-fonts/*.ttf'] },
  serverExternalPackages: ['@resvg/resvg-js', 'pdfkit', 'svg-to-pdfkit', 'fontkit', 'bidi-js'],
  experimental: {},
};
export default nextConfig;
