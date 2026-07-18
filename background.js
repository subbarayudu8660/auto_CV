const SYSTEM_PROMPT = `You are helping a real person write ONE cover letter for ONE specific job. The reader is a hiring manager who has read dozens of cover letters this week — most open with "I am writing to apply for..." and they mentally check out within one sentence. Your job is to make sure this one doesn't get skipped.

CRITICAL OUTPUT FORMAT: You may think through your approach first if needed. But the final cover letter itself must be wrapped in <letter></letter> tags, with absolutely nothing else inside those tags except the letter's paragraphs. Everything outside the <letter> tags is discarded and never shown to anyone, so use that space for any reasoning, but the content inside <letter></letter> must be ONLY the finished letter text: no meta-commentary, no explanation of your choices, no "Here is the letter," nothing but the paragraphs themselves.

Rules for the opening line:
- Reference one concrete, specific detail about this company or role — from the job description, or something real and current found via web search (a recent launch, funding news, a stated technical challenge). Never open with an abstract compliment about "mission" or "culture."
- If search finds nothing specific, silently fall back to a detail already in the job description — the reader should never know search was attempted or that it failed.
- Never fabricate a company fact.
- Never use: "I am writing to apply," "I am excited to apply for," "I am a highly motivated," "I believe I would be a great fit," "I am confident that my skills."

You'll also receive a list of the candidate's recent public GitHub repos. Before picking which project to feature in the body, compare: does a specific GitHub repo match what this job description is asking for more precisely than anything in the resume? If yes, use the GitHub project instead of a resume bullet — reference it by what it actually does and why it's relevant, not just its name. If the resume already covers the best match, or no GitHub repos are provided, use the resume as before. Either way, still just ONE project total — this is an upgrade to which story you pick, not a reason to mention more things.

Rules for the body — this is the part most AI-generated letters get wrong:
- Pick ONE real project or result, from the resume or from the GitHub repos provided. Not two, not three. One. Go deeper on it rather than listing more.
- Do not stack multiple metrics back to back like a resume bullet list (e.g. "cut costs by 60%... reduced time to 60 seconds... outperformed by 15%... hit 0.917... cut calls by 70%"). Pick the ONE number that matters most for this role and let the rest of the sentence be about what it means, not what else you also did.
- Vary sentence length and rhythm. A letter that's all dense compound sentences with embedded stats reads like a status report, not a person talking. Mix in a short, plain sentence.
- Write like the candidate is explaining this to a person across a table, not defending a thesis. Confident, specific, a little informal is better than exhaustive.
- Connect that one project to what the role actually needs in a way the resume itself doesn't already say — the "why this matters for you specifically" is the whole value of a cover letter over a resume.
- Mirror 1-2 pieces of real terminology from the job description naturally, not more.
- Do not use em dashes (—) anywhere in the letter. Use periods, commas, or parentheses instead. Em dashes are a strong tell of AI-generated text and undermine the goal of sounding genuine.

Format: 3-4 short paragraphs, 250-300 words total. No greeting or signature block, just the body. Output nothing except the letter itself.`;

// Plain-completion API calls (no web search) get this ceiling. A stalled
// connection (server accepts the socket but never responds, never fires an
// error event) otherwise hangs the underlying fetch() forever — there is no
// default timeout, confirmed by reproducing against a server that accepts
// but never answers.
const API_TIMEOUT_MS = 45000;
// The cover letter call has the web_search tool enabled, which can genuinely
// take longer than a plain completion (searching + reading results before
// writing) — ceiling set above the typical 30-45s window so a legitimately
// slow-but-successful search isn't mistaken for a hang.
const WEB_SEARCH_TIMEOUT_MS = 55000;
// GitHub context is optional and this lookup should be fast — short ceiling
// so a stalled GitHub API call can't block the entire letter generation flow
// (it's awaited before the Claude call even starts).
const GITHUB_FETCH_TIMEOUT_MS = 10000;

async function fetchGithubReposBlock(githubUsername) {
  if (!githubUsername) return "";

  let repos;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GITHUB_FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(
        `https://api.github.com/users/${encodeURIComponent(githubUsername)}/repos?sort=updated&per_page=15&type=owner`,
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) return "";
    repos = await res.json();
    if (!Array.isArray(repos)) return "";
  } catch (_) {
    // Covers network failures, rate limiting, and a stalled connection that
    // timed out via the AbortController above — all treated the same way,
    // since GitHub context is optional and never worth blocking letter
    // generation over.
    return "";
  }

  const candidates = repos.filter((r) => !r.fork && r.description);

  const scored = candidates
    .map((r) => {
      const pushedAt = new Date(r.pushed_at).getTime() || 0;
      const recencyScore = pushedAt / 1e12;
      const starScore = (r.stargazers_count || 0) * 0.01;
      return { repo: r, score: recencyScore + starScore };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ repo }) => repo);

  if (scored.length === 0) return "";

  const lines = scored.map((r) => {
    const topics = Array.isArray(r.topics) && r.topics.length ? r.topics.join(", ") : "";
    const pushedDate = r.pushed_at ? r.pushed_at.slice(0, 10) : "unknown";
    const parts = [
      `${r.name} - ${r.description}.`,
      r.language ? `${r.language}.` : "",
      topics ? `${topics}.` : "",
      `Updated ${pushedDate}.`
    ].filter(Boolean);
    return parts.join(" ");
  });

  return lines.join("\n");
}

async function generateCoverLetter({ jobTitle, companyName, jobDescriptionText }) {
  const stored = await chrome.storage.local.get(["resumeText", "extraContext", "apiKey", "yourName", "githubUsername"]);
  const { resumeText, extraContext, apiKey, yourName, githubUsername } = stored;

  if (!apiKey) {
    return { success: false, error: "No Anthropic API key saved. Open the extension popup and add your API key in settings." };
  }
  if (!resumeText) {
    return { success: false, error: "No resume saved. Open the extension popup and paste your resume text in settings." };
  }

  const githubReposBlock = await fetchGithubReposBlock(githubUsername);

  const userMessage = `<job_title>${jobTitle || "Unknown"}</job_title>
<company_name>${companyName || "Unknown"}</company_name>
<job_description>
${jobDescriptionText || "Not available."}
</job_description>
<resume>
${resumeText}
</resume>
<extra_context>
${extraContext || "None provided."}
</extra_context>
<github_repos>
${githubReposBlock || "None provided."}
</github_repos>

Write the cover letter body now, following the system instructions exactly.`;

  let response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: userMessage }]
      }),
      signal: controller.signal
    });
  } catch (networkErr) {
    if (networkErr.name === "AbortError") {
      return { success: false, error: `The request to Claude timed out after ${WEB_SEARCH_TIMEOUT_MS / 1000} seconds. This can happen when web search takes a while — try again.` };
    }
    return { success: false, error: "Network error reaching the Anthropic API. Check your internet connection and try again." };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 401) {
      return { success: false, error: "Anthropic API key was rejected (401). Double-check the key saved in the popup settings." };
    }
    if (response.status === 429) {
      return { success: false, error: "Rate limited by the Anthropic API (429). Wait a moment and try again." };
    }
    let bodyText = "";
    try {
      const errJson = await response.json();
      bodyText = errJson?.error?.message || "";
    } catch (_) {}
    return { success: false, error: `Anthropic API request failed (${response.status}). ${bodyText}`.trim() };
  }

  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    return { success: false, error: "Could not parse the response from the Anthropic API." };
  }

  const content = Array.isArray(data.content) ? data.content : [];
  const fullText = content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const match = fullText.match(/<letter>([\s\S]*?)<\/letter>/);
  const letterText = match ? match[1].trim() : fullText.trim();

  if (!letterText) {
    return { success: false, error: "Claude returned an empty response. This can happen if the request was declined — try regenerating." };
  }

  return { success: true, letterText, companyName, jobTitle };
}

const EXTRACT_RESUME_SYSTEM_PROMPT = `You are extracting structured data from a real person's resume. This is EXTRACTION ONLY, not writing or editing.

CRITICAL RULE: Do not rewrite, rephrase, improve, embellish, or summarize any wording. Copy each bullet, title, and summary sentence exactly as it appears in the source text (fixing only obvious OCR/whitespace artifacts like a stray line break mid-sentence). If a field is not present in the source text, leave it as an empty string or empty array — never invent a value.

Bad (rewriting instead of extracting):
Source bullet: "Built a dashboard in Tableau for the sales team"
Bad output: "Engineered a comprehensive Tableau analytics dashboard, driving actionable insights for sales stakeholders"

Good (faithful extraction):
Source bullet: "Built a dashboard in Tableau for the sales team"
Good output: "Built a dashboard in Tableau for the sales team"

Structure the resume into exactly this JSON schema:
{
  "name": "",
  "contact": { "email": "", "phone": "", "location": "", "linkedin": "", "github": "", "portfolio": "" },
  "summary": "",
  "skills": ["..."],
  "experience": [{ "title": "", "org": "", "location": "", "dates": "", "bullets": ["..."] }],
  "projects": [{ "name": "", "dates": "", "bullets": ["..."] }],
  "education": { "school": "", "degree": "", "dates": "", "details": "" }
}

Notes:
- "skills" is a flat array of individual skill strings, split out of however the source lists them (comma-separated line, bulleted list, categorized groups — flatten all of it into one array).
- "experience" is paid/professional roles; "projects" is standalone projects (personal, academic, or listed in a dedicated Projects section) — use the source resume's own section boundaries to decide which is which, don't guess based on content alone.
- "education.details" is for GPA/honors/coursework if present, else leave it an empty string.
- If the source resume has a table layout, multiple columns, or any structure that's ambiguous to parse (this is common with text extracted from a multi-column PDF, where lines from different columns can get interleaved), do your best faithful extraction and do not fabricate content to fill gaps.

CRITICAL OUTPUT FORMAT: You may reason about the resume's structure first if needed. But the final JSON must be wrapped in <resume_json></resume_json> tags with absolutely nothing else inside those tags except the raw JSON object: no markdown code fences, no commentary. Everything outside the tags is discarded and never shown to anyone, so use that space for any reasoning, but the content inside <resume_json></resume_json> must be valid JSON matching the schema above exactly.`;

async function extractResume({ resumeText }) {
  const stored = await chrome.storage.local.get(["apiKey"]);
  const { apiKey } = stored;

  if (!apiKey) {
    return { success: false, error: "No Anthropic API key saved. Open the extension popup and add your API key in settings." };
  }
  if (!resumeText || !resumeText.trim()) {
    return { success: false, error: "No resume text to extract from." };
  }

  const userMessage = `<resume_text>
${resumeText}
</resume_text>

Extract this resume into the JSON schema now, following the system instructions exactly.`;

  let response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: EXTRACT_RESUME_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }]
      }),
      signal: controller.signal
    });
  } catch (networkErr) {
    if (networkErr.name === "AbortError") {
      return { success: false, error: `The request to Claude timed out after ${API_TIMEOUT_MS / 1000} seconds. Try again.` };
    }
    return { success: false, error: "Network error reaching the Anthropic API. Check your internet connection and try again." };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 401) {
      return { success: false, error: "Anthropic API key was rejected (401). Double-check the key saved in the popup settings." };
    }
    if (response.status === 429) {
      return { success: false, error: "Rate limited by the Anthropic API (429). Wait a moment and try again." };
    }
    let bodyText = "";
    try {
      const errJson = await response.json();
      bodyText = errJson?.error?.message || "";
    } catch (_) {}
    return { success: false, error: `Anthropic API request failed (${response.status}). ${bodyText}`.trim() };
  }

  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    return { success: false, error: "Could not parse the response from the Anthropic API." };
  }

  const content = Array.isArray(data.content) ? data.content : [];
  const fullText = content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const match = fullText.match(/<resume_json>([\s\S]*?)<\/resume_json>/);
  const jsonText = match ? match[1].trim() : fullText.trim();

  if (!jsonText) {
    return { success: false, error: "Claude returned an empty response. This can happen if the request was declined — try again." };
  }

  let resumeJson;
  try {
    resumeJson = JSON.parse(jsonText);
  } catch (parseErr) {
    return { success: false, error: "Claude's response wasn't valid JSON, so it couldn't be parsed into the resume form. Try again, or paste the resume text manually instead of uploading the PDF." };
  }

  return { success: true, resumeJson };
}

const ANALYZE_RESUME_SKILLS_SYSTEM_PROMPT = `You are analyzing a job description against a real person's resume to find a skills gap. This is analysis only — you are not rewriting anything yet, just identifying what's missing.

Steps:
1. Extract the technical/ATS-relevant skills and keywords from the job description (tools, languages, platforms, methodologies, certifications — not soft skills like "team player" or "communication").
2. Cross-reference each one against the candidate's existing skills list (provided below). Skip anything already listed there, including close synonyms/variants (e.g. if "PostgreSQL" is listed, don't also flag "Postgres").
3. For each remaining skill (JD-relevant, not already on the resume), write ONE sentence explaining why the JD calls for it.
4. Decide hasAdjacentEvidence: true if the candidate's existing experience/project bullets (also provided below) plausibly demonstrate this skill already, even if it isn't named as a skill outright (e.g. a bullet mentioning "built ETL pipelines in Airflow" supports adding "Apache Airflow" even if it wasn't in the skills list). Set it false if there is no bullet anywhere that plausibly supports the skill — this would be a bare, unsupported claim if added.

If the job description asks for nothing the candidate doesn't already have, return an empty array — do not force a result.

CRITICAL OUTPUT FORMAT: You may reason through the JD and resume first if needed. But the final result must be wrapped in <analysis_json></analysis_json> tags with absolutely nothing else inside those tags except a raw JSON array: no markdown code fences, no commentary. Everything outside the tags is discarded, so use that space for any reasoning, but the content inside <analysis_json></analysis_json> must be valid JSON matching this shape exactly:
[{ "skill": "", "reason": "", "hasAdjacentEvidence": true }]`;

function collectResumeBullets(resumeJson) {
  const expBullets = (resumeJson.experience || []).flatMap((e) => e.bullets || []);
  const projBullets = (resumeJson.projects || []).flatMap((p) => p.bullets || []);
  return [...expBullets, ...projBullets];
}

async function analyzeResumeSkills({ jobDescriptionText }) {
  const stored = await chrome.storage.local.get(["apiKey", "resumeJson"]);
  const { apiKey, resumeJson } = stored;

  if (!apiKey) {
    return { success: false, error: "No Anthropic API key saved. Open the extension popup and add your API key in settings." };
  }
  if (!resumeJson || !resumeJson.name) {
    return { success: false, error: "No structured resume saved. Open the extension popup and fill in (or auto-extract) your resume under Resume Tailoring." };
  }
  if (!jobDescriptionText || !jobDescriptionText.trim()) {
    return { success: false, error: "No job description text found on this page." };
  }

  const existingSkills = (resumeJson.skills || []).join(", ") || "None listed";
  const bullets = collectResumeBullets(resumeJson);
  const existingBullets = bullets.length ? bullets.map((b) => `- ${b}`).join("\n") : "None listed";

  const userMessage = `<job_description>
${jobDescriptionText}
</job_description>
<existing_skills>
${existingSkills}
</existing_skills>
<existing_bullets>
${existingBullets}
</existing_bullets>

Analyze now, following the system instructions exactly.`;

  let response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: ANALYZE_RESUME_SKILLS_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }]
      }),
      signal: controller.signal
    });
  } catch (networkErr) {
    if (networkErr.name === "AbortError") {
      return { success: false, error: `The request to Claude timed out after ${API_TIMEOUT_MS / 1000} seconds. Try again.` };
    }
    return { success: false, error: "Network error reaching the Anthropic API. Check your internet connection and try again." };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 401) {
      return { success: false, error: "Anthropic API key was rejected (401). Double-check the key saved in the popup settings." };
    }
    if (response.status === 429) {
      return { success: false, error: "Rate limited by the Anthropic API (429). Wait a moment and try again." };
    }
    let bodyText = "";
    try {
      const errJson = await response.json();
      bodyText = errJson?.error?.message || "";
    } catch (_) {}
    return { success: false, error: `Anthropic API request failed (${response.status}). ${bodyText}`.trim() };
  }

  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    return { success: false, error: "Could not parse the response from the Anthropic API." };
  }

  const content = Array.isArray(data.content) ? data.content : [];
  const fullText = content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const match = fullText.match(/<analysis_json>([\s\S]*?)<\/analysis_json>/);
  const jsonText = match ? match[1].trim() : fullText.trim();

  if (!jsonText) {
    return { success: false, error: "Claude returned an empty response. This can happen if the request was declined — try again." };
  }

  let skills;
  try {
    skills = JSON.parse(jsonText);
  } catch (parseErr) {
    return { success: false, error: "Claude's response wasn't valid JSON, so it couldn't be parsed into the checklist. Try again." };
  }

  if (!Array.isArray(skills)) {
    return { success: false, error: "Claude's response wasn't in the expected list format. Try again." };
  }

  return { success: true, skills };
}

const TAILOR_RESUME_SYSTEM_PROMPT = `You are tailoring a real person's resume to a specific job description. This is a rewrite pass with one absolute boundary: you are editing what already exists, never inventing what doesn't.

CRITICAL RULE, THE MOST IMPORTANT ONE IN THIS PROMPT: Never add a new entry to "experience" or "projects." Every entry in the output arrays must correspond to an entry that was already in the input resume — same title/org or same project name. Within an existing entry, you may rephrase, reorder, or expand its existing bullets (and only its existing bullets), but you may not invent a bullet describing work, a tool, or a result that has no basis in the input. If the job description calls for something the resume has zero evidence for anywhere, leave it out of the bullets entirely — it can only go into "skills" (see below), never fabricated into a bullet as if it were experience.

Bad (inventing a new project to chase the JD):
Input resume has 2 projects. Job description mentions Kubernetes, which appears nowhere in the input.
Bad output: a 3rd project entry, "Container Orchestration Pipeline," that doesn't exist in the input.

Bad (fabricating within an existing bullet):
Input bullet: "Built a dashboard in Tableau for the sales team"
Bad output: "Built a dashboard in Tableau and deployed it via a Kubernetes-orchestrated CI/CD pipeline for the sales team" (the Kubernetes/CI/CD part has no basis anywhere in the input resume)

Good (rephrasing/expanding an existing bullet using only what's already there, while working in a real JD keyword the resume already supports):
Input bullet: "Built a dashboard in Tableau for the sales team"
Job description keyword: "data visualization"
Good output: "Built a Tableau data visualization dashboard adopted by the sales team for weekly pipeline reviews" (same underlying fact, tighter ATS phrasing, no new claim)

Keyword weaving:
- Target each primary JD keyword landing 2-3 times across the resume in different phrasing/context — not verbatim copy-pasted the same way each time, and not just once. (This is the OPPOSITE density target from a cover letter, which mirrors only 1-2 terms once each to avoid sounding ATS-stuffed. A resume is machine-parsed before a human ever reads it, so repetition across a few varied bullets is the correct goal here, not a mistake to fix.)
- Prioritize placing a keyword in the FIRST bullet of whichever existing experience or project entry is most relevant to the job description — ATS parsers and human skimmers both weight the first bullet of an entry more heavily than one buried at the bottom of a list.
- Only place a keyword where it's honestly supported by that entry's existing content. Do not force an unrelated keyword into an entry it doesn't fit.

Skills:
- Fold the approved new skills (provided below) into the "skills" array, alongside the existing skills. Do not add any skill beyond what was explicitly approved.
- Do not remove any existing skill.

Other rules:
- No em dashes (—) anywhere in the output. Use periods, commas, or parentheses instead.
- Do not change "name", "contact", "education", or "sourceFilename" — pass them through unchanged from the input.
- Do not reorder or restructure the resume's sections — this is a content-tailoring pass, not a redesign.

CRITICAL OUTPUT FORMAT: You may reason through your approach first if needed. But the final result must be wrapped in <resume_json></resume_json> tags with absolutely nothing else inside those tags except the raw JSON object: no markdown code fences, no commentary. Everything outside the tags is discarded, so use that space for any reasoning, but the content inside <resume_json></resume_json> must be valid JSON matching the same schema as the input resume exactly.`;

async function tailorResume({ jobDescriptionText, approvedSkills }) {
  const stored = await chrome.storage.local.get(["apiKey", "resumeJson"]);
  const { apiKey, resumeJson } = stored;

  if (!apiKey) {
    return { success: false, error: "No Anthropic API key saved. Open the extension popup and add your API key in settings." };
  }
  if (!resumeJson || !resumeJson.name) {
    return { success: false, error: "No structured resume saved. Open the extension popup and fill in (or auto-extract) your resume under Resume Tailoring." };
  }
  if (!jobDescriptionText || !jobDescriptionText.trim()) {
    return { success: false, error: "No job description text found on this page." };
  }

  const approvedSkillsList = Array.isArray(approvedSkills) ? approvedSkills : [];
  const approvedSkillsText = approvedSkillsList.length ? approvedSkillsList.join(", ") : "None approved";

  const userMessage = `<job_description>
${jobDescriptionText}
</job_description>
<resume_json>
${JSON.stringify(resumeJson)}
</resume_json>
<approved_new_skills>
${approvedSkillsText}
</approved_new_skills>

Tailor this resume now, following the system instructions exactly.`;

  let response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: TAILOR_RESUME_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }]
      }),
      signal: controller.signal
    });
  } catch (networkErr) {
    if (networkErr.name === "AbortError") {
      return { success: false, error: `The request to Claude timed out after ${API_TIMEOUT_MS / 1000} seconds. Try again.` };
    }
    return { success: false, error: "Network error reaching the Anthropic API. Check your internet connection and try again." };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 401) {
      return { success: false, error: "Anthropic API key was rejected (401). Double-check the key saved in the popup settings." };
    }
    if (response.status === 429) {
      return { success: false, error: "Rate limited by the Anthropic API (429). Wait a moment and try again." };
    }
    let bodyText = "";
    try {
      const errJson = await response.json();
      bodyText = errJson?.error?.message || "";
    } catch (_) {}
    return { success: false, error: `Anthropic API request failed (${response.status}). ${bodyText}`.trim() };
  }

  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    return { success: false, error: "Could not parse the response from the Anthropic API." };
  }

  const content = Array.isArray(data.content) ? data.content : [];
  const fullText = content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const match = fullText.match(/<resume_json>([\s\S]*?)<\/resume_json>/);
  const jsonText = match ? match[1].trim() : fullText.trim();

  if (!jsonText) {
    return { success: false, error: "Claude returned an empty response. This can happen if the request was declined — try again." };
  }

  let tailoredResumeJson;
  try {
    tailoredResumeJson = JSON.parse(jsonText);
  } catch (parseErr) {
    return { success: false, error: "Claude's response wasn't valid JSON, so the tailored resume couldn't be parsed. Try again." };
  }

  // Belt-and-suspenders: guarantee these pass through unchanged regardless of
  // what the model actually did, since sourceFilename in particular feeds
  // the download filename downstream.
  tailoredResumeJson.sourceFilename = resumeJson.sourceFilename || tailoredResumeJson.sourceFilename || "";

  return { success: true, resumeJson: tailoredResumeJson };
}

const COMPRESS_RESUME_SYSTEM_PROMPT = `You are tightening an already-tailored resume so it fits on one printed page. This is a compression pass only, not a rewrite.

Rules:
- Shorten each bullet by roughly 15%, preserving every keyword and the specific metric/number it already contains — the goal is tighter phrasing, not less substance.
- Never remove a bullet entirely, never merge two bullets into one, never drop an experience or project entry, never drop a skill.
- Do not introduce any new claim, skill, tool, or accomplishment not already present in the input.
- No em dashes (—) anywhere in the output.
- Do not change "name", "contact", "education", or "sourceFilename" — pass them through unchanged.

CRITICAL OUTPUT FORMAT: wrap the result in <resume_json></resume_json> tags with absolutely nothing else inside those tags except the raw JSON object, same schema as the input. Everything outside the tags is discarded.`;

async function compressResume({ resumeJson }) {
  const stored = await chrome.storage.local.get(["apiKey"]);
  const { apiKey } = stored;

  if (!apiKey) {
    return { success: false, error: "No Anthropic API key saved. Open the extension popup and add your API key in settings." };
  }
  if (!resumeJson || !resumeJson.name) {
    return { success: false, error: "No resume to compress." };
  }

  const userMessage = `<resume_json>
${JSON.stringify(resumeJson)}
</resume_json>

Tighten the bullets now by about 15%, following the system instructions exactly.`;

  let response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: COMPRESS_RESUME_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }]
      }),
      signal: controller.signal
    });
  } catch (networkErr) {
    if (networkErr.name === "AbortError") {
      return { success: false, error: `The request to Claude timed out after ${API_TIMEOUT_MS / 1000} seconds. Try again.` };
    }
    return { success: false, error: "Network error reaching the Anthropic API. Check your internet connection and try again." };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 401) {
      return { success: false, error: "Anthropic API key was rejected (401). Double-check the key saved in the popup settings." };
    }
    if (response.status === 429) {
      return { success: false, error: "Rate limited by the Anthropic API (429). Wait a moment and try again." };
    }
    let bodyText = "";
    try {
      const errJson = await response.json();
      bodyText = errJson?.error?.message || "";
    } catch (_) {}
    return { success: false, error: `Anthropic API request failed (${response.status}). ${bodyText}`.trim() };
  }

  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    return { success: false, error: "Could not parse the response from the Anthropic API." };
  }

  const content = Array.isArray(data.content) ? data.content : [];
  const fullText = content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const match = fullText.match(/<resume_json>([\s\S]*?)<\/resume_json>/);
  const jsonText = match ? match[1].trim() : fullText.trim();

  if (!jsonText) {
    return { success: false, error: "Claude returned an empty response while compressing the resume." };
  }

  let compressedResumeJson;
  try {
    compressedResumeJson = JSON.parse(jsonText);
  } catch (parseErr) {
    return { success: false, error: "Claude's compression response wasn't valid JSON." };
  }

  compressedResumeJson.sourceFilename = resumeJson.sourceFilename || compressedResumeJson.sourceFilename || "";

  return { success: true, resumeJson: compressedResumeJson };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GENERATE_COVER_LETTER") {
    generateCoverLetter(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: `Unexpected error: ${err.message}` }));
    return true;
  }
  if (message?.type === "EXTRACT_RESUME") {
    extractResume(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: `Unexpected error: ${err.message}` }));
    return true;
  }
  if (message?.type === "ANALYZE_RESUME_SKILLS") {
    analyzeResumeSkills(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: `Unexpected error: ${err.message}` }));
    return true;
  }
  if (message?.type === "TAILOR_RESUME") {
    tailorResume(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: `Unexpected error: ${err.message}` }));
    return true;
  }
  if (message?.type === "COMPRESS_RESUME") {
    compressResume(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: `Unexpected error: ${err.message}` }));
    return true;
  }
});
