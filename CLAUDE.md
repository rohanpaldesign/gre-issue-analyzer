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

Five trait scorers matching the ETS rubric dimensions, blended into a holistic score snapped to the 0.5 grid ETS reports. Weights are fitted by `scripts/calibrate.mjs` against six ETS-scored essays (levels 1 to 6) with official rater commentary.

**Calibration is a gate, not a formality.** Every calibration essay must land within 0.5 of its official score, and rank order across levels 1 to 6 must hold. If a change to a trait scorer breaks that, the change is wrong.

The heuristic engine scores surface correlates of quality, not argument merit. Do not add UI copy claiming otherwise. The optional Gemini rater covers reasoning quality; the app must stay fully functional when `GEMINI_API_KEY` is unset.

### Task types

Six, derived from the ETS instruction wording: `statement`, `claim`, `claim-reason`, `recommendation`, `two-views`, `policy`. ETS ships one instruction with a typo (`the claim` where siblings read `that claim`); it is normalised in `extract-pool.mjs`. Each type imposes a different demand that the position scorer checks, for example `two-views` essays must address both views and `claim-reason` essays must address the reason.

### Authored content standard

Per-topic reasons must engage that statement's specific claim, name the causal mechanism rather than just asserting a position, and attach a concrete named example. A reason that would fit any prompt is not acceptable.

## Verification

No local build is possible on the author's machine. The **Vercel preview deploy is the type-check and schema gate**. Run `npm run calibrate` after any scoring change.
