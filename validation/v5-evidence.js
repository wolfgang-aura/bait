/**
 * Gate v5's operator read (bench/V5.md), in one place so the live guard and the benchmark build
 * the same requests and map the same responses.
 *
 *   profiler/address/related-wallets  1 credit per chain  the wallet's First Funder (ethereum, arbitrum)
 *   profiler/address/transactions     1 credit per funder the funding transfer itself: its USD size
 *   profiler/perp-pnl-summary         1 credit per sibling each sibling's realised PnL, same days
 *
 * "Siblings" are the other Hyperliquid wallets in BAIT's operator index (bench/v5/operator-index.json)
 * whose first funder on the same chain is the same address. The index is built from Nansen reads
 * only: perp-leaderboard pages for the universe, related-wallets for every wallet in it,
 * transactions for every funding transfer that could make two wallets siblings.
 *
 * The gate asks for all of it with one tool name, `get_operator`. `withV5Reads` answers that name
 * from saved responses (the benchmark), `createOperatorReader` from live calls (the guard CLI).
 * Nothing here invents a number: a missing field is an error the gate records as not assessed.
 */

export const RELATED_ENDPOINT = 'profiler/address/related-wallets';
export const TRANSACTIONS_ENDPOINT = 'profiler/address/transactions';
export const SUMMARY_ENDPOINT = 'profiler/perp-pnl-summary';
export const OPERATOR_SOURCE = 'Nansen /api/v1/profiler/address/related-wallets';

/** Chains whose first funder is read. Hyperliquid deposits arrive through Arbitrum; older wallets were funded on Ethereum. */
export const OPERATOR_CHAINS = Object.freeze(['ethereum', 'arbitrum']);
/** A funding transfer smaller than this is dust (airdrop spam, address poisoning), not an operator paying for a wallet. */
export const MIN_FUNDING_USD = 100;
/** A funder behind more universe wallets than this is a service (payroll, OTC desk, market maker), not one operator. */
export const MAX_OPERATOR_WALLETS = 10;
/** At most this many siblings are read live, in index order. */
export const MAX_SIBLINGS_READ = 8;

/**
 * Funders whose shared funding means nothing: exchanges and their hot wallets, bridges, routers,
 * mixers, faucets, batch senders. Matched against the Nansen label of the funder, case-insensitive.
 * Fixed in bench/V5.md before any operator read was scored.
 */
export const EXCLUDED_FUNDER_LABEL = /binance|coinbase|kraken|okx|okex|bybit|bitget|kucoin|gate\.io|gateio|htx|huobi|mexc|crypto\.com|bitfinex|bitstamp|gemini|upbit|bithumb|robinhood|revolut|bitpanda|poloniex|bittrex|deribit|whitebit|lbank|bingx|bitmart|backpack|exchange|\bcex\b|hot ?wallet|deposit|withdraw|bridge|gateway|router|relay|layerzero|stargate|across|\bhop\b|orbiter|wormhole|synapse|celer|socket|li\.fi|lifi|1inch|uniswap|paraswap|0x ?protocol|cow ?swap|tornado|railgun|faucet|disperse|multisend|batch|hyperliquid|arbitrum|optimism|polygon|\bbase\b|wrapped|weth|token contract|contract|safe proxy|proxy|treasury|payroll|market maker|wintermute|jump trading|cumberland|galaxy digital|flowdesk|\bgsr\b/i;

/**
 * Why a funder does not count as an operator, or null when it does. `labelExcluded` is the derived
 * boolean a label-free read carries instead of the label (validation/nansen-labels.js).
 */
export function funderExclusion({ label = '', labelExcluded = false, wallets = null } = {}) {
  if (labelExcluded === true || EXCLUDED_FUNDER_LABEL.test(String(label ?? ''))) return 'label: exchange, bridge, router or service';
  if (Number.isInteger(wallets) && wallets > MAX_OPERATOR_WALLETS) return `funds ${wallets} indexed wallets (over ${MAX_OPERATOR_WALLETS}): a service`;
  return null;
}

const ymd = value => new Date(value).toISOString().slice(0, 10);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const lower = v => String(v ?? '').toLowerCase();

export const relatedRequest = (wallet, chain) => ({ address: lower(wallet), chain });

/** The First Funder row of a related-wallets response, or an error object. */
export function firstFunderFrom(body, { chain } = {}) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const row = rows.find(r => r?.relation === 'First Funder' && /^0x[0-9a-fA-F]{40}$/.test(String(r.address ?? '')));
  if (!row) return { error: 'no_first_funder', chain };
  // The label is used once, here, and never kept: only whether it names an exchange, bridge or
  // service. A label-free read (validation/nansen-labels.js) carries that answer as a boolean.
  const labelExcluded = row.funder_excluded_by_label === true || EXCLUDED_FUNDER_LABEL.test(String(row.address_label ?? ''));
  return { chain: row.chain ?? chain, funder: lower(row.address), label_excluded: labelExcluded, tx_hash: lower(row.transaction_hash), block_timestamp: row.block_timestamp ?? null };
}

/** transactions for the funded wallet on the funding day (and the next, for a late-UTC block). */
export function fundingRequest(wallet, chain, blockTimestamp) {
  const day = Date.parse(blockTimestamp);
  return { address: lower(wallet), chain, date: { from: ymd(day), to: ymd(day + 86_400_000) }, pagination: { page: 1, per_page: 100 } };
}

/** The USD size of the funding transfer, found by its hash in a transactions response. */
export function fundingFrom(body, { txHash, funder }) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const row = rows.find(r => lower(r?.transaction_hash) === lower(txHash));
  if (!row) return { error: 'funding_tx_not_found' };
  const fromFunder = (row.tokens_received ?? []).some(t => lower(t?.from_address) === lower(funder));
  if (!fromFunder) return { error: 'funding_tx_not_from_funder' };
  if (!finite(row.volume_usd)) return { error: 'funding_value_unknown' };
  return { funding_usd: Math.round(row.volume_usd * 100) / 100 };
}

/** perp-pnl-summary for a sibling over exactly the window the gate judged. */
export const siblingRequest = (wallet, window) => ({ address: lower(wallet), date: { from: window.from, to: window.to } });

/** A perp-pnl-summary response as a sibling record. */
export function siblingFrom(body, { wallet, window, retrievedAt = null }) {
  const d = body?.data ?? null;
  if (!d || !finite(d.realized_pnl_usd)) return { wallet: lower(wallet), error: 'no_record' };
  return { wallet: lower(wallet), realized_pnl_usd: Math.round(d.realized_pnl_usd * 100) / 100,
    closed_trade_count: Number.isInteger(d.closed_trade_count) ? d.closed_trade_count : null, window, retrieved_at: retrievedAt };
}

/** The operator index: `chain:funder` -> member wallets, plus the funders ruled out as services. */
export function indexSiblings(index, wallet, funders) {
  const w = lower(wallet);
  const out = [];
  for (const f of funders) {
    const members = index?.groups?.[`${f.chain}:${f.funder}`] ?? [];
    for (const m of members) if (m !== w && !out.some(o => o.wallet === m)) out.push({ wallet: m, chain: f.chain, funder: f.funder });
  }
  return out;
}

/**
 * Assemble a `get_operator` answer from the parts. `funders` are firstFunderFrom results with a
 * `funding` (fundingFrom) attached; `records` maps a sibling wallet to its siblingFrom result.
 */
export function operatorAnswer({ wallet, funders, index, records, window, retrievedAt = null }) {
  const services = new Set(index?.services ?? []);
  const judged = funders.filter(f => !f.error).map(f => {
    const key = `${f.chain}:${f.funder}`;
    const excluded = funderExclusion({ labelExcluded: f.label_excluded, label: f.label }) ?? (services.has(key) ? `funds over ${MAX_OPERATOR_WALLETS} indexed wallets: a service` : null);
    const funding = f.funding ?? { error: 'not_read' };
    const fundingOk = finite(funding.funding_usd) && funding.funding_usd >= MIN_FUNDING_USD;
    return { chain: f.chain, funder: f.funder, excluded, funding_usd: funding.funding_usd ?? null, funding_error: funding.error ?? null,
      funding_ok: fundingOk, counts: !excluded && fundingOk };
  });
  const siblings = indexSiblings(index, wallet, judged.filter(f => f.counts)).slice(0, MAX_SIBLINGS_READ)
    .map(s => ({ ...s, ...(records?.[s.wallet] ?? { error: 'not_read' }) }));
  return { wallet: lower(wallet), funders: judged, siblings, window, index_wallets: index?.universe ?? null, source: OPERATOR_SOURCE, retrieved_at: retrievedAt };
}

/**
 * Answer `get_operator` from reads already made; delegate everything else. `reads.operator` is a
 * get_operator answer (or an error object, e.g. `not_read`).
 */
export function withV5Reads(executor, reads = {}) {
  return {
    ...executor,
    execute: async (name, input = {}) => {
      if (name === 'get_operator') return reads.operator ?? { error: 'not_read', message: reads.operatorNote ?? null };
      return executor.execute(name, input);
    },
  };
}

/**
 * The live operator read. `call(path, body, opts)` is validation/nansen.js `call`. Cost: one
 * related-wallets read per chain, one transactions read per funder that is not excluded by its
 * label, one perp-pnl-summary per sibling found in the index (at most MAX_SIBLINGS_READ).
 */
export function createOperatorReader({ call, index, now = () => new Date(), timeoutMs = 20_000, log = null }) {
  return async function getOperator({ wallet, window }) {
    const at = now().toISOString();
    const funders = [];
    for (const chain of OPERATOR_CHAINS) {
      const r = await call(RELATED_ENDPOINT, relatedRequest(wallet, chain), { note: `guard live v5 related-wallets ${chain}`, timeoutMs });
      funders.push(firstFunderFrom(r?.data, { chain }));
    }
    for (const f of funders) {
      if (f.error || funderExclusion({ labelExcluded: f.label_excluded, label: f.label })) continue;
      if (!indexSiblings(index, wallet, [f]).length) { f.funding = { error: 'no_indexed_siblings' }; continue; }
      const req = fundingRequest(wallet, f.chain, f.block_timestamp);
      try {
        const r = await call(TRANSACTIONS_ENDPOINT, req, { note: `guard live v5 funding ${f.chain}`, timeoutMs });
        f.funding = fundingFrom(r?.data, { txHash: f.tx_hash, funder: f.funder });
      } catch (err) { f.funding = { error: String(err?.message ?? err).slice(0, 160) }; }
    }
    const draft = operatorAnswer({ wallet, funders, index, records: {}, window, retrievedAt: at });
    const records = {};
    for (const s of draft.siblings) {
      try {
        const r = await call(SUMMARY_ENDPOINT, siblingRequest(s.wallet, window), { note: 'guard live v5 sibling 30d', timeoutMs });
        records[s.wallet] = siblingFrom(r?.data, { wallet: s.wallet, window, retrievedAt: at });
      } catch (err) { records[s.wallet] = { wallet: s.wallet, error: String(err?.message ?? err).slice(0, 160) }; }
      log?.(`sibling ${s.wallet}: ${records[s.wallet].error ?? records[s.wallet].realized_pnl_usd}`);
    }
    return operatorAnswer({ wallet, funders, index, records, window, retrievedAt: at });
  };
}
