import { normalizeRecipient } from "@/lib/meta/client";

/** Exactly one Graph /messages destination; BSUID is never a phone number. */
export type MessageAddress =
  | { to: string; recipient?: never }
  | { recipient: string; to?: never };

/**
 * Meta: /documentation/business-messaging/whatsapp/business-scoped-user-ids/
 * Prefer BSUID and omit `to` (Meta gives `to` precedence if both are sent).
 * Authentication templates require a phone number. Preserve opaque BSUIDs
 * verbatim, including the country prefix and any parent-portfolio segment.
 */
export function resolveMessageAddress(
  contact: { phone?: string | null; waUserId?: string | null },
  options: { requiresPhoneNumber?: boolean } = {}
): MessageAddress | null {
  if (contact.waUserId && !options.requiresPhoneNumber) {
    return { recipient: contact.waUserId };
  }
  // Strip phone formatting only, never arbitrary letters/BSUID prefixes.
  const phone = contact.phone?.replace(/[+\s().-]/g, "");
  if (!phone || !/^\d+$/.test(phone)) return null;
  return { to: normalizeRecipient(phone) };
}
