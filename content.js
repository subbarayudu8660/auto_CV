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
// not touch jspdf.umd.min.js or buildAndDownloadPdf() above, which stay
// dedicated to the cover letter. Uses html2pdf.js, bundled locally.)
// ----------------------------------------------------------------------------
const TAILOR_LOADING_MESSAGES = [
  "Reading the job description...",
  "Weaving in relevant keywords...",
  "Making sure it still fits one page..."
];

// 8.5x11in at 96dpi, per the one-page spec. Margin is baked into the page
// element's padding rather than passed to html2pdf's own margin option, so
// the same box is what gets measured AND what gets rendered.
const RESUME_PAGE_WIDTH_PX = 816;
const RESUME_PAGE_HEIGHT_PX = 1056;
const RESUME_MARGIN_PX = 48; // 0.5in
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

function resumeSectionHeadingHtml(text, fontSizePt) {
  return `<div style="font-size:${fontSizePt}pt;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #333;margin:12px 0 6px;padding-bottom:2px;">${escapeHtml(text)}</div>`;
}

// Generic single-column ATS-safe layout — no tables, no icons, no columns.
// There's no real visual spec to match yet; this is a placeholder to replace
// once one is provided (see CLAUDE.md).
function buildResumeHtml(resumeJson, fontSizePt) {
  const smallPt = Math.max(fontSizePt - 1, RESUME_FONT_FLOOR_PT - 1);
  const contact = resumeJson.contact || {};
  const contactLine = [contact.email, contact.phone, contact.location, contact.linkedin, contact.github, contact.portfolio]
    .filter(Boolean)
    .map(escapeHtml)
    .join("  |  ");

  let html = `<div style="font-family: Arial, Helvetica, sans-serif; font-size:${fontSizePt}pt; line-height:1.35; color:#111;">`;

  html += `<div style="text-align:center; margin-bottom:10px;">
    <div style="font-size:${fontSizePt + 6}pt; font-weight:700;">${escapeHtml(resumeJson.name || "")}</div>
    <div style="font-size:${smallPt}pt; color:#333; margin-top:2px;">${contactLine}</div>
  </div>`;

  if (resumeJson.summary) {
    html += resumeSectionHeadingHtml("Summary", fontSizePt);
    html += `<div style="margin-bottom:6px;">${escapeHtml(resumeJson.summary)}</div>`;
  }

  if (Array.isArray(resumeJson.skills) && resumeJson.skills.length) {
    html += resumeSectionHeadingHtml("Skills", fontSizePt);
    html += `<div style="margin-bottom:6px;">${escapeHtml(resumeJson.skills.join(", "))}</div>`;
  }

  if (Array.isArray(resumeJson.experience) && resumeJson.experience.length) {
    html += resumeSectionHeadingHtml("Experience", fontSizePt);
    resumeJson.experience.forEach((entry) => {
      const titleLine = [entry.title, entry.org].filter(Boolean).map(escapeHtml).join(", ");
      html += `<div style="margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between;">
          <span style="font-weight:700;">${titleLine}</span>
          <span>${escapeHtml(entry.dates || "")}</span>
        </div>
        ${entry.location ? `<div style="font-style:italic; font-size:${smallPt}pt;">${escapeHtml(entry.location)}</div>` : ""}
        <ul style="margin:4px 0 0 18px; padding:0;">
          ${(entry.bullets || []).map((b) => `<li style="margin-bottom:2px;">${escapeHtml(b)}</li>`).join("")}
        </ul>
      </div>`;
    });
  }

  if (Array.isArray(resumeJson.projects) && resumeJson.projects.length) {
    html += resumeSectionHeadingHtml("Projects", fontSizePt);
    resumeJson.projects.forEach((entry) => {
      html += `<div style="margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between;">
          <span style="font-weight:700;">${escapeHtml(entry.name || "")}</span>
          <span>${escapeHtml(entry.dates || "")}</span>
        </div>
        <ul style="margin:4px 0 0 18px; padding:0;">
          ${(entry.bullets || []).map((b) => `<li style="margin-bottom:2px;">${escapeHtml(b)}</li>`).join("")}
        </ul>
      </div>`;
    });
  }

  const edu = resumeJson.education;
  if (edu && (edu.school || edu.degree)) {
    html += resumeSectionHeadingHtml("Education", fontSizePt);
    const eduLine = [edu.school, edu.degree].filter(Boolean).map(escapeHtml).join(", ");
    html += `<div style="display:flex; justify-content:space-between;">
      <span style="font-weight:700;">${eduLine}</span>
      <span>${escapeHtml(edu.dates || "")}</span>
    </div>`;
    if (edu.details) {
      html += `<div>${escapeHtml(edu.details)}</div>`;
    }
  }

  html += `</div>`;
  return html;
}

function createResumePageElement(resumeJson, fontSizePt) {
  const div = document.createElement("div");
  // Off-screen but still laid out (not display:none) so scrollHeight reflects
  // real rendered height for the overflow check below.
  div.style.position = "fixed";
  div.style.left = "-99999px";
  div.style.top = "0";
  div.style.width = `${RESUME_PAGE_WIDTH_PX}px`;
  div.style.boxSizing = "border-box";
  div.style.padding = `${RESUME_MARGIN_PX}px`;
  div.style.background = "#ffffff";
  div.innerHTML = buildResumeHtml(resumeJson, fontSizePt);
  return div;
}

// One-page enforcement order: LLM compression pass first (preserves content,
// just tightens wording), only reduce font-size as a last resort, floor at
// 10pt. Never drops content on its own — if still overflowing at the floor,
// this returns fits:false and the caller proceeds anyway (best effort; there
// is no further lever that doesn't mean fabricating a shorter resume).
async function fitResumeToOnePage(resumeJson, statusCallback) {
  let currentJson = resumeJson;
  let fontSizePt = 11;

  let pageEl = createResumePageElement(currentJson, fontSizePt);
  document.body.appendChild(pageEl);
  let height = pageEl.scrollHeight;

  if (height > RESUME_PAGE_HEIGHT_PX) {
    pageEl.remove();
    if (statusCallback) statusCallback("Tightening bullets to fit one page...");
    const compressResponse = await requestCompressResume({ resumeJson: currentJson });
    if (compressResponse && compressResponse.success) {
      currentJson = compressResponse.resumeJson;
    }
    pageEl = createResumePageElement(currentJson, fontSizePt);
    document.body.appendChild(pageEl);
    height = pageEl.scrollHeight;
  }

  while (height > RESUME_PAGE_HEIGHT_PX && fontSizePt > RESUME_FONT_FLOOR_PT) {
    pageEl.remove();
    fontSizePt -= 0.5;
    pageEl = createResumePageElement(currentJson, fontSizePt);
    document.body.appendChild(pageEl);
    height = pageEl.scrollHeight;
  }

  return { resumeJson: currentJson, pageEl, fits: height <= RESUME_PAGE_HEIGHT_PX };
}

// Simple suffix on the source filename's own extension — full naming-pattern
// inference (step 5) is a separate, later step.
function buildTailoredFilename(sourceFilename) {
  if (!sourceFilename) return "Tailored_Resume.pdf";
  const dotIndex = sourceFilename.lastIndexOf(".");
  if (dotIndex === -1) return `${sourceFilename}_Tailored.pdf`;
  return `${sourceFilename.slice(0, dotIndex)}_Tailored${sourceFilename.slice(dotIndex)}`;
}

async function downloadTailoredResumePdf(resumeJson, statusCallback) {
  const { pageEl } = await fitResumeToOnePage(resumeJson, statusCallback);
  const filename = buildTailoredFilename(resumeJson.sourceFilename);

  try {
    await window.html2pdf().set({
      margin: 0, // margin is already baked into pageEl's padding
      filename,
      jsPDF: { unit: "px", format: [RESUME_PAGE_WIDTH_PX, RESUME_PAGE_HEIGHT_PX], orientation: "portrait" },
      html2canvas: { scale: 2, windowWidth: RESUME_PAGE_WIDTH_PX }
    }).from(pageEl).save();
  } finally {
    pageEl.remove();
  }

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
