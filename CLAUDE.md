# Handshake Instant Cover Letter — Project Notes

MV3 Chrome extension. Generates a tailored cover letter PDF from a Handshake
job posting using a saved resume + the Claude API, downloaded ready to drag
into Handshake's upload field. No auto-fill, no backend, no remote code.
See `README.md` for user-facing setup/usage instructions.

**Status: feature-complete and live-tested end to end** on a real Handshake
posting (load unpacked → popup settings persistence → generate → PDF
download → verified formatting). Remaining open items are listed below.

## Resume Tailoring feature (in progress)

New capability being added alongside the existing cover-letter generator, same
extension/popup. Full spec: analyze the JD (reusing `extractJobContext()` from
`content.js` — no re-scraping) against a *structured* resume, checklist of
missing JD-relevant skills for the user to approve, then an LLM rewrite pass
that only edits existing bullets/skills (never adds new experience/project
entries), rendered to a one-page PDF matching the current resume's layout.

**Status: step 1 of 5 done, live-tested pending user review. Steps 2-5 not
started.**

Build order (per session plan, do not reorder):
1. ✅ `resumeJson` storage schema + popup UI to input/edit it.
2. ⬜ `ANALYZE_RESUME_SKILLS` call + checklist panel state, tested against a
   real JD.
3. ⬜ `TAILOR_RESUME` call with hard constraints, verified (before/after JSON
   diff) that it never fabricates experience.
4. ⬜ HTML render + one-page enforcement + PDF download (generic layout
   first, real visual spec to follow later).
5. ⬜ Filename inference from `sourceFilename`'s naming pattern.

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
  `content.js` in content_scripts so `window.jspdf` is available.
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
