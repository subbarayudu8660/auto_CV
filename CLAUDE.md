# Handshake Instant Cover Letter — Project Notes

MV3 Chrome extension. Generates a tailored cover letter PDF from a Handshake
job posting using a saved resume + the Claude API, downloaded ready to drag
into Handshake's upload field. No auto-fill, no backend, no remote code.
See `README.md` for user-facing setup/usage instructions.

**Status: feature-complete and live-tested end to end** on a real Handshake
posting (load unpacked → popup settings persistence → generate → PDF
download → verified formatting). Remaining open items are listed below.

## Fixed: cover letter panel hanging forever on a stalled request

**Root cause (reproduced, not guessed):** none of the `fetch()` calls in
`background.js` had a timeout. `fetch()` does not time out on its own — a
connection that's accepted but never answered (network stall, dropped
connection that never fires an error event) leaves the promise pending
indefinitely. Reproduced by pointing `fetch()` (no `AbortController`) at an
HTTP server that accepts the connection but never calls `res.end()`: it was
still hanging 8+ seconds later with zero error/timeout of its own accord.
Two places this could bite:
1. `fetchGithubReposBlock()`'s GitHub API call is `await`ed *before* the
   Claude call even starts in `generateCoverLetter()` — a stall there blocks
   the entire flow before the user's actual request is even sent.
2. The main Anthropic `fetch()` itself in `generateCoverLetter()` (and, same
   defect, in `extractResume()` and `analyzeResumeSkills()`).
Once the background fetch hangs, `sendResponse` is never called, so
`content.js`'s `chrome.runtime.sendMessage(..., callback)` promise
(`requestGeneration()`) never resolves either — the panel just sits in
`renderLoading()`'s cycling-messages state forever. That's the reported
"stuck in a loop": not an actual infinite loop, but a real fetch that never
settles, driving a `setInterval` that cycles the same messages with nothing
ever completing. Audited every other branch in `generateCoverLetter()`
(HTTP error status, JSON parse failure, empty-letter case) — all of those
already `return` correctly; the missing timeout was the only defect, not a
fallthrough.

**Fix:**
- `background.js`: every `fetch()` call to `api.anthropic.com` (in
  `generateCoverLetter`, `extractResume`, `analyzeResumeSkills`) and the
  GitHub API call in `fetchGithubReposBlock` now wraps an `AbortController`
  with `setTimeout(() => controller.abort(), ...)`, cleared in a `finally`.
  Ceilings: `WEB_SEARCH_TIMEOUT_MS = 55000` for the cover letter call
  specifically (it has the `web_search` tool enabled, which can legitimately
  run longer than a plain completion — the ceiling is set above the typical
  30-45s window so a slow-but-successful search isn't mistaken for a hang);
  `API_TIMEOUT_MS = 45000` for the two plain-completion calls
  (`extractResume`, `analyzeResumeSkills`); `GITHUB_FETCH_TIMEOUT_MS = 10000`
  for the GitHub lookup (should be fast, and a stall there shouldn't be
  allowed to block letter generation at all).
- An aborted request (`err.name === "AbortError"`) is a distinct branch
  inside the existing network-error `catch`, not a new panel state — it
  returns a "request timed out, try again" message through the exact same
  `renderError()` state the 401/429/network-failure cases already use.
  GitHub's timeout just falls back to `""` like its other failure paths
  (unchanged existing behavior: GitHub context is optional and a failure
  there is swallowed silently).
- `content.js`: `requestGeneration()` and `requestResumeAnalysis()` now both
  go through a new shared `sendMessageWithSafetyNet()` — a
  `SAFETY_NET_TIMEOUT_MS = 65000` (background's 55s ceiling + buffer)
  client-side backstop. This is deliberately a backstop, not the primary
  fix: background.js's own timeouts should always produce a real error
  response first. It only matters if something outside those timeouts drops
  the message port without ever calling `sendResponse` (e.g. the MV3 service
  worker itself getting terminated mid-request) — without it, that specific
  edge case would still hang the panel forever with no code path to recover.
- Verified both behaviors directly: reproduced the original hang (fetch
  with no timeout against a stalling server, still pending after 8s) and
  confirmed the fix's `AbortController` pattern actually cuts it short
  (`err.name === "AbortError"` fired at exactly the configured timeout).
- Not yet live-tested against a real network stall in the actual extension
  (only reproduced/verified the underlying fetch behavior in isolation) —
  worth confirming once with dev tools throttling set to "offline" mid-request
  if this resurfaces.

## Resume Tailoring feature (in progress)

New capability being added alongside the existing cover-letter generator, same
extension/popup. Full spec: analyze the JD (reusing `extractJobContext()` from
`content.js` — no re-scraping) against a *structured* resume, checklist of
missing JD-relevant skills for the user to approve, then an LLM rewrite pass
that only edits existing bullets/skills (never adds new experience/project
entries), rendered to a one-page PDF matching the current resume's layout.

**Status: step 1 done + an added auto-extraction step ("Call 0") done, both
built and pending user review/live-testing. Steps 2-5 (skill-analysis
checklist onward) not started.**

Build order (per session plan, do not reorder):
1. ✅ `resumeJson` storage schema + popup UI to input/edit it.
1b. ✅ (added mid-session, not in the original 5-step plan) Auto-extraction
    ("Call 0"): upload a resume PDF or paste text, Claude structures it into
    `resumeJson`, user reviews/corrects in the same form from step 1 before
    saving — replaces typing the form out from scratch. See below.
2. ✅ `ANALYZE_RESUME_SKILLS` call + checklist panel state — built, pending
   live-test against a real JD (see below).
3. ⬜ `TAILOR_RESUME` call with hard constraints, verified (before/after JSON
   diff) that it never fabricates experience. Currently stubbed — see below.
4. ⬜ HTML render + one-page enforcement + PDF download (generic layout
   first, real visual spec to follow later).
5. ⬜ Filename inference from `sourceFilename`'s naming pattern.

### Step 1b — auto-extraction ("Call 0") (done, not yet live-tested)

- New top card in the Resume Tailoring section, above Basics: "Auto-extract
  from resume" — a `.pdf` file input plus a paste-text `<textarea>` fallback,
  and an Extract button (`rjExtractBtn`/`rjExtractStatus`).
- **PDF text extraction happens client-side in the popup**, not sent to the
  backend as a binary: `extractPdfText()` in `popup.js` dynamically imports
  bundled `pdfjs/pdf.min.mjs` (`import(chrome.runtime.getURL(...))`,  works
  as a dynamic `import()` expression even though `popup.js` itself is a
  classic, non-module script) and walks every page's `getTextContent()`,
  joining item strings with spaces and pages with blank lines. Only plain
  text extraction is used (no canvas/rendering), so no canvas polyfill was
  needed.
- **pdf.js is bundled locally** under `pdfjs/pdf.min.mjs` +
  `pdfjs/pdf.worker.min.mjs` (npm `pdfjs-dist@6.1.200`, the `build/` ESM
  output — this version only ships `.mjs`, no classic UMD build, which is
  fine since Chrome extension pages support `<script type="module">` /
  dynamic `import()` natively) — same "no remote code" rule as
  `jspdf.umd.min.js`. `pdfjsLib.GlobalWorkerOptions.workerSrc` is pointed at
  `chrome.runtime.getURL("pdfjs/pdf.worker.min.mjs")`; no
  `web_accessible_resources` entry was needed in `manifest.json` because the
  popup is an extension page loading an extension-local resource, not a web
  page reaching into the extension.
- New `EXTRACT_RESUME` message in `background.js`: sends the raw resume text
  (from either the PDF or the paste box) to Claude (`claude-sonnet-4-6`, no
  web search tool — this call doesn't need it) with a system prompt whose
  single hard rule is **extraction only, never rewrite/improve/embellish
  wording** — enforced with a bad-example/good-example pair, same structural
  approach as the cover letter's `<letter>`-tag rule and the planned "never
  invent an experience entry" rule for step 3. Output is wrapped in
  `<resume_json>...</resume_json>`, parsed with the same
  tag-match-else-fall-back-to-full-text pattern as `<letter>`, then
  `JSON.parse`'d **inside the service worker** before being returned to the
  popup — a JSON parse failure returns a clear user-facing error
  ("try again, or paste text instead of uploading the PDF") rather than
  corrupting the form with garbage.
- The result is **not auto-saved** — `applyResumeJsonToForm()` (the same
  function the JSON-import escape hatch uses) populates the step-1 form
  fields so the user can review/correct before clicking the existing
  "Save structured resume" button. This is deliberate: multi-column/tabular
  source PDFs are the likely failure point (text extracted from PDF.js loses
  column structure and can interleave lines from side-by-side columns), so
  the extraction step is explicitly a draft, not a direct write to storage.
- `sourceFilename` is auto-filled from the uploaded file's actual filename
  only if Claude's extraction left it blank and a file (not paste) was used;
  otherwise the manual `rjSourceFilename` field from step 1 still applies.
- No `manifest.json` changes were needed: no new permissions, no new
  `host_permissions` (reuses the existing `api.anthropic.com` entry), no
  `web_accessible_resources`.
- **Not yet live-tested** — pending user review of: a real single-column PDF,
  a real multi-column/tabular PDF (expected weak point), the paste-only
  path, and the empty-API-key / empty-resume-text error messages.

### Step 1 — `resumeJson` schema + popup UI (done)

- New `chrome.storage.local` key **`resumeJson`**, entirely separate from the
  cover letter's plain-text `resumeText`/`extraContext`/`yourName`/
  `githubUsername`/`apiKey` fields — different consumer, deliberately not
  merged, so the cover letter path is untouched. Schema:
  ```json
  {
    "name": "",
    "contact": { "email": "", "phone": "", "location": "", "linkedin": "", "github": "", "portfolio": "" },
    "summary": "",
    "skills": ["..."],
    "experience": [{ "title": "", "org": "", "location": "", "dates": "", "bullets": ["..."] }],
    "projects": [{ "name": "", "dates": "", "bullets": ["..."] }],
    "education": { "school": "", "degree": "", "dates": "", "details": "" },
    "sourceFilename": ""
  }
  ```
  `sourceFilename` is just a string (e.g. `Subbu_Rayudu_Resume_DA.pdf`) for
  the future filename-inference step (step 5) to parse a naming pattern from
  — not the actual file.
- `popup.html` gained a second top-level section ("Resume Tailoring") below
  the existing cover-letter Save row, with its own card-per-section layout
  (Basics/contact, Summary, Skills, Experience, Projects, Education, Source
  filename) and its own Save button (`rjSaveBtn`/`rjSavedMsg`) — saves only
  `resumeJson`, independent of the cover-letter Save button.
- Built **field-by-field** (not raw-JSON-only) per the user's stated
  preference, with a JSON-import `<details>` escape hatch
  (`rjImportJson`/`rjImportBtn`/`rjImportError`) that parses pasted JSON and
  overwrites the form fields (`applyResumeJsonToForm`) — invalid JSON shows
  an inline error, never a silent failure or `alert()`.
- Experience/project entries are dynamic repeatable rows
  (`makeExperienceEntry`/`makeProjectEntry`, add via `rjAddExperience`/
  `rjAddProjectBtn`, remove via a per-row Remove button); bullets are entered
  one-per-line in a textarea and split/joined on `\n` when
  collecting/rendering (`collectExperience`/`collectProjects`).
- Not yet live-tested end-to-end (add entry → save → reload popup → confirm
  persistence, plus the JSON-import path) — pending user review before
  step 2.

### Step 2 — `ANALYZE_RESUME_SKILLS` + checklist panel state (done, not yet live-tested)

- **Second, independent floating button** in `content.js`'s injected Shadow
  DOM UI: "🧩 Tailor Resume" (`.fab.resume-fab`), stacked above the existing
  "✍️ Generate Cover Letter" button inside a new `.fab-stack` flex container.
  `buildUI()` was split into `buildCoverLetterWrapper(stack)` and
  `buildResumeTailorWrapper(stack)` — two separate fab+panel pairs, each with
  its own click handler, its own `panel.dataset.started` guard, and its own
  entry point into the state machine (`runGenerationFlow` vs.
  `runResumeTailorFlow`). Neither button's handler branches into the other's;
  they only share generic, container-agnostic render helpers
  (`renderLoading`, `renderError`, `renderManualPasteFallback`,
  `escapeHtml`) that were parameterized (loading messages array; an
  `onRetry`/`onRerun`/`onSubmit` callback) specifically so both flows could
  reuse the rendering without coupling their control flow.
- New resume-tailoring state machine in `content.js`: idle → loading
  (`renderLoading` with `RESUME_ANALYSIS_LOADING_MESSAGES`) → **checklist**
  (new — `renderChecklist`, the first state in either panel that pauses for
  user input mid-flow rather than just showing progress) → a stub terminal
  state (`renderTailorNotBuiltYet` — this replaces the "loading → success"
  half of the flow until step 3 is built; see below) or `renderNoNewSkills`
  when the analysis returns an empty array (JD requires nothing the resume
  doesn't already have — skips the checklist entirely rather than rendering
  an empty one).
- `renderChecklist(container, skills, onContinue)` renders one row per
  returned skill: a pre-checked checkbox, the skill name, a one-line
  `reason` as helper text, and — when `hasAdjacentEvidence === false` — a
  visible "no evidence found" marker (red pill, `.risk-marker`) next to the
  skill name. The marker is informational only, never disables the checkbox
  or blocks Continue. "Continue" collects the checked subset and hands it to
  `onContinue`.
- New `ANALYZE_RESUME_SKILLS` message in `background.js`:
  `analyzeResumeSkills({ jobDescriptionText })` reads `apiKey` and
  `resumeJson` from storage (not just `resumeJson.skills` — the model also
  needs `resumeJson.experience`/`resumeJson.projects` bullets, flattened by
  `collectResumeBullets()`, to judge `hasAdjacentEvidence`; sending only the
  skills array wouldn't be enough information for that judgment). Calls
  `claude-sonnet-4-6` with no web search tool (not needed for this
  analysis). System prompt: extract ATS-relevant technical skills/keywords
  from the JD, skip anything already on `resumeJson.skills` (including close
  synonyms), one-sentence reason per remaining skill, `hasAdjacentEvidence`
  boolean per skill, empty array if there's no gap. Output wrapped in
  `<analysis_json>[...]</analysis_json>`, parsed with the same
  tag-match-else-fallback pattern as `<letter>`/`<resume_json>`, then
  `JSON.parse`'d in the service worker with the same clear-error-not-
  corrupted-state handling as `EXTRACT_RESUME` (checks `Array.isArray`
  too, not just that it parsed).
- **`TAILOR_RESUME` (step 3) is deliberately stubbed, not built**: the
  checklist's "Continue" handler in `runResumeAnalysisWithDescription`
  currently just `console.log`s the approved skills array and renders
  `renderTailorNotBuiltYet()`, a plain "here's what was approved, this is as
  far as this flow goes for now" terminal screen with a "Start Over" button.
  When step 3 is built, this stub is what gets replaced with the real
  `TAILOR_RESUME` call (which will need its own loading state before
  landing on a real success/error state).
- **Not yet live-tested** — pending: a real JD with a real gap (checklist
  renders correctly, checkboxes/reasons/risk markers all correct), a JD with
  no gap (empty-array path → `renderNoNewSkills`), and the manual-paste
  fallback path for a JD-light page.

### Planned design decisions for later steps (recorded now so they survive a cold pickup)

- **Keyword density is the opposite dial from the cover letter prompt, on
  purpose.** Cover letter: 1-2 mirrored JD terms max (sounds like a person,
  not an ATS-stuffed doc). Resume tailoring (step 3): primary JD keywords
  should land 2-3 times across the resume in different phrasing/context, not
  verbatim repetition — resumes get ATS-parsed before a human ever reads
  them, so the goals genuinely differ. When writing the `TAILOR_RESUME`
  system prompt, note this inline as a code comment so a future session
  doesn't "fix" it into consistency with the cover letter prompt.
- **No new experience/project entries, ever** is the single most important
  rule for step 3's system prompt — plan to state it the same structural way
  the `<letter>` tag rule works (a bad-example/good-example pair, not just a
  stated rule), backed by the same "wrap output in tags, discard everything
  else" pattern: `<analysis_json>` for step 2's output, `<resume_json>` for
  step 3's, both with the same fallback-to-full-text-if-tags-missing
  behavior as `<letter>` in `background.js`.
- Step 4 will use `html2pdf.js` bundled locally (no CDN, per the existing
  "no remote code" constraint) — reserved for the resume-tailoring PDF only;
  `jspdf.umd.min.js` stays dedicated to the cover letter path, not cross-wired.
- One-page enforcement order matters: LLM compression pass first ("tighten
  by ~15%, keep keywords and the specific metric"), only reduce
  font-size/line-height as a last resort, floor at 10pt.

## Files

- `manifest.json` — MV3 manifest. Permissions: storage, activeTab,
  scripting. Host permissions: `*.joinhandshake.com`, `api.anthropic.com`,
  `api.github.com`.
- `jspdf.umd.min.js` — jsPDF bundled locally (not CDN-loaded), loaded before
  `content.js` in content_scripts so `window.jspdf` is available. Dedicated
  to the cover letter PDF path — the resume tailoring feature's PDF output
  (step 4, not yet built) will use `html2pdf.js` instead, kept separate per
  the plan in the Resume Tailoring section below.
- `pdfjs/pdf.min.mjs` / `pdfjs/pdf.worker.min.mjs` — pdf.js bundled locally
  (`pdfjs-dist@6.1.200`, ESM build, not CDN-loaded), dynamically imported
  from `popup.js` to extract text from an uploaded resume PDF client-side
  before sending the plain text to `background.js` for structuring. See
  "Step 1b — auto-extraction" below.
- `background.js` — service worker. Handles `GENERATE_COVER_LETTER`
  messages:
  - If a GitHub username is stored, `fetchGithubReposBlock()` fetches the
    user's public repos (unauthenticated, 60 req/hr limit), filters out
    forks and repos with no description, ranks the top 8 by a
    recency-weighted score (pushed_at dominant, small star bonus), and
    builds a compact `<github_repos>` text block (name, description,
    language, topics, last-updated date — no README fetches). Any fetch
    failure or rate-limit is swallowed silently so it never blocks letter
    generation.
  - Calls `https://api.anthropic.com/v1/messages` (model
    `claude-sonnet-4-6`, web_search tool enabled) with `<job_title>`,
    `<company_name>`, `<job_description>`, `<resume>`, `<extra_context>`,
    and `<github_repos>` blocks in the user message.
  - System prompt instructs the model to wrap only the finished letter in
    `<letter></letter>` tags (any reasoning goes outside them). Response
    parsing extracts via `fullText.match(/<letter>([\s\S]*?)<\/letter>/)`,
    falling back to the full concatenated text if no tags are found — this
    is what stops the model's own reasoning/preamble ("Here is the
    letter:", "The role calls for...") from leaking into the PDF.
  - Distinguishes 401 (bad key), 429 (rate limit), network failure, and
    empty-response errors with actionable messages.
- `popup.html` / `popup.js` — settings screen (name, resume, extra context,
  GitHub username, API key), persisted to `chrome.storage.local`. GitHub
  username is optional; the feature degrades gracefully when empty.
- `content.js` — runs on Handshake job pages. Extracts job title/company
  name/description with a fallback selector strategy, injects a Shadow DOM
  floating button + panel (idle → loading → success/error), builds and
  downloads the PDF via jsPDF on success.

## Selectors (content.js `SELECTORS` object)

- `jobTitle` / `jobDescription`: still placeholder CSS selectors, unverified
  against live Handshake markup — but both have working generic fallbacks
  (`document.title` for title, `largestTextBlock()` — the biggest text block
  on the page — for description), so they haven't needed fixing in practice.
- `companyName`: was a real bug (no fallback existed, so a placeholder miss
  silently produced the literal string "Company" in the PDF filename). Now
  fixed two ways, tried in order by `extractJobContext()`:
  1. `SELECTORS.companyName` — `.hBBYXe` first (confirmed live against
     `<div class="sc-fqEMiG hBBYXe">Sain Technologies</div>`). **Caveat:**
     this is a styled-components auto-generated hash class that regenerates
     on Handshake redeploys and can silently stop matching (no error, just
     a quiet reversion to "Company").
  2. `extractCompanyNameFromLink()` — parses the name out of the "Learn
     more about `<Company>`" employer link
     (`a[href^='/e/']` / `a[aria-label^='Learn more about ']`, confirmed
     against `<a href="/e/1064251" aria-label="Learn more about Sain
     Technologies" ...>`). More durable than the hash class since href
     prefixes and aria-labels change less often than styled-components
     classes.

If letters start showing "Company" again after a Handshake redeploy, this
is the first place to check — re-inspect the live company name element and
update `.hBBYXe`.

## System prompt design decisions

Current tuning (deliberate, not default assumptions):
- **One project, one metric per project as the anchor** — a second project
  is acceptable only as a brief one-sentence supporting beat under the same
  theme as the main project, never as an equal second story. Avoids reading
  like a compressed resume.
- **1-2 mirrored terms from the job description, not more** — prioritizes
  sounding like a genuine person over ATS keyword density, on the
  assumption Handshake postings are mostly read by a human early on. If a
  target employer is known to run ATS keyword filtering first, bumping to
  2-3 terms is a reasonable manual override.
- **No em dashes** — a deliberate anti-AI-tell rule.
- **`<letter>` tag wrapping** — structural (not instruction-only) fix for
  reasoning/preamble leaking into the output; see Files section above.

## Known open items

1. Error path for a cleared/invalid API key has not been live-tested (steps
   1-5 of the original testing checklist are done; step 6 — clear the
   stored key and confirm the 401 error message shows — is not).
2. GitHub project awareness has not been live-tested with a real username
   that has a mix of forked and original repos. Need to confirm: (a) forks
   are actually excluded, (b) the letter only switches to a GitHub project
   when it's a genuinely better match for the job description tested
   against, not just because it's the most recently pushed repo.

## Maintenance instruction

At the end of every working session on this project, update this CLAUDE.md
to reflect the current state: which files/features are implemented vs.
still placeholder (especially the Handshake selectors), any newly
discovered DOM structure, and any open issues. Keep this file the source of
truth for a future session picking the project back up cold.
