// TermLens — options page logic.
// Plain classic script (no modules). Uses only the chrome.* namespace so it
// works unchanged in Firefox MV3 and Chrome.

"use strict";

// Exact storage keys and defaults from the project contract.
var DEFAULTS = {
  provider: "anthropic",
  apiKey: "",
  model: "claude-haiku-4-5",
  baseUrl: "",
  simpleMode: true,
  systemPrompt:
    "You are a helpful assistant embedded in a research-paper reader. The user highlights a term or phrase they don't understand. Explain what it means IN THE CONTEXT of the surrounding text, in plain language, in 2-4 short sentences. If the term has a general meaning that differs from its use here, note the in-context meaning first."
};

// System-prompt presets for the three preset buttons.
var PRESETS = {
  eli5:
    "You are a friendly assistant embedded in a research-paper reader. The user highlights a term or phrase they don't understand. Explain what it means IN THE CONTEXT of the surrounding text like you're talking to a curious five-year-old: use very simple words, everyday analogies, and no jargon. Keep it to 2-4 short sentences. If the term normally means something different from its use here, give the in-context meaning first.",
  technical:
    "You are a knowledgeable assistant embedded in a research-paper reader. The user highlights a term or phrase they don't understand. Explain what it means IN THE CONTEXT of the surrounding text for a smart non-specialist: keep the correct technical meaning but unpack any jargon in plain language, in 2-4 short sentences. If the term has a general meaning that differs from its use here, note the in-context meaning first.",
  oneliner:
    "You are a concise assistant embedded in a research-paper reader. The user highlights a term or phrase they don't understand. Explain what it means IN THE CONTEXT of the surrounding text in a single clear sentence, in plain language. Give the in-context meaning."
};

// Element handles, resolved after the DOM is ready.
var els = {};

function $(id) {
  return document.getElementById(id);
}

// Per-provider example models shown under the Model field.
var MODEL_HINTS = {
  anthropic: "e.g. claude-haiku-4-5 (fast) or claude-sonnet-4-6 (smarter)",
  groq: "e.g. llama-3.3-70b-versatile or llama-3.1-8b-instant (fastest)",
  "openai-compatible": "e.g. gpt-5-mini (OpenAI) or llama3.1 (Ollama)"
};

// Show or hide the Base URL row and update the model hint for the provider.
function syncProviderUI() {
  var p = els.provider.value;
  els.baseUrlField.classList.toggle("hidden", p !== "openai-compatible");
  els.modelHint.textContent = MODEL_HINTS[p] || "";
}

var statusTimer = null;
function showStatus(message, isError) {
  els.status.textContent = message;
  els.status.className = isError ? "err" : "ok";
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  if (!isError) {
    statusTimer = setTimeout(function () {
      els.status.textContent = "";
      els.status.className = "";
    }, 2000);
  }
}

// Populate the form from stored settings (falling back to the defaults).
// Non-secret prefs live in storage.sync; the API key lives in storage.local
// (device-only). A key found in sync is a legacy value from older versions.
function load() {
  chrome.storage.sync.get(DEFAULTS, function (items) {
    var err = chrome.runtime && chrome.runtime.lastError;
    if (err) {
      showStatus("Could not load settings: " + err.message, true);
      return;
    }
    els.provider.value = items.provider;
    els.apiKey.value = items.apiKey;
    els.model.value = items.model;
    els.baseUrl.value = items.baseUrl;
    els.systemPrompt.value = items.systemPrompt;
    els.simpleMode.checked = !!items.simpleMode;
    syncProviderUI();
    chrome.storage.local.get({ apiKey: "" }, function (localItems) {
      var localErr = chrome.runtime && chrome.runtime.lastError;
      if (!localErr && localItems && localItems.apiKey) {
        els.apiKey.value = localItems.apiKey;
      }
    });
  });
}

// True for a plain-http base URL pointing anywhere but this machine.
function isInsecureRemoteBaseUrl(url) {
  return (
    /^http:\/\//i.test(url) &&
    !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url)
  );
}

// Write prefs to storage.sync and the API key to storage.local.
function save() {
  var prefs = {
    provider: els.provider.value,
    model: els.model.value.trim(),
    baseUrl: els.baseUrl.value.trim(),
    simpleMode: els.simpleMode.checked,
    systemPrompt: els.systemPrompt.value
  };
  var apiKey = els.apiKey.value;
  chrome.storage.sync.set(prefs, function () {
    var err = chrome.runtime && chrome.runtime.lastError;
    if (err) {
      showStatus("Save failed: " + err.message, true);
      return;
    }
    chrome.storage.local.set({ apiKey: apiKey }, function () {
      var err2 = chrome.runtime && chrome.runtime.lastError;
      if (err2) {
        showStatus("Save failed: " + err2.message, true);
        return;
      }
      // Remove any key an older version stored in the synced area.
      chrome.storage.sync.remove("apiKey");
      if (
        prefs.provider === "openai-compatible" &&
        isInsecureRemoteBaseUrl(prefs.baseUrl)
      ) {
        showStatus(
          "Saved - but http:// to a remote host is insecure; requests that " +
            "carry an API key will be refused. Use https.",
          true
        );
        return;
      }
      showStatus("Saved", false);
    });
  });
}

function toggleKeyVisibility() {
  var showing = els.apiKey.type === "text";
  els.apiKey.type = showing ? "password" : "text";
  els.toggleKey.textContent = showing ? "Show" : "Hide";
  els.toggleKey.setAttribute("aria-pressed", showing ? "false" : "true");
}

function init() {
  els.provider = $("provider");
  els.apiKey = $("apiKey");
  els.toggleKey = $("toggleKey");
  els.model = $("model");
  els.modelHint = $("modelHint");
  els.baseUrlField = $("baseUrlField");
  els.baseUrl = $("baseUrl");
  els.systemPrompt = $("systemPrompt");
  els.simpleMode = $("simpleMode");
  els.save = $("save");
  els.status = $("status");

  els.provider.addEventListener("change", syncProviderUI);
  els.toggleKey.addEventListener("click", toggleKeyVisibility);
  els.save.addEventListener("click", save);

  // Preset buttons fill the system-prompt textarea.
  var presetButtons = document.querySelectorAll(".presets button[data-preset]");
  for (var i = 0; i < presetButtons.length; i++) {
    presetButtons[i].addEventListener("click", function (event) {
      var key = event.currentTarget.getAttribute("data-preset");
      if (PRESETS[key]) {
        els.systemPrompt.value = PRESETS[key];
      }
    });
  }

  load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
