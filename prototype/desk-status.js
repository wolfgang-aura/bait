/**
 * Why the Pitch Room's desk can or cannot take a pitch, in words a person running the
 * repo can act on. Three different stops, never merged into one "offline":
 *   no_key      no DEEPSEEK_API_KEY: the local setup is missing a key
 *   hosted_cap  the hosted daily model-call cap is spent: honest and temporary
 *   local_cap   this machine's model-call budget is spent
 */
export const DESK_MESSAGES = Object.freeze({
  no_key: 'No DEEPSEEK_API_KEY in .env, so the AI desk cannot answer. Playing a round needs that key; npm run bench needs no keys.',
  hosted_cap: 'Today’s live rounds are used up. The recorded proof is still open.',
  local_cap: 'The desk’s model-call budget on this machine is spent, so it cannot answer. npm run bench needs no keys.',
});

export function deskStatus({ hasKey, remaining, worstCase, hosted, hostedRemaining }) {
  const blocker = !hasKey ? 'no_key'
    : hosted && hostedRemaining < worstCase ? 'hosted_cap'
      : remaining < worstCase ? 'local_cap' : null;
  return { ready: blocker === null, blocker, message: blocker ? DESK_MESSAGES[blocker] : null };
}
