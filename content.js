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
  `;
  shadow.appendChild(style);

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
  shadow.appendChild(wrapper);

  fab.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open") && !panel.dataset.started) {
      panel.dataset.started = "true";
      runGenerationFlow(panel.querySelector(".body"));
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

function renderLoading(container) {
  container.innerHTML = `<div class="status" id="loading-status">${LOADING_MESSAGES[0]}</div>`;
  let i = 0;
  const statusEl = container.querySelector("#loading-status");
  const interval = setInterval(() => {
    i = (i + 1) % LOADING_MESSAGES.length;
    if (statusEl.isConnected) {
      statusEl.textContent = LOADING_MESSAGES[i];
    } else {
      clearInterval(interval);
    }
  }, 1800);
  return () => clearInterval(interval);
}

function renderError(container, message) {
  container.innerHTML = `
    <div class="error-msg">${escapeHtml(message)}</div>
    <div class="error-msg">If this is a settings issue, open the extension popup to check your saved API key or resume.</div>
    <button class="action-btn" id="retry-btn">Try Again</button>
  `;
  container.querySelector("#retry-btn").addEventListener("click", () => runGenerationFlow(container));
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

function requestGeneration({ jobTitle, companyName, jobDescriptionText }) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "GENERATE_COVER_LETTER", jobTitle, companyName, jobDescriptionText },
      (response) => resolve(response)
    );
  });
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
    renderError(container, response?.error || "Something went wrong generating the letter.");
    return;
  }

  try {
    const filename = await buildAndDownloadPdf(response);
    renderSuccess(container, filename, response.letterText);
  } catch (err) {
    renderError(container, `Failed to build the PDF: ${err.message}`);
  }
}

// ----------------------------------------------------------------------------
// Init
// ----------------------------------------------------------------------------
buildUI();
