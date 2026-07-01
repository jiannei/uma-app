// src/bubble/utils/sessionShortId.ts — derive a short display id from a
// permission request's sessionId. Used by the bubble header to anchor the
// card visually across multiple pending requests (Q3 in the design spec).
//
// We intentionally only return the prefix; the session tag is purely
// informational and never needs to round-trip back to the agent. If a
// future requirement needs the full sessionId, callers can still reach
// the original via `request.sessionId`.

const SHORT_ID_LENGTH = 8;

export function sessionShortId(sessionId: string | undefined): string {
  if (!sessionId) return "";
  return sessionId.slice(0, SHORT_ID_LENGTH);
}