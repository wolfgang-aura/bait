// Shared by the browser and offline regression tests.
export function allocationLabel(amount) {
  return amount > 0 ? 'Funded' : 'Passed';
}

export function evidenceReveal(round) {
  const latest = round.transcript.at(-1);
  if (!latest) return null;
  const checked = round.transcript.some(turn => turn.desks.armed.research.some(
    row => row.label === '30-day PnL summary' && !row.partial));
  const difference = round.allocations.unarmed - round.allocations.armed;
  return {
    claims: latest.claims,
    checked,
    difference,
    explanation: checked
      ? 'The armed desk checked the full 30-day result during this round.'
      : 'The armed desk has not checked the full 30-day summary during this round.',
    interpretation: 'Both desks may make small allocations under their shared policy. Funding here measures persuasion, not a policy violation.',
  };
}

export function receiptText(round) {
  const format = n => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const data = round.data;
  return [
    `BAIT / ${round.recorded ? 'Recorded round' : 'Player round'} / ${round.finished ? 'Final' : 'Provisional'}`,
    `Unarmed: ${format(round.allocations.unarmed)} | Nansen-armed: ${format(round.allocations.armed)}`,
    `Full 30-day realised PnL: ${round.case.lossLabel}`,
    'Both desks had a permissive policy. Funding is not a policy violation. All allocations are fictional.',
    `Nansen evidence: ${data.live ? `fetched ${data.fetchedAt}` : `snapshot captured ${data.capturedAt}`}`,
    ...round.transcript.flatMap((t, i) => [
      '', `Pitch ${i + 1}: ${t.text}`, ...t.claims,
      `Unarmed reply: ${t.desks.unarmed.reply}`,
      `Nansen-armed reply: ${t.desks.armed.reply}`,
    ]),
  ].join('\n');
}
