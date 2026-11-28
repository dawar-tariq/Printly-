/** Public codes identify a shop independently of its display name. */
export function publicShopPath(code: string): string {
  return `/s/p-${encodeURIComponent(code.toLowerCase())}`;
}

export function codeFromPublicId(id: string): string | null {
  const match = /^p-([a-z0-9]{4,16})$/i.exec(id);
  return match ? match[1].toUpperCase() : null;
}

/** Used for feedback only; the database makes the final, locked name decision. */
export function normalizeShopName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeGstin(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** Format check, not proof of GST registration or ownership; an admin must review it. */
export function isGstinFormat(value: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalizeGstin(value));
}
