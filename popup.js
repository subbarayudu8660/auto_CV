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
