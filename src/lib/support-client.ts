export type SupportAccess = { id: string; secret: string };
export type SupportMessage = { id: string; sender: 'customer' | 'admin'; body: string; created_at: string };
export type SupportTicket = { id: string; subject: string; status: 'open' | 'answered' | 'closed'; message_count: number; created_at: string; updated_at: string };
export type SupportConversation = { ticket: SupportTicket; messages: SupportMessage[] };

/** Codes stay out of URLs and storage; the customer saves their own copy. */
export function newSupportAccess(): SupportAccess {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return { id: crypto.randomUUID(), secret: btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
}
export function supportCode(access: SupportAccess) { return `${access.id}.${access.secret}`; }
export function parseSupportCode(code: string): SupportAccess | null {
  const match = code.trim().match(/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i);
  return match ? { id: match[1], secret: match[2] } : null;
}
