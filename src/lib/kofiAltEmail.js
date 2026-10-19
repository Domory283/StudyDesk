// v1.18 (limecore#55) — the Ko-fi alternate email, proved by a code.
//
// A supporter whose Ko-fi checkout address differs from their login email
// links it in Settings > Support. The address only counts once its holder
// types back the code the `kofi-alt-email` Edge Function mails to it. The
// server owns everything that matters (the code, the tries, the send limits,
// one account per address); this file reads the user's own row and talks to
// the function.
//
// Replaces the v1.12 field that wrote `kofi_alt_email` into user metadata.
// Nothing reads that key any more, so an old build writing it does nothing.

import { supabase } from './supabase.js';

/** The seconds the server makes you wait between codes (kofi_alt_email_begin). */
export const RESEND_SECONDS = 60;

/**
 * @param {{ email?: string | null, verified_at?: string | null } | null} row
 * @returns {'none' | 'pending' | 'verified'}
 */
export function altEmailStage(row) {
  if (!row?.email) return 'none';
  return row.verified_at ? 'verified' : 'pending';
}

/** Whole seconds until another code may be sent, from the server's last send. */
export function resendWait(row, now = Date.now()) {
  const last = row?.last_sent_at ? Date.parse(row.last_sent_at) : NaN;
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, Math.ceil((last + RESEND_SECONDS * 1000 - now) / 1000));
}

// What the function answered → what the user is told. A status with no entry
// here is not an outcome the user acts on (sent, verified, cleared and
// already_verified are shown by the row itself after a reload).
const MESSAGES = {
  invalid_email: 'settings.kofiEmailInvalid',
  too_soon: 'settings.kofiCodeTooSoon',
  rate_limited: 'settings.kofiCodeLater',
  busy: 'settings.kofiCodeLater',
  send_failed: 'settings.kofiCodeSendFailed',
  wrong: 'settings.kofiCodeWrong',
  locked: 'settings.kofiCodeLocked',
  expired: 'settings.kofiCodeExpired',
  taken: 'settings.kofiEmailTaken',
  no_user: 'settings.kofiCodeFailed',
};

/** @returns {string | null} an i18n key, or null when the row says it all */
export function statusMessage(status) {
  if (['sent', 'verified', 'cleared', 'already_verified', 'no_pending'].includes(status)) return null;
  return MESSAGES[status] || 'settings.kofiCodeFailed';
}

/** The caller's own row, or null. RLS limits the read to it; the columns are
 *  the only ones the server grants. */
export async function loadAltEmail(uid) {
  const { data, error } = await supabase
    .from('kofi_alt_emails')
    .select('email, verified_at, code_expires_at, last_sent_at')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * @param {'begin' | 'confirm' | 'clear'} action
 * @param {{ email?: string, code?: string }} [args]
 * @returns {Promise<string>} the server's status, or 'error'
 */
export async function altEmailAction(action, args = {}) {
  const { data, error } = await supabase.functions.invoke('kofi-alt-email', {
    body: { action, ...args },
  });
  if (error || typeof data?.status !== 'string') return 'error';
  return data.status;
}
