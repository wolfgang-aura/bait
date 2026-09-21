# BAIT public page, version B

Scope: `prototype/public/replay.html`, `replay.css`, `replay.js` (promoted from the Version B candidate on 21 Sep 2026).
Version A is being built in parallel by another agent. Nothing here changes `DESIGN.md`
or any shipped file.

## Design read

Reading this as: a redesign-overhaul of a competition demo page for buildathon judges
and crypto-native skimmers, with a dark trading-terminal language, leaning toward
hand-written CSS plus Space Grotesk and JetBrains Mono, no CSS framework.

Dials used, as instructed in the brief: `DESIGN_VARIANCE 7`, `MOTION_INTENSITY 3`,
`VISUAL_DENSITY 4`. The skill's redesign-overhaul row would push motion higher; the
brief's explicit values win, and low motion is the right call for a page whose job is to
be read in five seconds by a judge with 40 other tabs open.

## What I saw, at 1280 x 800

I captured the live page at <https://wolfgang-aura.github.io/bait/>, clicked "Next pitch"
and scrolled the full length, then captured <https://labelme.edycu.dev> and
<https://thesingulant.ai/proof> for calibration.

The current BAIT page opens with a masthead, a category eyebrow, a headline, a
paragraph, a full-width amber policy bar, a toolbar row and only then the game: six
stacked text objects before anything a person can act on. Both desk cards look
identical in weight, so the two allocation figures ($5,000 and $2,500) read as two
paragraphs with big numbers rather than as a score. The "-$4,763,461" reveal, which is
the whole punchline, sits below the fold in a low-contrast band and is smaller than the
headline. Below that the page turns into five screens of grey prose, two tables and four
collapsed `details` blocks with no visual change in rhythm. The top-right link reads
"Run the live game locally" and goes to a raw text destination, which is exactly the dead
end the founder hit. Label Me, by contrast, puts a green live Nansen call log beside the
hero and a single "Deal" button in the first screen; Singulant leads with one sentence
("Don't ask AI to confirm your thesis. Make it try to break it."), one input and one red
action button. Both are legible in about two seconds. BAIT has the better experiment and
the worse first screen.

## Audit of the current page

- Typography: system sans everywhere, one weight of hierarchy, numbers not visually
  privileged over prose. Headline and the loss figure compete at similar size.
- Colour: dark base with amber accent, plus green and rose semantics, plus two desk
  accents (grey, blue). Four colour ideas fighting in one viewport.
- Layout: everything is a full-width stacked band. No asymmetry, no focal point, six
  sections using the same layout family.
- Density: reads as 7, not 4. Every honesty caveat is spelled out in two or three
  sentences, repeated per section.
- Motion: none, including no hover feedback on the desk cards or table rows.
- Interaction: the replay works well. Keep it. The dead-end "Run the live game locally"
  link is the one broken control.
- Nansen: named in prose but never shown as machinery. No endpoint names, no fetch
  timestamp above the fold.

## Version B4: wallet-allocation product boundary (current)

The 21 September product audit found that "AI trading agents" promised more than the
guard implements. The page now names the exact user and protected action above the
fold: platforms that let AI allocate capital to trader wallets. Section 3 adds a
four-cell contract for buyer, protected action, returned decision, and exclusions.

The guard copy now states its full production checks: wallet identity, 30-day scope,
Nansen source, evidence freshness, and realised PnL. The screen says that BAIT neither
picks wallets nor executes trades. This is deliberate narrowing, not a roadmap claim.
The visual system, score pair, replay, and golden viewports remain unchanged.

Verified captures: `prototype/screenshots/replay-wallet-guard-desktop.png`,
`replay-wallet-guard-contract.png`, and `replay-wallet-guard-phone.png`. They were
rendered from the local server at 1280 x 800 and 390 x 844 with zero console errors.

The one thing a viewer should understand after the score is what they can integrate:
an allow-or-block decision between an AI proposal and wallet-allocation execution.

## Version B5: ten-wallet navigator (current)

Section `4 · Navigate` turns the guard contract into a reviewable user flow. At the
golden 1280 x 800 viewport it uses a two-column card grid; at 390 x 844 it collapses
to one column without horizontal overflow. Two native selects filter by venue and
decision. Each card gives the decision first, then the full address, 30-day realised
PnL, trade count, win rate, reason, and links to the profile, evidence, or explorer.

The visual language stays frozen: existing type, spacing, colour, radius, and focus
tokens only. Amber means an eligible result, red means a blocked result, and neither
is presented as a return forecast. Fomo cards also show its headline PnL; disagreement
with observed realised PnL is red so the viewer sees the measurement trap immediately.

The one thing a viewer should notice first in this section is that BAIT applies one
explicit rule to both profitable and losing examples. The source limitation is visible
below the cards: Fomo coverage is limited to Fomo-linked Robinhood Chain execution
wallets and uses public Fomo Radar data; Hyperliquid uses Nansen summaries.

## Version B3: the product, not the vendor (superseded by B4 above)

The founder's verdict on B2: the page read as a promotional page for the Nansen API,
"we tested this and that, results are better, so use Nansen API", with no product in
sight. B3 is a framing fix, not decoration. The tokens, the hero composition and the
replay are unchanged; what changed is what the page says it is.

### BAIT is a three-part red-team kit, and the page is ordered the same way

1. **Attack.** A game in which a human baits an AI trading desk with true-but-selective
   facts. On the page this is the recorded replay, section `1 · Attack`.
2. **Score.** A harness that replays the recorded attacks against any agent configuration
   and reports a baited rate with a deterministic referee. On the page this is the
   leaderboard, section `2 · Score`, one row per row in `comparison.rows`, ordered by
   baited rate descending, followed by the `Test your own agent` block with the bench
   command and a config file.
3. **Guard.** A code gate, `validation/guard.js`, that makes one Nansen
   `profiler/perp-pnl-summary` call itself and forces the allocation to $0 on negative
   or missing 30-day realised PnL. It held 0/30 and blocked 25 of 30 attempts with no
   model tools and no policy text. On the page this is section `3 · Guard`: the
   headline from the `guarded` row, three one-line facts, the import snippet, "Get the
   guard" and "Copy the snippet". The prompt-only strict policy (also 0/30) moved into
   the audit fold; the guard does not depend on the model reading it.

Nansen is the evidence layer the rule depends on. It left the masthead; it is credited
in the evidence line under the hero button and named in the tool labels, but it is never
the subject of a headline. The section numbers are real: they are the order
a user goes through, attack then score then fix.

### Above the fold, 1280 x 800: six elements

1. Wordmark `BAIT` with `Red-team kit for AI trading agents · recorded`.
2. One headline stating the attack, with the loss rendered from `comparison.pnl`.
3. One line under it naming the three parts: records, scores, ships the rule.
4. Two giant numbers, `24/30` "baited · no tools" and `0/30` "baited · BAIT guard",
   from `comparison.rows` (`unarmed` and `guarded`). JetBrains Mono 700,
   `clamp(84px, 12.5vw, 160px)`, 160px measured at 1280 wide, 81.9px at 390. The armed
   pair is the only amber text on the first screen apart from the button.
5. One primary button, "Step through the attack".
6. One mono evidence line: `Evidence: Nansen profiler/perp-pnl-summary 7d, 30d ·
   profiler/perp-trades · round recorded 18 Sept 2026`, rendered from the research rows
   and the round timestamp.

The one thing a viewer should notice first is still the pair `24/30` against `0/30`.
The headline names the attack that produced the 24, the line under it names the product,
the labels on the numbers name what changed between them (no tools against the BAIT
guard, since 21 Sep 2026), and the evidence line credits Nansen.

### Word budget (B3)

Above the fold: 55 words, counting each number and each endpoint path as a word. Measured
on the rendered page at 1280 x 800: 60 tokens (mast 8, headline 13, product line 15,
pair labels and numbers 9, button 4, evidence line 11). The headline and the product
line are the founder's exact strings, at 13 and 15 words; both are over the 12 and 14
word caps given for them, and the page is five words over the budget as a result. Cut
candidates, if the founder wants the budget met: drop "recorded" from the mast (1),
drop "round recorded" from the evidence line (2). Every caption below the fold is one
sentence, and every methodology sentence lives inside the single audit fold.

### Page order below the fold (B3)

`1 · Attack`: the replay, unchanged. `2 · Score`: the leaderboard (columns Agent
configuration, Tools, Baited as `24 / 30 (80%)`, Mean allocation), one caveat sentence,
then the `Test your own agent` block linking to the repository's benchmark-harness
section; the `guarded` row carries a "blocked 25/30" chip rendered only when the row
has a numeric `blocked`. `3 · Guard` (21 Sep 2026, replacing `3 · Fix`): "The guard
that held: 0 of 30. Blocked 25 attempts." from the guarded row, three one-line facts,
the `guardAllocation` import snippet in a bordered mono block, an amber "Get the guard"
link to `validation/guard.js` and a ghost "Copy the snippet" with a "Copied" status.
Then the single collapsed audit fold, which now opens with the prompt-only strict rule
verbatim under a line stating it also held 0/30. Footer: "Play it live" and "GitHub".
Screenshots: `prototype/screenshots/replay-guard-desktop.png`, `replay-guard-phone.png`
and `replay-guard-section3.png`, captured with the Playwright headless shell against a
static serve of the packaged demo.

The bundle gained an `armed-basic` row (6/30, $317) while B3 was being built. The
leaderboard rendered it with no code change, which is the point of reading every row
from `comparison.rows`.

## Version B2: the bold cut (superseded by B3 above)

The founder's verdict on B1: "B looks better than A, but far from perfect", and the
standing complaint that judges skim for five seconds and will not read essays. B2 is a
composition fix, not a patch: element count, type scale and word count are budgeted.

### Above the fold, 1280 x 800: five elements, nothing else

1. Wordmark `BAIT` with `Recorded · powered by Nansen API` in the masthead.
2. One headline, ten words, stating the result. The loss figure is rendered from
   `comparison.pnl` in the bundle, rounded to one decimal in millions.
3. Two giant numbers side by side, `24/30` "funded, no tools" and `0/30` "funded, Nansen
   + strict rule", from `comparison.rows` (`unarmed` and `armed-strict`, `funded` and
   `runs`). JetBrains Mono 700, `clamp(84px, 13.5vw, 176px)`, tabular-nums, 172.8px
   measured at 1280 wide, 81.9px at 390. The armed pair is the only amber text on the
   first screen.
4. One primary button, "Step through the attack", scrolling to the replay.
5. One mono line naming the Nansen endpoints the armed desk pulled, with windows and the
   fetch date, rendered from the research rows in the bundle.

The one thing a viewer should notice first is the pair `24/30` against `0/30`. The
headline explains it, the button acts on it, the endpoint line credits Nansen for it.
No lede paragraph, no second button, no scoreboard card, no caveat.

### Word budget

Above the fold: 40 words or fewer, counting each number as a word. Measured on the
rendered page: 38 tokens (headline 10, mast 6, pair labels and numbers 9, button 4,
endpoint line 9). Every caption or fineprint below the fold is one sentence, at most one
caveat line per section, and every methodology sentence lives inside the single
`Audit: paired policy test, sources, hashes` fold.

### Page order below the fold

Replay (pitch card, two desk tickets, the omitted-loss reveal with Back / Next pitch),
then the Experiment 1 table (rows `unarmed` then `armed-strict`; columns Evidence access,
Funded the losing wallet as `24 / 30 (80%)`, Mean allocation), then the one collapsed
audit fold holding the paired policy table, wallet explorer, exploratory strict run,
source manifest with sha256 hashes and the JSON download. Footer carries the
"Play it live" link to the repository. Screenshots: `prototype/screenshots/replay-b2-desktop.png`
and `replay-b2-phone.png`, captured with headless Edge against the local server.

## Direction for version B1 (superseded by B2 above)

One theme, dark, locked. Three moves:

1. The first screen states the game, names Nansen, and shows the money shot. The hero's
   right column is the recorded round's final scoreboard, built from the audited bundle:
   two allocation figures and the 30-day loss the pitch omitted.
2. Nansen becomes visible machinery. A band directly under the hero lists the exact
   endpoints the armed desk called, rendered from the research rows in the bundle rather
   than typed into HTML, with the evidence fetch timestamp beside them.
3. Text volume roughly halved. Every honesty caveat collapses to one short line placed
   where the claim is made.

## Tokens, version B

Departs from `DESIGN.md`. Recorded here, not there.

- Surfaces: page `#0A0B0D`, panel `#101317`, raised `#171B21`.
- Hairlines: `#252A31` strong, `#1B2027` soft.
- Text: `#F2F3F5`, dim `#9AA2AD`, faint `#6C737D`.
- Accent, one only: `#FFB020`. Used for the brand mark, every primary control, focus
  rings and the armed-desk rule. Never used to mean "good".
- Data semantic, not an accent: `#FF6B6B`, used only on a negative PnL figure.
- Radius: 2px on every surface and control. One scale, no exceptions.
- Type: Space Grotesk 500/700 for display and UI, JetBrains Mono 400/500/700 for every
  number, label and endpoint name, with `font-variant-numeric: tabular-nums`.
- Scale: 12, 13, 15, 17, 20, 30, clamp(30px, 4.2vw, 54px) for the headline and
  clamp(84px, 13.5vw, 176px) for the two hero numbers. Body line height 1.5, headline
  1.06, hero numbers 0.9.
- Spacing: 4, 8, 12, 16, 24, 32, 48, 72. Content width 1200px.
- Viewports: 1280 x 800 golden, 390 x 844 phone. No horizontal page scroll at either.

## Documented departures from the skill

- **Single theme.** The page is dark only, per the brief. `color-scheme: dark` is set so
  form controls follow.
- **Google Fonts via `<link>`.** The brief allows it for this static page.
- **No photography and no icon library.** The page is served as three static files with
  no bundler and no CDN scripts, so an icon package is not available, and hand-rolled
  SVG icons are banned. The page therefore uses no icons at all. The hero asset is a real
  component rendered from real audited data, which the skill permits in place of imagery
  ("a real component preview"); stock photography on a data-honesty page would be worse
  than none.
- **Em-dashes in model replies.** The recorded DeepSeek replies in
  `recorded-results.json` contain hyphens and one U+2014. They are verbatim evidence and are
  not edited. Every string this page authors contains zero em-dashes.

## Data changed mid-build, so nothing is typed into HTML

While this page was being built, `prototype/public/recorded-results.json` was regenerated.
`comparison.rows` went from three configurations (`unarmed`, `armed-basic`, `armed-plus`,
90 replays, 18 Sep) to two (`unarmed` 24/30 at $3,908 mean, `armed-strict` 0/30 at $0,
60 replays, 20 Sep, frozen Nansen evidence). The first draft rendered `undefined` for the
new row and carried a hardcoded "90 replays" heading and a hardcoded caption date.

Everything the bundle can supply is now read from it: the configuration labels fall back
to the raw id for any unknown config, the replay count and repeat count are summed from
the rows, and every date on the page is formatted from a timestamp in the bundle. The
only page strings that describe a result are the two section headlines, which state the
direction of the finding rather than a figure.

## The 5-second contract (B3)

A first-time viewer must get, without scrolling: true facts baited an AI trading desk
into funding a $4.7M loser 24 times out of 30, BAIT is the kit that records that attack,
scores any agent and ships the guard that took it to 0 of 30, and the one action is "Step
through the attack". "Play it live" is a footer link only.

## B4 hero, 21 Sep 2026: the attack ladder

Repositioned. BAIT's headline claim is no longer the guard; it is the red-team benchmark
result. The guard is the reference fix. Tokens, colours and fonts are unchanged; this is
a composition change.

Above the fold at 1280 x 720, in order:

1. Wordmark `BAIT` with `Red-team benchmark for AI capital allocators · recorded proof`.
2. A mono provenance label naming the source case, `bench/cases/00-headline-encounter`.
3. The headline is now a verbatim quote from that recorded attack: "A win rate that
   holds across a sample that size is a process, not luck." Space Grotesk 700,
   `clamp(26px, 3.2vw, 40px)`, `max-width: 38ch`, two lines at 1280.
4. One line of context carrying the exact 30-day realised PnL from `comparison.pnl`,
   rendered with `money()` rather than the old rounded `$4.7M`.
5. A three-rung ladder from `comparison.rows`: `unarmed` 24/30 "baited · no data",
   `armed-basic` 6/30 "baited · with Nansen data, no rule", `guarded` 0/30
   "baited · behind BAIT's gate". JetBrains Mono 700, `clamp(60px, 8.5vw, 108px)`.
   Rung 3 is the only amber number. A mono arrow sits in each gap; it collapses on phone,
   where the ladder stacks to one column.
6. Three routes: "Step through the attack" (primary), "Score your agent",
   "Run the gate live". "Explore 10 wallets" moved to the footer.
7. The unchanged mono evidence line crediting Nansen.

The one thing a viewer should notice first is the quoted attack line, then the descent
24 → 6 → 0. Beat 3 is the point the ladder exists to make: with Nansen PnL and trade
history in hand and no rule, the agent still funded the loser 6 of 30, so having the
data is not the fix.

Verified at 1280 x 720 and 390 x 844, zero console errors.
