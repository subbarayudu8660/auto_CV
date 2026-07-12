# Handshake Instant Cover Letter

A Chrome extension (Manifest V3) that generates a tailored, genuine-sounding
cover letter PDF from any Handshake job posting, using your saved resume and
the Claude API — downloaded and ready to drag into Handshake's upload field.

No auto-fill, no backend server, no remote code. Everything runs client-side
inside the extension; your resume, API key, and extra context never leave
your browser except as part of the direct request to Anthropic's API.

## Features

- One-time settings screen for your resume, name, extra context, and
  Anthropic API key (all stored locally via `chrome.storage.local`).
- Optional GitHub username: if set, the letter can reference a specific
  public repo instead of a resume bullet when it's a stronger match for the
  job description.
- A floating "✍️ Generate Cover Letter" button injected on Handshake job
  pages (built in a Shadow DOM so it can't collide with Handshake's styles).
- Claude (with web search) writes a specific, non-generic cover letter —
  no "I am writing to apply," no keyword stuffing, no em dashes, one real
  project told with depth instead of a resume dump.
- Downloads as `FirstLast_CoverLetter_Company.pdf`, built client-side with
  jsPDF (bundled locally, not loaded from a CDN).

## Setup

1. Get an API key from [console.anthropic.com](https://console.anthropic.com).
2. Load the extension:
   - Go to `chrome://extensions`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked** and select this folder
3. Click the extension icon in Chrome's toolbar to open the popup and fill in:
   - **Your name** — used to name the downloaded PDF
   - **Resume** — paste your full resume text, not a summary
   - **Extra context** *(optional)* — anything not on your resume worth
     mentioning
   - **GitHub username** *(optional)* — lets the letter reference a specific
     recent project if it's a stronger match than your resume
   - **Anthropic API key**
4. Click **Save**.

## Usage

1. Navigate to a job posting on `joinhandshake.com`.
2. Click the **✍️ Generate Cover Letter** button in the bottom-right corner.
3. Wait for it to generate (a few seconds — it may search the web for
   company context).
4. The PDF downloads automatically. Drag it from Chrome's download shelf
   into Handshake's cover letter upload field.
5. Not happy with the result? Click **Regenerate** in the panel, or **Copy
   Text** to grab the raw letter text.

If the job description couldn't be found automatically on the page, the
panel will offer a manual paste box as a fallback — paste the description
text in and it'll proceed from there.

## How it works

- `manifest.json` — MV3 manifest declaring permissions, host permissions,
  the background service worker, and the content script.
- `background.js` — service worker. Optionally fetches your public GitHub
  repos, then calls the Anthropic Messages API (with the web search tool) to
  generate the letter, and parses the response.
- `popup.html` / `popup.js` — the settings screen.
- `content.js` — runs on Handshake job pages: extracts the job title,
  company name, and description from the page DOM, injects the floating
  button/panel UI, and builds/downloads the PDF via jsPDF on success.
- `jspdf.umd.min.js` — jsPDF, bundled locally so no code is loaded remotely
  at runtime (required for Manifest V3 compliance).

See `CLAUDE.md` for implementation details, known caveats, and maintenance
notes.

## Privacy

Your resume, extra context, GitHub username, and API key are stored only in
`chrome.storage.local` on your machine. The only network calls this
extension makes are:
- `https://api.anthropic.com/v1/messages` — to generate the letter (your
  resume, the job description, and your API key are sent here)
- `https://api.github.com/users/<username>/repos` — only if you've set a
  GitHub username, to list your public repos (no authentication, no private
  data)

Nothing is sent to any other server.
# auto_CV
