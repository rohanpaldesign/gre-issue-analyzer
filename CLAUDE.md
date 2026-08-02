# GRE Issue Analyzer, project context

Practice app for the GRE "Analyze an Issue" task. Next.js 14 App Router, TypeScript, Turso (libSQL), deployed on Vercel.

## Hard rules

- **No ETS text in git.** The topic pool, calibration essays, and all authored content live in Turso. `seed-data/` is gitignored and must stay that way. If you find yourself committing a topic statement, stop.
- **No em dashes** anywhere in UI copy or code.
- **Responsive via CSS media queries**, never JS `matchMedia`.
- **UI from the local `components/m3` kit.** Do not add `@material/web` form or button components.
- **Never run a package manager locally.** Dependencies install in Codespaces or on Vercel.
- Branch and open a PR. Direct pushes to `main` are denied.

## Architecture

```
scripts/lib/pdf-text.mjs      PDF text extraction (kerning-aware, see below)
scripts/extract-pool.mjs      ETS pool PDF   -> seed-data/topics.json    (asserts 159)
scripts/extract-calibration.mjs ETS samples  -> seed-data/calibration.json (asserts scores 1-6)
scripts/migrate.mjs           Applies schema to Turso
scripts/seed.mjs              Idempotent upsert of content into Turso
scripts/calibrate.mjs         Fits and verifies heuristic trait weights
lib/scoring/heuristic/        The five trait scorers plus the holistic blend
app/api/score/                Heuristic rater
app/api/analyze/              Optional Gemini rater
```

### PDF extraction, the non-obvious part

The ETS PDFs are heavily kerned. A glyph run reads `A na l yze` in the source: word boundaries are **not** spaces, they are large negative kerning values inside `TJ` arrays. `pdf-text.mjs` reconstructs word gaps from kerning at a threshold of `-150`, tuned against both documents. Do not "simplify" this to reading literal spaces; it produces merged words like `statementor`.

Content streams also come back in **file order, not reading order**. The pool PDF happens to be in order; the sample-response PDFs are not, which splits headers and makes them unmatchable. `extract-calibration.mjs` reorders pages using the printed `-N-` marker. `extractPdfText` keeps file order, `extractPdfPages` lets callers reorder.

### Scoring

Two things with different jobs. **Raw features predict** the holistic score through a ridge regression fitted on PERSUADE. **The five traits explain**, driving the feedback, and are deliberately kept out of that regression: including both made them collinear with their own inputs and scrambled every sign.

Anchored onto ETS's scale by an affine fit over 11 officially scored essays, then held down where needed by `lib/scoring/ceiling.mjs`.

**The ceiling is not a hack.** The regression is fitted on grade 6 to 12 writing where 380 words is a normal length, so it cannot learn that 380 words is short for the GRE, and 11 anchors cannot correct a whole-distribution shift. ETS's published word counts run 127 at score 1 to 646 and 935 at score 6, so a cap is applied under 400, 300 and 200 words, and the interface says so whenever it binds. Removing it reintroduces a 382 word essay scoring 6.0.

**Calibration is a gate that refuses to write weights.** It checks held-out agreement, padding neutrality, known feature signs, leave-one-out error and bias against the ETS anchors, that predicted score rises across word-count buckets, and a stored regression fixture. Error is reported **leave-one-out**: measuring against the same essays the anchor was fitted to is what let an over-rating scorer pass.

Two approaches were measured and rejected. Do not retry without new evidence:

- **AI-relabelled corpus.** `scripts/label-corpus.mjs --validate` scores the 11 ETS essays first. It failed at MAE 0.591 and bias +0.318, over-rating weak essays exactly as the heuristic does, so its labels are not a standard to fit against.
- **A linear length curve.** Fixed short-essay ranking but cost real agreement and reopened the padding hole, because `openerVariety` fits negative (short essays trivially have unique openers) and padding lowers it.

The engine scores surface correlates of quality, not argument merit. A 465 word vacuous essay still gets 4.0 where ETS would likely say 2 or 3. Do not add UI copy claiming otherwise; the Gemini rater is what judges reasoning, and the app must stay fully functional when `GEMINI_API_KEY` is unset.

### Task types

Six, derived from the ETS instruction wording: `statement`, `claim`, `claim-reason`, `recommendation`, `two-views`, `policy`. ETS ships one instruction with a typo (`the claim` where siblings read `that claim`); it is normalised in `extract-pool.mjs`. Each type imposes a different demand that the position scorer checks, for example `two-views` essays must address both views and `claim-reason` essays must address the reason.

### Authored content standard

Per-topic reasons must engage that statement's specific claim, name the causal mechanism rather than just asserting a position, and attach a concrete named example. A reason that would fit any prompt is not acceptable.

## Verification

No local build is possible on the author's machine. The **Vercel preview deploy is the type-check and schema gate**. Run `npm run calibrate` after any scoring change.
