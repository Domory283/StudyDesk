import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('./supabase.js', () => ({ supabase: {} }));

const { altEmailStage, resendWait, statusMessage, RESEND_SECONDS } = await import('./kofiAltEmail.js');

describe('altEmailStage', () => {
  it('reads the row the server returns', () => {
    expect(altEmailStage(null)).toBe('none');
    expect(altEmailStage({ email: null, verified_at: null })).toBe('none');
    expect(altEmailStage({ email: 'a@b.co', verified_at: null })).toBe('pending');
    expect(altEmailStage({ email: 'a@b.co', verified_at: '2026-10-08T10:00:00Z' })).toBe('verified');
  });
});

describe('resendWait', () => {
  const at = Date.parse('2026-10-08T10:00:00Z');
  it('counts down from the last send', () => {
    expect(resendWait({ last_sent_at: '2026-10-08T10:00:00Z' }, at)).toBe(RESEND_SECONDS);
    expect(resendWait({ last_sent_at: '2026-10-08T10:00:00Z' }, at + 59_500)).toBe(1);
    expect(resendWait({ last_sent_at: '2026-10-08T10:00:00Z' }, at + 60_000)).toBe(0);
  });
  it('is zero with no send on record', () => {
    expect(resendWait(null, at)).toBe(0);
    expect(resendWait({ last_sent_at: null }, at)).toBe(0);
  });
});

describe('statusMessage', () => {
  it('says nothing when the row shows the outcome', () => {
    for (const s of ['sent', 'verified', 'cleared', 'already_verified', 'no_pending']) {
      expect(statusMessage(s)).toBeNull();
    }
  });
  it('names every refusal the server can give', () => {
    expect(statusMessage('wrong')).toBe('settings.kofiCodeWrong');
    expect(statusMessage('locked')).toBe('settings.kofiCodeLocked');
    expect(statusMessage('expired')).toBe('settings.kofiCodeExpired');
    expect(statusMessage('taken')).toBe('settings.kofiEmailTaken');
    expect(statusMessage('rate_limited')).toBe('settings.kofiCodeLater');
    expect(statusMessage('busy')).toBe('settings.kofiCodeLater');
  });
  it('falls back to a generic failure for anything unknown', () => {
    expect(statusMessage('error')).toBe('settings.kofiCodeFailed');
    expect(statusMessage('something_new')).toBe('settings.kofiCodeFailed');
  });
  // The keys are chosen at runtime, so the static t() scan in i18n/keys.test.js
  // cannot see them. Check them here, in every locale.
  it('every message it can return exists in all ten locales', () => {
    const statuses = ['invalid_email', 'too_soon', 'rate_limited', 'busy', 'send_failed', 'wrong',
      'locked', 'expired', 'taken', 'no_user', 'error'];
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../i18n/locales');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(10);
    for (const f of files) {
      const settings = JSON.parse(readFileSync(join(dir, f), 'utf8')).settings;
      for (const s of statuses) {
        const key = statusMessage(s).replace(/^settings\./, '');
        expect(typeof settings[key], `${f} ${key}`).toBe('string');
      }
    }
  });
});
