/**
 * Nansen address labels are not redistributed. Nansen's redistribution guide prohibits public
 * display of address labels in bulk, so every raw read BAIT commits or serves drops them:
 * addresses, relations, amounts and timestamps stay; the label strings go.
 *
 * One label is load-bearing: gate v5 does not count a first funder whose label names an exchange,
 * bridge, router or service (EXCLUDED_FUNDER_LABEL, bench/V5.md). A related-wallets `First Funder`
 * row therefore keeps one derived boolean, `funder_excluded_by_label`, computed from the label
 * before it is dropped. validation/v5-evidence.js reads that boolean when the label is absent, so
 * a stripped read decides exactly what the original did.
 */
import { EXCLUDED_FUNDER_LABEL } from './v5-evidence.js';

/** Keys whose values are Nansen labels in the endpoints BAIT reads. */
export const NANSEN_LABEL_KEYS = Object.freeze(['address_label', 'trader_address_label', 'from_address_label', 'to_address_label']);
const KEYS = new Set(NANSEN_LABEL_KEYS);

/** A deep copy of `value` with every Nansen label removed. Key order is kept. */
export function stripNansenLabels(value) {
  if (Array.isArray(value)) return value.map(stripNansenLabels);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  const firstFunder = value.relation === 'First Funder' && Object.hasOwn(value, 'address_label');
  for (const [k, v] of Object.entries(value)) {
    // An empty label (null or "") names nothing and is kept, so a file without a label is unchanged.
    if (KEYS.has(k) && v !== null && v !== '') {
      if (k === 'address_label' && firstFunder) out.funder_excluded_by_label = EXCLUDED_FUNDER_LABEL.test(String(v ?? ''));
      continue;
    }
    out[k] = stripNansenLabels(v);
  }
  return out;
}

/** True when `value` still holds a non-empty Nansen label anywhere. */
export function hasNansenLabel(value) {
  if (Array.isArray(value)) return value.some(hasNansenLabel);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([k, v]) => (KEYS.has(k) && v !== null && v !== '') || hasNansenLabel(v));
}
