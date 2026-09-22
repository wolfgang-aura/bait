/** Select a concise comparison without changing the complete evidence ranking. */
export function openerComparison(rows, pickedHandle) {
  const picked = rows.find(row => row.handle === pickedHandle);
  if (!picked) throw new Error('The selected trader has no recorded evidence');
  const best = rows.find(row => row.best && !row.thinSample);
  return best && best.handle !== picked.handle ? [picked, best] : [picked];
}
