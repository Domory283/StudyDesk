// v1.12 Items 6b + 6c — the supporter badge and the Ko-fi alt-email field.
//
// These are two halves of one situation, which is why they live in one block:
// either the entitlement resolved and the user should see it, or it did not and
// the user needs the one self-serve tool that can fix it.
//
// **6c — the badge.** Trivial now the reader ships, and it is the whole visible
// payoff of the monetization chain. Before this, the founding supporter was
// correctly credited in the database and saw nothing in any app.
//
// **6b — the alt-email field.** The webhook logs `no account matches <redacted>
// — needs manual linking` when a supporter checks out with a different address
// than they signed up with. This field links that address to the account.
//
// **v1.18 (limecore#55): the address has to be proved.** The v1.12 field wrote
// it into user metadata, which anyone can do for any address, so whoever named
// a supporter's Ko-fi address first got their payment. Now the address lives
// in the server-owned `kofi_alt_emails` table and only counts once its holder
// types back the code we mail to it. Three stages, read from the server row so
// they survive a restart and show on every device: none → pending (code sent,
// enter it) → verified. The rules (tries, expiry, send limits) are the
// server's; lib/kofiAltEmail.js only reads the row and calls the function.
//
// Honest scope, carried over from the reader's own header: the perk is
// cosmetic in an open-source, client-only app. What this protects is the
// payment record, not the pixels.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isEntitled, entitlementTier, refreshEntitlement } from '../../lib/entitlement.js';
import { enterSubmit } from '../../lib/imeSubmit.js';
import {
  altEmailAction, altEmailStage, loadAltEmail, resendWait, statusMessage,
} from '../../lib/kofiAltEmail.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LEN = 6;

export default function SupporterBlock({ session, showFlash }) {
  const { t } = useTranslation();
  const [entitled, setEntitled] = useState(() => isEntitled());
  const [tier, setTier] = useState(() => entitlementTier());
  const [alt, setAlt] = useState(null); // the user's kofi_alt_emails row, or null
  const [emailInput, setEmailInput] = useState('');
  const [code, setCode] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // Ticks only while a resend countdown is running.
  const [now, setNow] = useState(() => Date.now());

  const uid = session?.user?.id;

  const sync = useCallback(async ({ force = false } = {}) => {
    if (!uid) { setEntitled(false); setTier(null); return; }
    await refreshEntitlement(uid, { force });
    setEntitled(isEntitled());
    setTier(entitlementTier());
  }, [uid]);

  const reload = useCallback(async () => {
    if (!uid) { setAlt(null); return null; }
    try {
      const row = await loadAltEmail(uid);
      setAlt(row);
      setNow(Date.now());
      return row;
    } catch {
      // Offline, or a server without the table yet: show the empty field
      // rather than an error; sending will say what went wrong.
      return null;
    }
  }, [uid]);

  useEffect(() => {
    let live = true;
    void sync();
    void reload().then((row) => {
      // Someone back from their inbox with a code lands on the code field.
      if (live && altEmailStage(row) === 'pending') setOpen(true);
    });
    return () => { live = false; };
  }, [session, sync, reload]);

  const wait = resendWait(alt, now);
  const cooling = wait > 0;
  useEffect(() => {
    if (!cooling) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooling]);

  if (!session) return null;

  async function run(action, args) {
    setBusy(true);
    try {
      const status = await altEmailAction(action, args);
      const key = statusMessage(status);
      if (key) showFlash(t(key));
      return status;
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(address) {
    const value = (address ?? emailInput).trim().toLowerCase();
    // A malformed address can never receive the code, so refuse it here
    // rather than spend one of the day's sends on it.
    if (!EMAIL_RE.test(value)) { showFlash(t('settings.kofiEmailInvalid')); return; }
    const status = await run('begin', { email: value });
    if (status === 'sent' || status === 'already_verified') {
      setCode('');
      setEmailInput('');
      setChanging(false);
    }
    await reload();
  }

  async function confirmCode() {
    if (code.length !== CODE_LEN) { showFlash(t('settings.kofiCodeWrong')); return; }
    const status = await run('confirm', { code });
    if (status === 'verified') {
      setCode('');
      await reload();
      // Force past the six-hour cache: a payment may already be waiting on
      // this address, and a stale "not entitled" would look like it failed.
      await sync({ force: true });
      showFlash(isEntitled() ? t('settings.kofiEmailMatched') : t('settings.kofiEmailVerified'));
    } else if (status !== 'wrong') {
      // locked, expired, taken, no_pending: the code is spent either way.
      setCode('');
      await reload();
    }
  }

  async function remove() {
    const status = await run('clear');
    if (status === 'cleared') {
      showFlash(t('settings.kofiEmailRemoved'));
      await reload();
    }
  }

  if (entitled) {
    return (
      <>
        <div className="sv2-supporter">
          <span className="sv2-supporter-mark" aria-hidden="true">✦</span>
          <div>
            <div className="sv2-supporter-title">{t('settings.supporterBadge')}</div>
            <div className="sv2-supporter-sub">
              {tier ? t('settings.supporterTier', { tier }) : t('settings.supporterThanks')}
            </div>
          </div>
        </div>
        <div className="sv2-note">{t('settings.supporterNote')}</div>
      </>
    );
  }

  const stage = changing ? 'none' : altEmailStage(alt);
  // A pending row whose code was spent (locked, expired, taken) has nothing
  // to type in; offer a new code instead.
  const codeLive = !!alt?.code_expires_at && Date.parse(alt.code_expires_at) > now;
  const resendLabel = cooling ? t('settings.kofiCodeResendIn', { s: wait }) : t('settings.kofiCodeResend');

  // Not entitled. Most users are not supporters and should not be nagged, so
  // this is a disclosure the user opens rather than a field sitting in their
  // face — it only matters to someone who has actually paid and is not seeing
  // it, and that person will go looking.
  return (
    <>
      {stage === 'verified' && (
        <div className="sv2-note">{t('settings.kofiEmailConfirmed', { email: alt.email })}</div>
      )}
      <button type="button" className="sv2-linkish" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {t('settings.kofiAlreadySupported')}
      </button>
      {open && (
        <div className="sv2-kofi-link">
          {stage === 'none' && (
            <>
              <div className="sv2-note" style={{ marginTop: 0 }}>{t('settings.kofiEmailWhy')}</div>
              <label className="sv2-field-label" htmlFor="sv2-kofi-email">
                {t('settings.kofiEmailLabel')}
              </label>
              <input
                id="sv2-kofi-email"
                className="sv2-time sv2-name-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                {...enterSubmit(() => { void sendCode(); })}
                placeholder={t('settings.kofiEmailPh')}
              />
              <div className="sv2-action">
                <button
                  className="btn-outline"
                  disabled={busy || cooling || !emailInput.trim()}
                  onClick={() => void sendCode()}
                >
                  {cooling ? resendLabel : t('settings.kofiEmailSendCode')}
                </button>
              </div>
              <div className="sv2-kofi-links">
                {changing ? (
                  <button type="button" className="sv2-linkish" disabled={busy} onClick={() => setChanging(false)}>
                    {t('common.cancel')}
                  </button>
                ) : (
                  <button type="button" className="sv2-linkish" disabled={busy} onClick={() => void sync({ force: true })}>
                    {t('settings.kofiRecheck')}
                  </button>
                )}
              </div>
            </>
          )}

          {stage === 'pending' && (
            <>
              <div className="sv2-note" style={{ marginTop: 0 }} role="status" aria-live="polite">
                {codeLive
                  ? t('settings.kofiCodeSentTo', { email: alt.email })
                  : t('settings.kofiCodeNone', { email: alt.email })}
              </div>
              {codeLive && (
                <>
                  <label className="sv2-field-label" htmlFor="sv2-kofi-code">
                    {t('settings.kofiCodeLabel')}
                  </label>
                  <input
                    id="sv2-kofi-code"
                    className="sv2-time sv2-code-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={'-'.repeat(CODE_LEN)}
                    value={code}
                    // No maxLength: pasting "123 456" from the mail would be cut
                    // to "123 45" before this strips the space. The slice caps it.
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LEN))}
                    {...enterSubmit(() => { void confirmCode(); })}
                  />
                </>
              )}
              {codeLive && (
                <div className="sv2-action">
                  <button className="btn-outline" disabled={busy} onClick={() => void confirmCode()}>
                    {t('settings.kofiCodeVerify')}
                  </button>
                </div>
              )}
              <div className="sv2-kofi-links">
                <button
                  type="button"
                  className="sv2-linkish"
                  disabled={busy || cooling}
                  onClick={() => void sendCode(alt.email)}
                >
                  {resendLabel}
                </button>
                <button
                  type="button"
                  className="sv2-linkish"
                  disabled={busy}
                  onClick={() => { setChanging(true); setCode(''); }}
                >
                  {t('settings.kofiEmailChange')}
                </button>
              </div>
            </>
          )}

          {stage === 'verified' && (
            <>
              <div className="sv2-note" style={{ marginTop: 0 }}>{t('settings.kofiEmailConfirmedNote')}</div>
              <div className="sv2-kofi-links">
                <button type="button" className="sv2-linkish" disabled={busy} onClick={() => void sync({ force: true })}>
                  {t('settings.kofiRecheck')}
                </button>
                <button type="button" className="sv2-linkish" disabled={busy} onClick={() => setChanging(true)}>
                  {t('settings.kofiEmailChange')}
                </button>
              </div>
              <div>
                <button type="button" className="sv2-inline-btn" disabled={busy} onClick={() => void remove()}>
                  {t('settings.kofiEmailRemove')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
