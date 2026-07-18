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

async function fetchGithubReposBlock(githubUsername) {
  if (!githubUsername) return "";

  let repos;
  try {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(githubUsername)}/repos?sort=updated&per_page=15&type=owner`
    );
    if (!res.ok) return "";
    repos = await res.json();
    if (!Array.isArray(repos)) return "";
  } catch (_) {
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
      })
    });
  } catch (networkErr) {
    return { success: false, error: "Network error reaching the Anthropic API. Check your internet connection and try again." };
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
      })
    });
  } catch (networkErr) {
    return { success: false, error: "Network error reaching the Anthropic API. Check your internet connection and try again." };
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
});
