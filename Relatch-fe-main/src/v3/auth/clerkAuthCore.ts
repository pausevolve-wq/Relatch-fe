// The V3 sign-up sheet's calls (AuthApi) on Clerk's signal-based custom-flow API (@clerk/react v6:
// useSignUp() / useSignIn()). Written 2026-11-15 for the V3 port (vault "Relatch V3 Port Plan - Phase 3").
//
// Pure on purpose: no React and no Clerk import, so every mapping below is unit-tested with fakes
// (scripts/auth-tests/clerk-adapter.test.mjs). clerkAuth.ts feeds it the real objects; the narrow types
// here are checked against Clerk's own types there, so a wrong method name fails the type check.
//
// Clerk docs read 2026-11-15 (custom-flows/authentication/email-password and device-trust):
//   sign-up   : signUp.password({ emailAddress, password, legalAccepted }) -> verifications.sendEmailCode()
//               -> verifications.verifyEmailCode({ code }) -> status 'complete' -> finalize()
//   sign-in   : signIn.password({ emailAddress, password }); 'needs_client_trust' (a new device, Device Trust
//               is on in production) -> signIn.mfa.sendEmailCode() -> signIn.mfa.verifyEmailCode({ code })
//   code login: signIn.emailCode.sendCode({ emailAddress }) -> signIn.emailCode.verifyCode({ code })
//   SSO       : signUp.sso / signIn.sso({ strategy, redirectUrl, redirectCallbackUrl }); legalAccepted on
//               signUp.sso only. The return is handled by SsoCallback.tsx.
// UNVERIFIED until the live test on production (step 3.4): where API error codes sit on the returned error
// (read from both .errors[0].code and .code below), and whether signUp.password() reuses the sign-up that the
// live email check started with create() (it works either way: password() always gets the address).
import type { AuthApi, Provider } from './AuthSheet';
import type { EmailRefusal, EmailVerdict, Outcome } from './emailCode';

type Result = Promise<{ error: unknown }>;
export type SignUpLike = {
  readonly status: string | null;
  readonly missingFields: readonly string[];
  create: (p: { emailAddress: string }) => Result;
  update: (p: { emailAddress?: string; legalAccepted?: boolean }) => Result;
  password: (p: { emailAddress: string; password: string; legalAccepted?: boolean }) => Result;
  sso: (p: { strategy: `oauth_${Provider}`; redirectUrl: string; redirectCallbackUrl: string; legalAccepted?: boolean }) => Result;
  finalize: () => Result;
  verifications: { sendEmailCode: () => Result; verifyEmailCode: (p: { code: string }) => Result };
};
export type SignInLike = {
  readonly status: string | null;
  readonly supportedSecondFactors: readonly { strategy: string }[] | null;
  password: (p: { emailAddress: string; password: string }) => Result;
  sso: (p: { strategy: `oauth_${Provider}`; redirectUrl: string; redirectCallbackUrl: string }) => Result;
  finalize: () => Result;
  emailCode: { sendCode: (p: { emailAddress: string }) => Result; verifyCode: (p: { code: string }) => Result };
  mfa: { sendEmailCode: () => Result; verifyEmailCode: (p: { code: string }) => Result };
};

/** The first API error's code and message, wherever Clerk put them (a ClerkAPIResponseError carries .errors[]) */
export function readError(error: unknown): { code: string; message: string } | null {
  if (!error) return null;
  const e = error as { code?: string; message?: string; errors?: { code?: string; message?: string; longMessage?: string }[] };
  const first = Array.isArray(e.errors) ? e.errors[0] : undefined;
  return { code: first?.code || e.code || 'unknown', message: first?.longMessage || first?.message || e.message || '' };
}

// Clerk error code -> what the sheet shows. Codes from Clerk's localization keys; the sheet's own wording.
const EMAIL_REFUSALS: Record<string, EmailRefusal> = {
  form_email_address_blocked: 'temporary',
  not_allowed_access: 'blocked',
  form_param_format_invalid: 'invalid',
};
const REFUSED: Record<EmailRefusal, string> = {
  invalid: "That email doesn't look right.",
  temporary: "Use an email you'll keep, not a temporary one.",
  blocked: "That email can't be used to sign up. Try another one.",
};
const PASSWORD_PROBLEMS: Record<string, string> = {
  form_password_pwned: 'That password has shown up in a data breach. Choose a different one.',
  form_password_length_too_short: 'Use at least 8 characters.',
  form_password_not_strong_enough: 'Choose a stronger password.',
  form_password_validation_failed: 'Choose a stronger password.',
};
const WRONG_LOGIN = "That email and password don't match.";
const WRONG_CODE = "That code isn't right. Check the email and try again.";
const GENERIC = 'Something went wrong. Try again.';

type Flow = { pending: 'signup' | 'login-code' | 'client-trust' | null; completed: 'signUp' | 'signIn' | null; checked: boolean };

export function createClerkAuth(get: () => { signUp: SignUpLike; signIn: SignInLike }, urls: { appUrl: string; callbackUrl: string }): AuthApi {
  const flow: Flow = { pending: null, completed: null, checked: false };

  const signInDone = (): Outcome => {
    const { signIn } = get();
    if (signIn.status === 'complete') { flow.completed = 'signIn'; flow.pending = null; return; }
    return { error: GENERIC };
  };

  return {
    async checkEmail(email): Promise<EmailVerdict> {
      const { signUp } = get();
      // create() once (it would end any sign-up already in progress), update() after that: one captcha at most
      const r = flow.checked ? await signUp.update({ emailAddress: email }) : await signUp.create({ emailAddress: email });
      flow.checked = true;
      const err = readError(r.error);
      if (!err) return 'ok';
      if (err.code === 'form_identifier_exists') return 'ok'; // Continue moves them to log-in
      return EMAIL_REFUSALS[err.code] ?? null;
    },

    async startSignUp({ email, password, legalAccepted }): Promise<Outcome> {
      const { signUp } = get();
      const err = readError((await signUp.password({ emailAddress: email, password, legalAccepted })).error);
      if (err) {
        if (err.code === 'form_identifier_exists') return { exists: true };
        if (PASSWORD_PROBLEMS[err.code]) return { error: PASSWORD_PROBLEMS[err.code], on: 'password' };
        const refused = EMAIL_REFUSALS[err.code];
        if (refused) return { error: REFUSED[refused], on: 'email', refused };
        return { error: err.message || GENERIC };
      }
      const sent = readError((await signUp.verifications.sendEmailCode()).error);
      if (sent) return { error: sent.message || GENERIC };
      flow.pending = 'signup';
    },

    async sendCode(email, purpose): Promise<Outcome> {
      const { signUp, signIn } = get();
      if (purpose === 'signup') {
        const err = readError((await signUp.verifications.sendEmailCode()).error);
        return err ? { error: err.message || GENERIC } : undefined;
      }
      if (flow.pending === 'client-trust') {
        const err = readError((await signIn.mfa.sendEmailCode()).error);
        return err ? { error: err.message || GENERIC } : undefined;
      }
      const err = readError((await signIn.emailCode.sendCode({ emailAddress: email })).error);
      if (err) return { error: err.code === 'form_identifier_not_found' ? 'No account uses that email.' : err.message || GENERIC };
      flow.pending = 'login-code';
    },

    async verifyCode(_email, code, purpose): Promise<Outcome> {
      const { signUp, signIn } = get();
      if (purpose === 'signup') {
        const err = readError((await signUp.verifications.verifyEmailCode({ code })).error);
        if (err) return { error: err.code.startsWith('form_code') || err.code === 'verification_failed' ? WRONG_CODE : err.message || GENERIC };
        if (signUp.status === 'complete') { flow.completed = 'signUp'; flow.pending = null; return; }
        // The sheet always sends consent with the password, so a missing field here is unexpected: say so
        return { error: signUp.missingFields.includes('legal_accepted') ? 'Tick the box to agree to the Terms and Privacy Policy first.' : GENERIC };
      }
      const r = flow.pending === 'client-trust' ? await signIn.mfa.verifyEmailCode({ code }) : await signIn.emailCode.verifyCode({ code });
      const err = readError(r.error);
      if (err) return { error: err.code.startsWith('form_code') || err.code === 'verification_failed' ? WRONG_CODE : err.message || GENERIC };
      return signInDone();
    },

    async logIn({ email, password }): Promise<Outcome> {
      const { signIn } = get();
      const err = readError((await signIn.password({ emailAddress: email, password })).error);
      if (err) {
        // Never say which half was wrong: that would tell anyone whether an address has an account
        if (err.code === 'form_password_incorrect' || err.code === 'form_identifier_not_found') return { error: WRONG_LOGIN };
        return { error: err.message || GENERIC };
      }
      if (signIn.status === 'complete') { flow.completed = 'signIn'; return; }
      // A new device (Device Trust) or an email second factor: a code goes to their inbox, the sheet asks for it
      const emailFactor = signIn.supportedSecondFactors?.some((f) => f.strategy === 'email_code');
      if ((signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') && emailFactor) {
        flow.pending = 'client-trust';
        return { needsCode: true };
      }
      return { error: "This account needs a sign-in step Relatch can't show yet. Use \"Email me a code\" instead." };
    },

    async oauth(provider, { legalAccepted }): Promise<Outcome> {
      const { signUp, signIn } = get();
      const params = { strategy: `oauth_${provider}` as const, redirectUrl: urls.appUrl, redirectCallbackUrl: urls.callbackUrl };
      // Consent ticked (the sign-up screen): a sign-up that already carries it. Otherwise a sign-in; a new person
      // is transferred to a sign-up without consent, and SsoCallback asks for it before the account is made.
      const r = legalAccepted ? await signUp.sso({ ...params, legalAccepted: true }) : await signIn.sso(params);
      const err = readError(r.error);
      return err ? { error: err.message || "We couldn't reach the sign-in. Try again." } : undefined;
    },

    activate() {
      const { signUp, signIn } = get();
      const which = flow.completed;
      flow.completed = null;
      if (which === 'signUp') void signUp.finalize();
      else if (which === 'signIn') void signIn.finalize();
    },
  };
}
