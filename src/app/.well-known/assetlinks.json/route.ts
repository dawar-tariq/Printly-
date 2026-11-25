import { NextResponse } from 'next/server';

const PACKAGE = 'io.github.dawartariq.printly.owner';
export const dynamic = 'force-dynamic';

/** Publish only fingerprints deliberately configured by the release operator. */
export async function GET() {
  const raw = process.env.PRINTLY_ANDROID_SIGNING_SHA256?.trim() ?? '';
  const fingerprints = raw.split(',').map((part) => part.trim().toUpperCase());
  if (!raw || fingerprints.some((value) => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))) {
    return NextResponse.json([], { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: PACKAGE, sha256_cert_fingerprints: fingerprints } }], {
    headers: { 'Cache-Control': 'public, max-age=300', 'Content-Type': 'application/json' },
  });
}
