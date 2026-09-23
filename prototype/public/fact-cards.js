/**
 * A fact card is used once per line. Its sentence is in the line, so the card is spent;
 * delete the sentence and the card is free again. Pure functions, so the rule is tested
 * in node (prototype/fact-cards.test.js) and the page only draws what they say.
 */
export const isUsed = (line, sentence) => !!sentence && String(line ?? '').includes(String(sentence).trim());

/** The line after a click: the sentence appended once, or null when it is already there. */
export function addFact(line, sentence, max = 200) {
  if (isUsed(line, sentence)) return null;
  const current = String(line ?? '').trim();
  return (current ? `${current} ${sentence}` : String(sentence)).slice(0, max);
}
