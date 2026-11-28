// Supabase stores password hashes with bcrypt, which accepts at most 72 UTF-8
// bytes. Count Unicode characters separately so multi-byte input is not silently
// truncated. Existing passwords can still be used to sign in.
export function passwordPolicyError(password: string): string | null {
  if (Array.from(password).length < 12) return 'Use at least 12 characters.';
  if (new TextEncoder().encode(password).byteLength > 72) return 'Use at most 72 UTF-8 bytes; some characters use more than one byte.';
  return null;
}
