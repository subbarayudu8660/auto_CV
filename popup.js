const yourNameEl = document.getElementById("yourName");
const resumeTextEl = document.getElementById("resumeText");
const extraContextEl = document.getElementById("extraContext");
const githubUsernameEl = document.getElementById("githubUsername");
const apiKeyEl = document.getElementById("apiKey");
const saveBtn = document.getElementById("saveBtn");
const savedMsg = document.getElementById("savedMsg");

function loadStoredValues() {
  chrome.storage.local.get(["yourName", "resumeText", "extraContext", "githubUsername", "apiKey"], (result) => {
    yourNameEl.value = result.yourName || "";
    resumeTextEl.value = result.resumeText || "";
    extraContextEl.value = result.extraContext || "";
    githubUsernameEl.value = result.githubUsername || "";
    apiKeyEl.value = result.apiKey || "";
  });
}

function showSavedMessage() {
  savedMsg.classList.add("show");
  setTimeout(() => savedMsg.classList.remove("show"), 1600);
}

saveBtn.addEventListener("click", () => {
  const data = {
    yourName: yourNameEl.value.trim(),
    resumeText: resumeTextEl.value,
    extraContext: extraContextEl.value,
    githubUsername: githubUsernameEl.value.trim(),
    apiKey: apiKeyEl.value.trim()
  };
  chrome.storage.local.set(data, showSavedMessage);
});

loadStoredValues();

// --- Resume Tailoring: structured resumeJson (separate stored value, separate consumer) ---

const rjFields = {
  name: document.getElementById("rjName"),
  email: document.getElementById("rjEmail"),
  phone: document.getElementById("rjPhone"),
  location: document.getElementById("rjLocation"),
  linkedin: document.getElementById("rjLinkedin"),
  github: document.getElementById("rjGithub"),
  portfolio: document.getElementById("rjPortfolio"),
  summary: document.getElementById("rjSummary"),
  skills: document.getElementById("rjSkills"),
  eduSchool: document.getElementById("rjEduSchool"),
  eduDegree: document.getElementById("rjEduDegree"),
  eduDates: document.getElementById("rjEduDates"),
  eduDetails: document.getElementById("rjEduDetails"),
  sourceFilename: document.getElementById("rjSourceFilename")
};
const rjExperienceListEl = document.getElementById("rjExperienceList");
const rjProjectsListEl = document.getElementById("rjProjectsList");
const rjAddExperienceBtn = document.getElementById("rjAddExperience");
const rjAddProjectBtn = document.getElementById("rjAddProject");
const rjSaveBtn = document.getElementById("rjSaveBtn");
const rjSavedMsg = document.getElementById("rjSavedMsg");
const rjImportJsonEl = document.getElementById("rjImportJson");
const rjImportBtn = document.getElementById("rjImportBtn");
const rjImportErrorEl = document.getElementById("rjImportError");

function emptyResumeJson() {
  return {
    name: "",
    contact: { email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" },
    summary: "",
    skills: [],
    experience: [],
    projects: [],
    education: { school: "", degree: "", dates: "", details: "" },
    sourceFilename: ""
  };
}

function makeExperienceEntry(entry) {
  const div = document.createElement("div");
  div.className = "entry";
  div.innerHTML = `
    <div class="entry-head">
      <span>Experience entry</span>
      <button type="button" class="remove-btn">Remove</button>
    </div>
    <div class="row">
      <div class="field"><label>Title</label><input type="text" class="rj-exp-title" placeholder="Data Analyst" /></div>
      <div class="field"><label>Organization</label><input type="text" class="rj-exp-org" placeholder="Acme Corp" /></div>
    </div>
    <div class="row">
      <div class="field"><label>Location</label><input type="text" class="rj-exp-location" placeholder="Remote" /></div>
      <div class="field"><label>Dates</label><input type="text" class="rj-exp-dates" placeholder="Jan 2023 - Present" /></div>
    </div>
    <div class="field">
      <label>Bullets (one per line)</label>
      <textarea class="bullets rj-exp-bullets" placeholder="Built a dashboard that..."></textarea>
    </div>
  `;
  div.querySelector(".remove-btn").addEventListener("click", () => div.remove());
  div.querySelector(".rj-exp-title").value = entry?.title || "";
  div.querySelector(".rj-exp-org").value = entry?.org || "";
  div.querySelector(".rj-exp-location").value = entry?.location || "";
  div.querySelector(".rj-exp-dates").value = entry?.dates || "";
  div.querySelector(".rj-exp-bullets").value = Array.isArray(entry?.bullets) ? entry.bullets.join("\n") : "";
  return div;
}

function makeProjectEntry(entry) {
  const div = document.createElement("div");
  div.className = "entry";
  div.innerHTML = `
    <div class="entry-head">
      <span>Project entry</span>
      <button type="button" class="remove-btn">Remove</button>
    </div>
    <div class="row">
      <div class="field"><label>Name</label><input type="text" class="rj-proj-name" placeholder="Sales Forecasting Model" /></div>
      <div class="field"><label>Dates</label><input type="text" class="rj-proj-dates" placeholder="Spring 2023" /></div>
    </div>
    <div class="field">
      <label>Bullets (one per line)</label>
      <textarea class="bullets rj-proj-bullets" placeholder="Trained a model that..."></textarea>
    </div>
  `;
  div.querySelector(".remove-btn").addEventListener("click", () => div.remove());
  div.querySelector(".rj-proj-name").value = entry?.name || "";
  div.querySelector(".rj-proj-dates").value = entry?.dates || "";
  div.querySelector(".rj-proj-bullets").value = Array.isArray(entry?.bullets) ? entry.bullets.join("\n") : "";
  return div;
}

function renderExperienceList(experience) {
  rjExperienceListEl.innerHTML = "";
  (experience || []).forEach((entry) => rjExperienceListEl.appendChild(makeExperienceEntry(entry)));
}

function renderProjectsList(projects) {
  rjProjectsListEl.innerHTML = "";
  (projects || []).forEach((entry) => rjProjectsListEl.appendChild(makeProjectEntry(entry)));
}

function collectExperience() {
  return Array.from(rjExperienceListEl.querySelectorAll(".entry")).map((div) => ({
    title: div.querySelector(".rj-exp-title").value.trim(),
    org: div.querySelector(".rj-exp-org").value.trim(),
    location: div.querySelector(".rj-exp-location").value.trim(),
    dates: div.querySelector(".rj-exp-dates").value.trim(),
    bullets: div.querySelector(".rj-exp-bullets").value.split("\n").map((b) => b.trim()).filter(Boolean)
  }));
}

function collectProjects() {
  return Array.from(rjProjectsListEl.querySelectorAll(".entry")).map((div) => ({
    name: div.querySelector(".rj-proj-name").value.trim(),
    dates: div.querySelector(".rj-proj-dates").value.trim(),
    bullets: div.querySelector(".rj-proj-bullets").value.split("\n").map((b) => b.trim()).filter(Boolean)
  }));
}

function collectResumeJson() {
  return {
    name: rjFields.name.value.trim(),
    contact: {
      email: rjFields.email.value.trim(),
      phone: rjFields.phone.value.trim(),
      location: rjFields.location.value.trim(),
      linkedin: rjFields.linkedin.value.trim(),
      github: rjFields.github.value.trim(),
      portfolio: rjFields.portfolio.value.trim()
    },
    summary: rjFields.summary.value.trim(),
    skills: rjFields.skills.value.split(",").map((s) => s.trim()).filter(Boolean),
    experience: collectExperience(),
    projects: collectProjects(),
    education: {
      school: rjFields.eduSchool.value.trim(),
      degree: rjFields.eduDegree.value.trim(),
      dates: rjFields.eduDates.value.trim(),
      details: rjFields.eduDetails.value.trim()
    },
    sourceFilename: rjFields.sourceFilename.value.trim()
  };
}

function applyResumeJsonToForm(resumeJson) {
  const data = { ...emptyResumeJson(), ...resumeJson };
  data.contact = { ...emptyResumeJson().contact, ...(resumeJson.contact || {}) };
  data.education = { ...emptyResumeJson().education, ...(resumeJson.education || {}) };

  rjFields.name.value = data.name || "";
  rjFields.email.value = data.contact.email || "";
  rjFields.phone.value = data.contact.phone || "";
  rjFields.location.value = data.contact.location || "";
  rjFields.linkedin.value = data.contact.linkedin || "";
  rjFields.github.value = data.contact.github || "";
  rjFields.portfolio.value = data.contact.portfolio || "";
  rjFields.summary.value = data.summary || "";
  rjFields.skills.value = Array.isArray(data.skills) ? data.skills.join(", ") : "";
  rjFields.eduSchool.value = data.education.school || "";
  rjFields.eduDegree.value = data.education.degree || "";
  rjFields.eduDates.value = data.education.dates || "";
  rjFields.eduDetails.value = data.education.details || "";
  rjFields.sourceFilename.value = data.sourceFilename || "";

  renderExperienceList(data.experience);
  renderProjectsList(data.projects);
}

function loadResumeJson() {
  chrome.storage.local.get(["resumeJson"], (result) => {
    applyResumeJsonToForm(result.resumeJson || emptyResumeJson());
  });
}

function showRjSavedMessage() {
  rjSavedMsg.classList.add("show");
  setTimeout(() => rjSavedMsg.classList.remove("show"), 1600);
}

rjAddExperienceBtn.addEventListener("click", () => {
  rjExperienceListEl.appendChild(makeExperienceEntry());
});

rjAddProjectBtn.addEventListener("click", () => {
  rjProjectsListEl.appendChild(makeProjectEntry());
});

rjSaveBtn.addEventListener("click", () => {
  const resumeJson = collectResumeJson();
  chrome.storage.local.set({ resumeJson }, showRjSavedMessage);
});

rjImportBtn.addEventListener("click", () => {
  rjImportErrorEl.textContent = "";
  let parsed;
  try {
    parsed = JSON.parse(rjImportJsonEl.value);
  } catch (err) {
    rjImportErrorEl.textContent = "Invalid JSON: " + err.message;
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    rjImportErrorEl.textContent = "Expected a JSON object matching the resumeJson schema.";
    return;
  }
  applyResumeJsonToForm(parsed);
  rjImportJsonEl.value = "";
});

loadResumeJson();
