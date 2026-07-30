# GRE Issue Analyzer

Practice the GRE "Analyze an Issue" task against real prompts from the official ETS pool, get scored against the ETS rubric, see well-reasoned arguments for both sides of every prompt, and track whether you are actually improving.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=rohanpaldesign/gre-issue-analyzer)

## What it does

- Serves a real Issue prompt from the 159-topic ETS pool, filtered by theme, task type, or what you have not attempted yet.
- Times the attempt at 30 minutes, autosaves as you write, and tracks word count.
- Scores the essay on the five ETS rubric dimensions: position and task response, development, focus and organisation, language and fluency, and conventions.
- Checks your essay against the GregMat structure separately: strong stance, two support paragraphs, one concede-and-rebut paragraph, and a conclusion.
- Shows three supporting reasons, three opposing reasons, and the strongest concession with its rebuttal for whichever side you took, plus a bank of reusable real-world examples.
- Tracks score trend, per-trait strengths and weaknesses, topic coverage, and a predicted AW score band.

## How scoring works, and what it cannot do

Two raters run on every essay.

**The heuristic engine** is pure TypeScript, costs nothing, and always runs. It is calibrated against six essays that ETS itself scored 1 through 6, published with rater commentary, so its weights are fitted to real ETS judgments rather than invented.

Be clear about its limit: it measures structure, development signals, lexical and syntactic variety, and mechanics. It cannot tell a brilliant argument from a fluent empty one. This is the same limitation ETS's own e-rater has, which is why ETS does not use e-rater unassisted either.

**The AI rater** is optional and covers that gap. It runs on Google's Gemini free tier (1,500 requests/day, no credit card), using your own API key. Set `GEMINI_API_KEY` and it turns on; leave it unset and the app works fully without it.

The predicted score is reported as a **band**, never a single decimal. Six calibration essays is a small sample and pretending otherwise would be false precision.

Note: free-tier Gemini may use submitted prompts for training. Essays sent to the AI rater are not private. The app says so before you first use it.

## Setup

```bash
npm install

# Extract source material into the gitignored seed-data/ directory
npm run extract:pool -- /path/to/issue-pool.pdf
npm run extract:calibration

# Push schema and content to Turso
npm run db:migrate
npm run db:seed

npm run dev
```

Environment variables:

| Variable | Required | Purpose |
|---|---|---|
| `TURSO_DATABASE_URL` | yes | libSQL connection URL |
| `TURSO_AUTH_TOKEN` | yes | libSQL auth token |
| `GEMINI_API_KEY` | no | Enables the optional AI rater |

## Content lives in the database, not in this repo

The ETS topic pool, the authored per-topic reasoning, the reusable example bank, and the calibration essays are all stored in Turso and seeded by script. `seed-data/` is gitignored. This repo contains parsers and application code only.

## Attribution

The Issue topic pool, the "Analyze an Issue" scoring guide, and the scored sample essays are published by **ETS** and are the property of ETS. This is an independent study tool. It is not affiliated with, endorsed by, or sponsored by ETS. GRE is a registered trademark of ETS.

- Issue topic pool: <https://www.ets.org/pdfs/gre/issue-pool.pdf>
- Task overview and scoring guide: <https://www.ets.org/gre/test-takers/general-test/prepare/content/analytical-writing/issue.html>
- Scored sample responses: <https://www.ets.org/pdfs/gre/gre-practice-test-3%20writing-responses-18-point.pdf>

The essay structure guidance follows the approach popularised by GregMat.
