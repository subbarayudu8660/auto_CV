// ============================================================================
// SELECTOR CONFIG — tweak these after inspecting the live Handshake DOM.
// Each is an array of candidate CSS selectors tried in order (first match wins).
// These are placeholders; none have been verified against real markup yet.
// ============================================================================
const SELECTORS = {
  jobTitle: [
    "[data-hook='job-title']",
    "h1.job-title",
    "h1"
  ],
  companyName: [
    ".hBBYXe",
    "[data-hook='employer-name']",
    "a.employer-name",
    ".company-name"
  ],
  // Fallback for companyName: styled-components class hashes (like .hBBYXe above)
  // get regenerated on Handshake redeploys and can silently stop matching. This
  // link pattern is more durable — it targets the "Learn more about <Company>"
  // employer link by its href prefix and aria-label, parsing the name out of the
  // label text instead of relying on a class name.
  companyLink: [
    "a[href^='/e/']",
    "a[aria-label^='Learn more about ']"
  ],
  jobDescription: [
    "[data-hook='job-description']",
    ".job-description",
    "#job-description"
  ]
};

// ----------------------------------------------------------------------------
// A. Job context extraction
// ----------------------------------------------------------------------------
function queryFirstMatch(selectorList) {
  for (const sel of selectorList) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > 0) {
      return el.innerText.trim();
    }
  }
  return "";
}

function extractCompanyNameFromLink() {
  for (const sel of SELECTORS.companyLink) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const label = el.getAttribute("aria-label") || "";
    const match = label.match(/^Learn more about (.+)$/);
    if (match && match[1].trim()) return match[1].trim();
  }
  return "";
}

function largestTextBlock() {
  const candidates = Array.from(
    document.querySelectorAll("main, [role='main'], body > div")
  );
  let best = "";
  for (const el of candidates) {
    const text = (el.innerText || "").trim();
    if (text.length > best.length) best = text;
  }
  return best;
}

function extractJobContext() {
  let jobTitle = queryFirstMatch(SELECTORS.jobTitle);
  let companyName = queryFirstMatch(SELECTORS.companyName);
  let jobDescriptionText = queryFirstMatch(SELECTORS.jobDescription);

  if (!companyName) {
    companyName = extractCompanyNameFromLink();
  }
  if (!jobTitle) {
    jobTitle = document.title.split("|")[0].trim();
  }
  if (!jobDescriptionText || jobDescriptionText.length < 100) {
    jobDescriptionText = largestTextBlock();
  }

  return { jobTitle, companyName, jobDescriptionText };
}

// ----------------------------------------------------------------------------
// B. Injected UI (Shadow DOM)
// ----------------------------------------------------------------------------
function buildUI() {
  const host = document.createElement("div");
  host.id = "hs-cover-letter-host";
  host.style.position = "fixed";
  host.style.bottom = "20px";
  host.style.right = "20px";
  host.style.zIndex = "999999";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .fab {
      background: #3a5a48;
      color: #fff;
      border: none;
      border-radius: 24px;
      padding: 12px 18px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
    }
    .fab:hover { background: #2d4738; }
    .panel {
      display: none;
      position: absolute;
      bottom: 54px;
      right: 0;
      width: 320px;
      background: #fffdf9;
      border: 1px solid #e2dbc9;
      border-radius: 10px;
      box-shadow: 0 4px 18px rgba(0,0,0,0.2);
      padding: 16px;
      color: #2c2a24;
    }
    .panel.open { display: block; }
    .panel h2 {
      font-size: 14px;
      margin: 0 0 8px;
    }
    .status { font-size: 13px; color: #7a7566; margin-bottom: 10px; }
    .error-msg { font-size: 12.5px; color: #a33; margin-bottom: 10px; line-height: 1.4; }
    .filename { font-size: 12.5px; color: #2c2a24; margin-bottom: 10px; word-break: break-all; }
    textarea.manual-paste {
      width: 100%;
      min-height: 100px;
      font-size: 12px;
      border: 1px solid #e2dbc9;
      border-radius: 6px;
      padding: 8px;
      margin-bottom: 8px;
    }
    button.action-btn {
      background: #3a5a48;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      margin-right: 6px;
    }
    button.action-btn:hover { background: #2d4738; }
    button.secondary-btn {
      background: #eee7d8;
      color: #2c2a24;
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
    }
    button.secondary-btn:hover { background: #e2dbc9; }
    .fab-stack {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
    }
    .fab.resume-fab { background: #46467a; }
    .fab.resume-fab:hover { background: #35355e; }
    .checklist {
      max-height: 220px;
      overflow-y: auto;
      margin-bottom: 10px;
      padding-right: 2px;
    }
    .checklist-item {
      border-bottom: 1px solid #e2dbc9;
      padding: 8px 0;
    }
    .checklist-item:last-child { border-bottom: none; }
    .checklist-item .checkbox-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .checklist-item input[type="checkbox"] {
      margin-top: 2px;
    }
    .checklist-item .skill-name {
      font-size: 13px;
      font-weight: 600;
    }
    .checklist-item .reason {
      font-size: 11.5px;
      color: #7a7566;
      margin: 2px 0 0 22px;
      line-height: 1.35;
    }
    .checklist-item .risk-marker {
      display: inline-block;
      font-size: 10.5px;
      font-weight: 700;
      color: #a33;
      background: #fbeaea;
      border-radius: 4px;
      padding: 1px 5px;
      margin-left: 6px;
      vertical-align: middle;
    }
  `;
  shadow.appendChild(style);

  const stack = document.createElement("div");
  stack.className = "fab-stack";

  const resumeBody = buildResumeTailorWrapper(stack);
  const coverLetterBody = buildCoverLetterWrapper(stack);

  shadow.appendChild(stack);

  return { coverLetterBody, resumeBody };
}

function buildCoverLetterWrapper(stack) {
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";

  const fab = document.createElement("button");
  fab.className = "fab";
  fab.textContent = "✍️ Generate Cover Letter";

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `<h2>Cover Letter</h2><div class="body"></div>`;

  wrapper.appendChild(fab);
  wrapper.appendChild(panel);
  stack.appendChild(wrapper);

  fab.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open") && !panel.dataset.started) {
      panel.dataset.started = "true";
      runGenerationFlow(panel.querySelector(".body"));
    }
  });

  return panel.querySelector(".body");
}

function buildResumeTailorWrapper(stack) {
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";

  const fab = document.createElement("button");
  fab.className = "fab resume-fab";
  fab.textContent = "🧩 Tailor Resume";

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `<h2>Resume Tailoring</h2><div class="body"></div>`;

  wrapper.appendChild(fab);
  wrapper.appendChild(panel);
  stack.appendChild(wrapper);

  fab.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open") && !panel.dataset.started) {
      panel.dataset.started = "true";
      runResumeTailorFlow(panel.querySelector(".body"));
    }
  });

  return panel.querySelector(".body");
}

const LOADING_MESSAGES = [
  "Reading the job posting...",
  "Cross-referencing your resume...",
  "Searching for company context...",
  "Drafting the opening line...",
  "Polishing the letter..."
];

function renderLoading(container, messages = LOADING_MESSAGES) {
  container.innerHTML = `<div class="status" id="loading-status">${messages[0]}</div>`;
  let i = 0;
  const statusEl = container.querySelector("#loading-status");
  const interval = setInterval(() => {
    i = (i + 1) % messages.length;
    if (statusEl.isConnected) {
      statusEl.textContent = messages[i];
    } else {
      clearInterval(interval);
    }
  }, 1800);
  return () => clearInterval(interval);
}

function renderError(container, message, onRetry) {
  container.innerHTML = `
    <div class="error-msg">${escapeHtml(message)}</div>
    <div class="error-msg">If this is a settings issue, open the extension popup to check your saved API key or resume.</div>
    <button class="action-btn" id="retry-btn">Try Again</button>
  `;
  container.querySelector("#retry-btn").addEventListener("click", () => onRetry(container));
}

function renderManualPasteFallback(container, onSubmit) {
  container.innerHTML = `
    <div class="error-msg">Couldn't find enough job description text on this page automatically.</div>
    <textarea class="manual-paste" placeholder="Paste the job description text here..."></textarea>
    <button class="action-btn" id="manual-submit-btn">Use This Text</button>
  `;
  container.querySelector("#manual-submit-btn").addEventListener("click", () => {
    const text = container.querySelector(".manual-paste").value.trim();
    if (text.length < 50) return;
    onSubmit(text);
  });
}

function renderSuccess(container, filename, letterText) {
  container.innerHTML = `
    <div class="status">Downloaded:</div>
    <div class="filename">${escapeHtml(filename)}</div>
    <button class="action-btn" id="regenerate-btn">Regenerate</button>
    <button class="secondary-btn" id="copy-btn">Copy Text</button>
  `;
  container.querySelector("#regenerate-btn").addEventListener("click", () => runGenerationFlow(container));
  container.querySelector("#copy-btn").addEventListener("click", async () => {
    await navigator.clipboard.writeText(letterText);
    const btn = container.querySelector("#copy-btn");
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = original), 1400);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ----------------------------------------------------------------------------
// C. Generation + PDF flow
// ----------------------------------------------------------------------------
function sanitizeCompanyName(name) {
  return (name || "Company")
    .replace(/[&/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .trim() || "Company";
}

async function buildAndDownloadPdf({ letterText, companyName, jobTitle }) {
  const stored = await chrome.storage.local.get(["yourName"]);
  const yourName = (stored.yourName || "Candidate").trim();
  const nameForFilename = yourName.replace(/\s+/g, "");
  const companyForFilename = sanitizeCompanyName(companyName);
  const filename = `${nameForFilename}_CoverLetter_${companyForFilename}.pdf`;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "in", format: "letter" });

  const marginLeft = 0.75;
  const marginTop = 0.75;
  const marginRight = 0.75;
  const pageWidth = 8.5;
  const usableWidth = pageWidth - marginLeft - marginRight;

  let cursorY = marginTop;

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(11);
  doc.text(yourName, marginLeft, cursorY);
  cursorY += 0.22;

  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  doc.text(dateStr, marginLeft, cursorY);
  cursorY += 0.35;

  doc.setFontSize(11);
  const lines = doc.splitTextToSize(letterText, usableWidth);
  const lineHeight = 0.22;
  for (const line of lines) {
    if (cursorY > 10.5) {
      doc.addPage();
      cursorY = marginTop;
    }
    doc.text(line, marginLeft, cursorY);
    cursorY += lineHeight;
  }

  doc.save(filename);
  return filename;
}

// Client-side safety net: background.js's own API-call timeouts (see
// WEB_SEARCH_TIMEOUT_MS/API_TIMEOUT_MS there) should always produce a real
// error response before this fires. This is only a backstop for the case
// those timeouts don't cover — e.g. the MV3 service worker itself getting
// terminated mid-request, which can silently drop the message port instead
// of ever calling sendResponse. Without this, the panel would sit in
// renderLoading()'s cycling-messages state forever with no way out.
const SAFETY_NET_TIMEOUT_MS = 65000; // background ceiling (55s) + buffer

function sendMessageWithSafetyNet(message, timeoutErrorText) {
  return new Promise((resolve) => {
    let settled = false;

    const safetyTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ success: false, error: timeoutErrorText });
    }, SAFETY_NET_TIMEOUT_MS);

    chrome.runtime.sendMessage(message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      resolve(response);
    });
  });
}

function requestGeneration({ jobTitle, companyName, jobDescriptionText }) {
  return sendMessageWithSafetyNet(
    { type: "GENERATE_COVER_LETTER", jobTitle, companyName, jobDescriptionText },
    "Didn't hear back in time. This can happen if the background process was interrupted — try again."
  );
}

async function runGenerationFlow(container) {
  const { jobTitle, companyName, jobDescriptionText } = extractJobContext();

  if (!jobDescriptionText || jobDescriptionText.length < 100) {
    renderManualPasteFallback(container, async (manualText) => {
      await runGenerationFlowWithDescription(container, jobTitle, companyName, manualText);
    });
    return;
  }

  await runGenerationFlowWithDescription(container, jobTitle, companyName, jobDescriptionText);
}

async function runGenerationFlowWithDescription(container, jobTitle, companyName, jobDescriptionText) {
  const stopLoading = renderLoading(container);

  const response = await requestGeneration({ jobTitle, companyName, jobDescriptionText });
  stopLoading();

  if (!response || !response.success) {
    renderError(container, response?.error || "Something went wrong generating the letter.", runGenerationFlow);
    return;
  }

  try {
    const filename = await buildAndDownloadPdf(response);
    renderSuccess(container, filename, response.letterText);
  } catch (err) {
    renderError(container, `Failed to build the PDF: ${err.message}`, runGenerationFlow);
  }
}

// ----------------------------------------------------------------------------
// D. Resume Tailoring flow (separate button, separate state, independent of
// the cover letter flow above — shares only the generic renderLoading/
// renderError/renderManualPasteFallback helpers, which just render into
// whatever container they're given).
// ----------------------------------------------------------------------------
const RESUME_ANALYSIS_LOADING_MESSAGES = [
  "Reading the job posting...",
  "Comparing it against your resume's skills...",
  "Checking which skills have supporting evidence..."
];

function renderNoNewSkills(container, onRerun) {
  container.innerHTML = `
    <div class="status">Your resume already covers the skills this job description asks for. No new skills to add.</div>
    <button class="secondary-btn" id="rerun-btn">Re-check</button>
  `;
  container.querySelector("#rerun-btn").addEventListener("click", () => onRerun(container));
}

function renderChecklist(container, skills, onContinue) {
  const itemsHtml = skills
    .map((s, i) => {
      const riskMarker = s.hasAdjacentEvidence === false
        ? `<span class="risk-marker" title="No supporting bullet found elsewhere in your resume">no evidence found</span>`
        : "";
      return `
        <div class="checklist-item">
          <div class="checkbox-row">
            <input type="checkbox" id="skill-${i}" checked />
            <label for="skill-${i}"><span class="skill-name">${escapeHtml(s.skill)}</span>${riskMarker}</label>
          </div>
          <div class="reason">${escapeHtml(s.reason || "")}</div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="status">Skills this job description asks for that aren't on your resume yet — uncheck any you don't want added:</div>
    <div class="checklist">${itemsHtml}</div>
    <button class="action-btn" id="checklist-continue-btn">Continue</button>
  `;

  container.querySelector("#checklist-continue-btn").addEventListener("click", () => {
    const approved = skills.filter((_, i) => container.querySelector(`#skill-${i}`).checked);
    onContinue(approved);
  });
}

function renderResumeDownloadSuccess(container, filename, onRestart) {
  container.innerHTML = `
    <div class="status">Downloaded:</div>
    <div class="filename">${escapeHtml(filename)}</div>
    <button class="secondary-btn" id="resume-restart-btn">Start Over</button>
  `;
  container.querySelector("#resume-restart-btn").addEventListener("click", () => onRestart(container));
}

function requestResumeAnalysis({ jobDescriptionText }) {
  return sendMessageWithSafetyNet(
    { type: "ANALYZE_RESUME_SKILLS", jobDescriptionText },
    "Didn't hear back in time. This can happen if the background process was interrupted — try again."
  );
}

async function runResumeTailorFlow(container) {
  const { jobDescriptionText } = extractJobContext();

  if (!jobDescriptionText || jobDescriptionText.length < 100) {
    renderManualPasteFallback(container, async (manualText) => {
      await runResumeAnalysisWithDescription(container, manualText);
    });
    return;
  }

  await runResumeAnalysisWithDescription(container, jobDescriptionText);
}

async function runResumeAnalysisWithDescription(container, jobDescriptionText) {
  const stopLoading = renderLoading(container, RESUME_ANALYSIS_LOADING_MESSAGES);

  const response = await requestResumeAnalysis({ jobDescriptionText });
  stopLoading();

  if (!response || !response.success) {
    renderError(container, response?.error || "Something went wrong analyzing the job description.", runResumeTailorFlow);
    return;
  }

  const skills = Array.isArray(response.skills) ? response.skills : [];

  if (skills.length === 0) {
    renderNoNewSkills(container, runResumeTailorFlow);
    return;
  }

  renderChecklist(container, skills, (approvedSkills) => {
    runTailorResumeFlow(container, jobDescriptionText, approvedSkills);
  });
}

// ----------------------------------------------------------------------------
// E. Tailored resume render + one-page PDF (this feature's own path — does
// not touch jspdf.umd.min.js's usage above in buildAndDownloadPdf(), which
// stays dedicated to the cover letter; this uses its own separate jsPDF
// document instance).
//
// NOTE — tried and reverted: this used to render via html2pdf.js (which
// screenshots a cloned DOM element through html2canvas). On Handshake that
// clone-into-a-hidden-iframe approach triggers the PAGE'S OWN CSP against
// loading Handshake's own <script> tags inside the clone, which silently
// fails the render and produces a blank PDF — a structural incompatibility
// with any CSP-restrictive host page, not a config bug. Fixed by drawing the
// resume directly with jsPDF's vector text/line APIs instead (no DOM clone,
// no iframe, no script loading — sidesteps the CSP entirely, and produces
// sharp vector text instead of a raster image, which is also better for ATS
// parsing). See CLAUDE.md for the full writeup. html2pdf.js/html2canvas is
// no longer a dependency of this feature.
// ----------------------------------------------------------------------------
const TAILOR_LOADING_MESSAGES = [
  "Reading the job description...",
  "Weaving in relevant keywords...",
  "Making sure it still fits one page..."
];

// Letter page in points (jsPDF's font-size unit), so page math and font math
// share one unit — no px<->pt conversion to keep in sync. 1in = 72pt.
const PDF_PAGE_WIDTH_PT = 612; // 8.5in
const PDF_PAGE_HEIGHT_PT = 792; // 11in
const PDF_MARGIN_PT = 36; // 0.5in
const PDF_CONTENT_WIDTH_PT = PDF_PAGE_WIDTH_PT - PDF_MARGIN_PT * 2;
const PDF_BOTTOM_Y_PT = PDF_PAGE_HEIGHT_PT - PDF_MARGIN_PT;
const RESUME_FONT_FLOOR_PT = 10;

function requestTailorResume({ jobDescriptionText, approvedSkills }) {
  return sendMessageWithSafetyNet(
    { type: "TAILOR_RESUME", jobDescriptionText, approvedSkills },
    "Didn't hear back in time. This can happen if the background process was interrupted — try again."
  );
}

function requestCompressResume({ resumeJson }) {
  return sendMessageWithSafetyNet(
    { type: "COMPRESS_RESUME", resumeJson },
    "Didn't hear back in time while tightening the resume to fit one page — try again."
  );
}

// Draws the resume into a fresh jsPDF document and reports whether the
// cursor ran past the bottom margin (the one-page overflow check —
// jsPDF has no rendered DOM to measure, so this tracks cursor position
// instead of scrollHeight). Generic single-column ATS-safe layout — no
// tables, no icons, no columns. There's no real visual spec to match yet;
// this is a placeholder to replace once one is provided (see CLAUDE.md).
function drawResumePdf(resumeJson, fontSizePt) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const smallPt = Math.max(fontSizePt - 1, RESUME_FONT_FLOOR_PT - 1);
  let cursorY = PDF_MARGIN_PT;

  function addWrappedText(text, size, style = "normal") {
    doc.setFont("Helvetica", style);
    doc.setFontSize(size);
    doc.splitTextToSize(text, PDF_CONTENT_WIDTH_PT).forEach((line) => {
      doc.text(line, PDF_MARGIN_PT, cursorY);
      cursorY += size * 1.3;
    });
  }

  function addBullets(bullets, size) {
    const indent = 12;
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(size);
    (bullets || []).forEach((bullet) => {
      const lines = doc.splitTextToSize(`• ${bullet}`, PDF_CONTENT_WIDTH_PT - indent);
      lines.forEach((line, i) => {
        doc.text(line, PDF_MARGIN_PT + (i === 0 ? 0 : indent), cursorY);
        cursorY += size * 1.3;
      });
    });
  }

  function addSectionHeading(title) {
    cursorY += 6;
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(fontSizePt);
    doc.text(title.toUpperCase(), PDF_MARGIN_PT, cursorY);
    cursorY += 3;
    doc.setLineWidth(0.75);
    doc.line(PDF_MARGIN_PT, cursorY, PDF_MARGIN_PT + PDF_CONTENT_WIDTH_PT, cursorY);
    cursorY += fontSizePt;
  }

  function addEntryHeadingRow(leftText, rightText, size) {
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(size);
    doc.text(leftText, PDF_MARGIN_PT, cursorY);
    if (rightText) {
      doc.setFont("Helvetica", "normal");
      doc.text(rightText, PDF_MARGIN_PT + PDF_CONTENT_WIDTH_PT, cursorY, { align: "right" });
    }
    cursorY += size * 1.3;
  }

  // Header: name + contact line, centered.
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(fontSizePt + 6);
  doc.text(resumeJson.name || "", PDF_PAGE_WIDTH_PT / 2, cursorY, { align: "center" });
  cursorY += (fontSizePt + 6) * 1.2;

  const contact = resumeJson.contact || {};
  const contactLine = [contact.email, contact.phone, contact.location, contact.linkedin, contact.github, contact.portfolio]
    .filter(Boolean)
    .join("   |   ");
  if (contactLine) {
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(smallPt);
    doc.text(contactLine, PDF_PAGE_WIDTH_PT / 2, cursorY, { align: "center" });
    cursorY += smallPt * 1.3;
  }

  if (resumeJson.summary) {
    addSectionHeading("Summary");
    addWrappedText(resumeJson.summary, fontSizePt);
  }

  if (Array.isArray(resumeJson.skills) && resumeJson.skills.length) {
    addSectionHeading("Skills");
    addWrappedText(resumeJson.skills.join(", "), fontSizePt);
  }

  if (Array.isArray(resumeJson.experience) && resumeJson.experience.length) {
    addSectionHeading("Experience");
    resumeJson.experience.forEach((entry) => {
      const titleLine = [entry.title, entry.org].filter(Boolean).join(", ");
      addEntryHeadingRow(titleLine, entry.dates || "", fontSizePt);
      if (entry.location) {
        doc.setFont("Helvetica", "italic");
        doc.setFontSize(smallPt);
        doc.text(entry.location, PDF_MARGIN_PT, cursorY);
        cursorY += smallPt * 1.3;
      }
      addBullets(entry.bullets, fontSizePt);
      cursorY += 4;
    });
  }

  if (Array.isArray(resumeJson.projects) && resumeJson.projects.length) {
    addSectionHeading("Projects");
    resumeJson.projects.forEach((entry) => {
      addEntryHeadingRow(entry.name || "", entry.dates || "", fontSizePt);
      addBullets(entry.bullets, fontSizePt);
      cursorY += 4;
    });
  }

  const edu = resumeJson.education;
  if (edu && (edu.school || edu.degree)) {
    addSectionHeading("Education");
    const eduLine = [edu.school, edu.degree].filter(Boolean).join(", ");
    addEntryHeadingRow(eduLine, edu.dates || "", fontSizePt);
    if (edu.details) {
      addWrappedText(edu.details, fontSizePt);
    }
  }

  return { doc, overflowed: cursorY > PDF_BOTTOM_Y_PT };
}

// One-page enforcement order: LLM compression pass first (preserves content,
// just tightens wording), only reduce font-size as a last resort, floor at
// 10pt. Never drops content on its own — if still overflowing at the floor,
// this returns fits:false and the caller proceeds anyway (best effort; there
// is no further lever that doesn't mean fabricating a shorter resume — any
// remaining overflow just extends past the bottom margin in the saved PDF).
async function fitResumeToOnePage(resumeJson, statusCallback) {
  let currentJson = resumeJson;
  let fontSizePt = 11;

  let { doc, overflowed } = drawResumePdf(currentJson, fontSizePt);

  if (overflowed) {
    if (statusCallback) statusCallback("Tightening bullets to fit one page...");
    const compressResponse = await requestCompressResume({ resumeJson: currentJson });
    if (compressResponse && compressResponse.success) {
      currentJson = compressResponse.resumeJson;
    }
    ({ doc, overflowed } = drawResumePdf(currentJson, fontSizePt));
  }

  while (overflowed && fontSizePt > RESUME_FONT_FLOOR_PT) {
    fontSizePt -= 0.5;
    ({ doc, overflowed } = drawResumePdf(currentJson, fontSizePt));
  }

  return { doc, resumeJson: currentJson, fits: !overflowed };
}

// Simple suffix on the source filename's own extension — full naming-pattern
// inference (step 5) is a separate, later step. Confirmed correct from
// testing — kept exactly as-is.
function buildTailoredFilename(sourceFilename) {
  if (!sourceFilename) return "Tailored_Resume.pdf";
  const dotIndex = sourceFilename.lastIndexOf(".");
  if (dotIndex === -1) return `${sourceFilename}_Tailored.pdf`;
  return `${sourceFilename.slice(0, dotIndex)}_Tailored${sourceFilename.slice(dotIndex)}`;
}

async function downloadTailoredResumePdf(resumeJson, statusCallback) {
  const { doc, resumeJson: finalJson } = await fitResumeToOnePage(resumeJson, statusCallback);
  const filename = buildTailoredFilename(finalJson.sourceFilename);
  doc.save(filename);
  return filename;
}

async function runTailorResumeFlow(container, jobDescriptionText, approvedSkills) {
  const stopLoading = renderLoading(container, TAILOR_LOADING_MESSAGES);

  const response = await requestTailorResume({
    jobDescriptionText,
    approvedSkills: approvedSkills.map((s) => s.skill)
  });

  if (!response || !response.success) {
    stopLoading();
    renderError(container, response?.error || "Something went wrong tailoring the resume.", runResumeTailorFlow);
    return;
  }

  try {
    const filename = await downloadTailoredResumePdf(response.resumeJson, (msg) => {
      const statusEl = container.querySelector("#loading-status");
      if (statusEl && statusEl.isConnected) statusEl.textContent = msg;
    });
    stopLoading();
    renderResumeDownloadSuccess(container, filename, runResumeTailorFlow);
  } catch (err) {
    stopLoading();
    renderError(container, `Failed to build the tailored resume PDF: ${err.message}`, runResumeTailorFlow);
  }
}

// ----------------------------------------------------------------------------
// Init
// ----------------------------------------------------------------------------
buildUI();
