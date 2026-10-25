// UAT-only rollout gates for Admin Google SSO. Both gates are build-controlled (env/uat.json -> env-config.js) and
// DEFAULT FALSE. They only decide which Google controls the browser exposes; they are NOT a security boundary.
// Firestore Rules, Functions and the PDF service keep enforcing UID, role and Google-subject binding on every request.
//
// Rollout states (Google Provider activation, account linking and subject approval remain separate Owner actions):
//   A  linking OFF / sign-in OFF   initial state: password-only UI
//   B  linking ON  / sign-in OFF   approved Admins may link their own Google account
//   C  linking ON  / sign-in ON    Google sign-in is offered
// Sign-in ON with linking OFF is invalid. Unknown, missing or malformed configuration resolves to state A.
export const GOOGLE_SSO_DISABLED_MESSAGES = Object.freeze({
  signIn: 'Google sign-in is not available yet. Please sign in with your password.',
  linking: 'Google account linking is not available yet.'
});

const CLOSED = Object.freeze({ state: 'A', googleLinkingEnabled: false, googleSignInEnabled: false, valid: true });
const INVALID = Object.freeze({ state: 'invalid', googleLinkingEnabled: false, googleSignInEnabled: false, valid: false });

export function resolveGoogleSsoGates(config) {
  if (config === undefined || config === null) return CLOSED;
  if (typeof config !== 'object' || Array.isArray(config)) return INVALID;
  const keys = Object.keys(config).sort();
  if (keys.length !== 2 || keys[0] !== 'googleLinkingEnabled' || keys[1] !== 'googleSignInEnabled') return INVALID;
  const { googleLinkingEnabled, googleSignInEnabled } = config;
  if (typeof googleLinkingEnabled !== 'boolean' || typeof googleSignInEnabled !== 'boolean') return INVALID;
  if (googleSignInEnabled && !googleLinkingEnabled) return INVALID;
  if (!googleLinkingEnabled) return CLOSED;
  return Object.freeze({ state: googleSignInEnabled ? 'C' : 'B', googleLinkingEnabled, googleSignInEnabled, valid: true });
}
