/* TermLens — content script (classic script, no modules).
 *
 * Behaviour:
 *  - On mouseup with a non-empty text selection (1-300 chars trimmed), show a
 *    small floating "Explain" button near the end of the selection. Ctrl+E
 *    explains the current selection without the button.
 *  - The popup opens as a SINGLE answer (not a chat). Simplify (^S) and More
 *    technical (^T) REPLACE that answer in place (each cached separately).
 *    Typing a follow-up (^F) is the only thing that promotes the popup into a
 *    chat: the current answer becomes the first message and the exchange
 *    continues from there.
 *  - Assistant text renders a safe markdown subset (bold / italic / code)
 *    built from DOM nodes — never innerHTML.
 *  - All UI is rendered inside a CLOSED shadow root so page CSS can't
 *    interfere.
 *
 * Cross-browser: uses only chrome.* (works natively in Firefox and Chrome),
 * no browser.* / no polyfill, no ES module syntax.
 */

(function () {
  "use strict";

  // Guard against double injection (e.g. bfcache / repeated script eval).
  if (window.__pjeInjected) return;
  window.__pjeInjected = true;

  // Bail out gracefully if the extension messaging API isn't available.
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.connect) {
    return;
  }

  // ---- Constants --------------------------------------------------------

  var MIN_LEN = 1;
  var MAX_LEN = 300;
  var CONTEXT_MAX = 1500;
  var FOLLOWUP_MAX = 1000;
  var PANEL_W = 360;

  // In chat mode, the action buttons send these as ordinary follow-up turns.
  var SIMPLIFY_FOLLOWUP =
    "Explain that again, but simpler: shorter sentences, everyday words, no jargon.";
  var TECHNICAL_FOLLOWUP =
    "Explain that again with more technical depth and precision.";

  // Block-level ancestors we consider a good "context" container.
  var BLOCK_SELECTOR =
    "p,li,div,td,th,blockquote,section,article,pre,dd,dt," +
    "figcaption,h1,h2,h3,h4,h5,h6,main,aside,caption";

  var SHADOW_CSS = [
    ":host { all: initial; }",
    ".pje-btn {",
    "  position: absolute;",
    "  z-index: 2147483647;",
    "  font: 500 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;",
    "  color: #fff;",
    "  background: #4f46e5;",
    "  border: none;",
    "  border-radius: 6px;",
    "  padding: 6px 10px;",
    "  cursor: pointer;",
    "  box-shadow: 0 2px 8px rgba(0,0,0,0.25);",
    "  -webkit-user-select: none;",
    "  user-select: none;",
    "  white-space: nowrap;",
    "}",
    ".pje-btn:hover { background: #4338ca; }",
    ".pje-btn:active { transform: translateY(1px); }",
    ".pje-panel {",
    "  position: absolute;",
    "  z-index: 2147483647;",
    "  box-sizing: border-box;",
    "  width: 360px;",
    "  max-width: calc(100vw - 24px);",
    "  max-height: 440px;",
    "  display: flex;",
    "  flex-direction: column;",
    "  background: #ffffff;",
    "  color: #1f2937;",
    "  border: 1px solid rgba(0,0,0,0.1);",
    "  border-radius: 10px;",
    "  box-shadow: 0 8px 30px rgba(0,0,0,0.18);",
    "  font: 400 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;",
    "  overflow: hidden;",
    "}",
    ".pje-header {",
    "  display: flex;",
    "  align-items: center;",
    "  gap: 8px;",
    "  padding: 8px 10px;",
    "  border-bottom: 1px solid rgba(0,0,0,0.08);",
    "  background: #f9fafb;",
    "  flex: 0 0 auto;",
    "}",
    ".pje-title {",
    "  flex: 1 1 auto;",
    "  min-width: 0;",
    "  font-weight: 600;",
    "  font-size: 12px;",
    "  color: #4f46e5;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    ".pje-close {",
    "  flex: 0 0 auto;",
    "  width: 20px;",
    "  height: 20px;",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: center;",
    "  padding: 0;",
    "  border: none;",
    "  background: transparent;",
    "  color: #6b7280;",
    "  font-size: 18px;",
    "  line-height: 1;",
    "  cursor: pointer;",
    "  border-radius: 4px;",
    "}",
    ".pje-close:hover { background: rgba(0,0,0,0.06); color: #111827; }",
    ".pje-body {",
    "  flex: 1 1 auto;",
    "  min-height: 40px;",
    "  padding: 10px 12px;",
    "  overflow-y: auto;",
    "  display: flex;",
    "  flex-direction: column;",
    "  gap: 8px;",
    "}",
    "/* Single-answer view: plain text, no bubble. */",
    ".pje-single {",
    "  white-space: pre-wrap;",
    "  overflow-wrap: break-word;",
    "  word-wrap: break-word;",
    "}",
    "/* Chat view: bubbles. */",
    ".pje-msg {",
    "  white-space: pre-wrap;",
    "  overflow-wrap: break-word;",
    "  word-wrap: break-word;",
    "  border-radius: 8px;",
    "  padding: 6px 9px;",
    "  max-width: 95%;",
    "}",
    ".pje-assistant { background: rgba(79,70,229,0.06); align-self: flex-start; }",
    ".pje-user { background: rgba(0,0,0,0.05); align-self: flex-end; color: #374151; }",
    ".pje-single code, .pje-msg code {",
    "  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
    "  background: rgba(0,0,0,0.07);",
    "  border-radius: 4px;",
    "  padding: 0 4px;",
    "}",
    ".pje-thinking {",
    "  color: #6b7280;",
    "  font-style: italic;",
    "  animation: pje-pulse 1.2s ease-in-out infinite;",
    "  align-self: flex-start;",
    "}",
    "@keyframes pje-pulse { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }",
    ".pje-error {",
    "  white-space: pre-wrap;",
    "  overflow-wrap: break-word;",
    "  word-wrap: break-word;",
    "  color: #b91c1c;",
    "  background: #fef2f2;",
    "  border: 1px solid #fecaca;",
    "  border-radius: 6px;",
    "  padding: 8px 10px;",
    "}",
    ".pje-footer {",
    "  flex: 0 0 auto;",
    "  border-top: 1px solid rgba(0,0,0,0.08);",
    "  padding: 8px 10px;",
    "  display: flex;",
    "  flex-direction: column;",
    "  gap: 6px;",
    "  background: #f9fafb;",
    "}",
    ".pje-actions { display: flex; gap: 6px; }",
    ".pje-action {",
    "  font: 500 11px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;",
    "  color: #4f46e5;",
    "  background: rgba(79,70,229,0.08);",
    "  border: 1px solid rgba(79,70,229,0.25);",
    "  border-radius: 6px;",
    "  padding: 5px 8px;",
    "  cursor: pointer;",
    "  white-space: nowrap;",
    "}",
    ".pje-action:hover { background: rgba(79,70,229,0.15); }",
    ".pje-action:disabled { opacity: 0.45; cursor: default; }",
    ".pje-input-row { display: flex; gap: 6px; }",
    ".pje-input {",
    "  flex: 1 1 auto;",
    "  min-width: 0;",
    "  box-sizing: border-box;",
    "  font: 400 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;",
    "  color: #1f2937;",
    "  background: #ffffff;",
    "  border: 1px solid rgba(0,0,0,0.15);",
    "  border-radius: 6px;",
    "  padding: 6px 8px;",
    "}",
    ".pje-input:focus { outline: 2px solid #4f46e5; outline-offset: -1px; }",
    ".pje-send {",
    "  font: 500 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;",
    "  color: #fff;",
    "  background: #4f46e5;",
    "  border: none;",
    "  border-radius: 6px;",
    "  padding: 6px 10px;",
    "  cursor: pointer;",
    "}",
    ".pje-send:hover { background: #4338ca; }",
    ".pje-send:disabled { opacity: 0.45; cursor: default; }",
    "@media (prefers-color-scheme: dark) {",
    "  .pje-panel { background: #1f2937; color: #e5e7eb; border-color: rgba(255,255,255,0.12); }",
    "  .pje-header { background: #111827; border-bottom-color: rgba(255,255,255,0.08); }",
    "  .pje-footer { background: #111827; border-top-color: rgba(255,255,255,0.08); }",
    "  .pje-title { color: #a5b4fc; }",
    "  .pje-close { color: #9ca3af; }",
    "  .pje-close:hover { background: rgba(255,255,255,0.08); color: #f9fafb; }",
    "  .pje-assistant { background: rgba(165,180,252,0.10); }",
    "  .pje-user { background: rgba(255,255,255,0.08); color: #d1d5db; }",
    "  .pje-single code, .pje-msg code { background: rgba(255,255,255,0.12); }",
    "  .pje-thinking { color: #9ca3af; }",
    "  .pje-error { color: #fca5a5; background: #3f1d1d; border-color: #7f1d1d; }",
    "  .pje-action { color: #a5b4fc; background: rgba(165,180,252,0.10); border-color: rgba(165,180,252,0.35); }",
    "  .pje-action:hover { background: rgba(165,180,252,0.18); }",
    "  .pje-input { color: #e5e7eb; background: #1f2937; border-color: rgba(255,255,255,0.2); }",
    "}"
  ].join("\n");

  // ---- State ------------------------------------------------------------

  var host = null;        // container element in the page (light DOM)
  var shadow = null;      // closed shadow root
  var btnEl = null;       // floating "Explain" button
  var panelEl = null;     // popup panel
  var titleEl = null;     // header title (shows the term)
  var bodyEl = null;      // scrollable body
  var thinkingEl = null;  // "Thinking..." indicator
  var simplifyBtn = null;
  var technicalBtn = null;
  var inputEl = null;     // follow-up input
  var sendBtn = null;

  var popupOpen = false;
  var pending = null;     // {term, context, pageTitle, rect}
  var port = null;        // active runtime port (one conversation), or null
  var busy = false;       // a reply is currently streaming
  var chatMode = false;   // false = single answer; true = conversation
  var streamEl = null;    // element currently being streamed into
  var streamText = "";    // accumulated text for the streaming turn

  // ---- Markdown-lite ----------------------------------------------------

  // Renders **bold**, *italic* and `code` as real DOM nodes (never innerHTML,
  // so page/LLM output can't inject markup). Newlines survive via pre-wrap.
  function renderMarkdownInto(el, text) {
    el.textContent = "";
    var t = String(text || "");
    var re = /(\*\*[^*]+\*\*|`[^`\n]+`|\*[^\s*][^*\n]*\*)/g;
    var last = 0;
    var m;
    while ((m = re.exec(t)) !== null) {
      if (m.index > last) {
        el.appendChild(document.createTextNode(t.slice(last, m.index)));
      }
      var tok = m[0];
      var child;
      if (tok.charAt(0) === "`") {
        child = document.createElement("code");
        child.textContent = tok.slice(1, -1);
      } else if (tok.indexOf("**") === 0) {
        child = document.createElement("strong");
        child.textContent = tok.slice(2, -2);
      } else {
        child = document.createElement("em");
        child.textContent = tok.slice(1, -1);
      }
      el.appendChild(child);
      last = m.index + tok.length;
    }
    if (last < t.length) {
      el.appendChild(document.createTextNode(t.slice(last)));
    }
  }

  // ---- DOM construction -------------------------------------------------

  function ensureHost() {
    if (host) return;

    host = document.createElement("div");
    host.className = "pje-host";
    shadow = host.attachShadow({ mode: "closed" });

    var style = document.createElement("style");
    style.textContent = SHADOW_CSS;
    shadow.appendChild(style);

    // Floating button. Fires on mousedown (not click) so the request starts
    // ~100ms sooner; preventDefault keeps the page selection intact.
    btnEl = document.createElement("button");
    btnEl.className = "pje-btn";
    btnEl.type = "button";
    btnEl.textContent = "Explain";
    btnEl.title = "Explain selection (^E)";
    btnEl.style.display = "none";
    btnEl.addEventListener("mousedown", function (e) {
      if (!e.isTrusted) return;
      e.preventDefault();
      e.stopPropagation();
      openPopup();
    });
    shadow.appendChild(btnEl);

    // Popup panel: header / body / footer(actions + input).
    panelEl = document.createElement("div");
    panelEl.className = "pje-panel";
    panelEl.style.display = "none";

    var header = document.createElement("div");
    header.className = "pje-header";

    titleEl = document.createElement("div");
    titleEl.className = "pje-title";
    titleEl.textContent = "Explain";

    var closeBtn = document.createElement("button");
    closeBtn.className = "pje-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closePopup();
    });

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    bodyEl = document.createElement("div");
    bodyEl.className = "pje-body";

    thinkingEl = document.createElement("div");
    thinkingEl.className = "pje-thinking";
    thinkingEl.textContent = "Thinking…";
    thinkingEl.style.display = "none";

    var footer = document.createElement("div");
    footer.className = "pje-footer";

    var actions = document.createElement("div");
    actions.className = "pje-actions";

    simplifyBtn = document.createElement("button");
    simplifyBtn.className = "pje-action";
    simplifyBtn.type = "button";
    simplifyBtn.textContent = "Simplify (^S)";
    simplifyBtn.addEventListener("click", function (e) {
      e.preventDefault();
      doSimplify();
    });

    technicalBtn = document.createElement("button");
    technicalBtn.className = "pje-action";
    technicalBtn.type = "button";
    technicalBtn.textContent = "More technical (^T)";
    technicalBtn.addEventListener("click", function (e) {
      e.preventDefault();
      doTechnical();
    });

    actions.appendChild(simplifyBtn);
    actions.appendChild(technicalBtn);

    var inputRow = document.createElement("div");
    inputRow.className = "pje-input-row";

    inputEl = document.createElement("input");
    inputEl.className = "pje-input";
    inputEl.type = "text";
    inputEl.placeholder = "Ask a follow-up… (^F)";
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        submitInput();
      }
    });

    sendBtn = document.createElement("button");
    sendBtn.className = "pje-send";
    sendBtn.type = "button";
    sendBtn.textContent = "Send";
    sendBtn.addEventListener("click", function (e) {
      e.preventDefault();
      submitInput();
    });

    inputRow.appendChild(inputEl);
    inputRow.appendChild(sendBtn);

    footer.appendChild(actions);
    footer.appendChild(inputRow);

    panelEl.appendChild(header);
    panelEl.appendChild(bodyEl);
    panelEl.appendChild(footer);
    shadow.appendChild(panelEl);

    document.documentElement.appendChild(host);
  }

  // ---- Positioning ------------------------------------------------------

  function positionButton(rect) {
    var top = rect.bottom + window.scrollY + 6;
    var left = rect.right + window.scrollX + 6;
    var viewportRight = window.scrollX + document.documentElement.clientWidth;
    var maxLeft = viewportRight - 80;
    if (left > maxLeft) left = Math.max(window.scrollX + 4, maxLeft);
    btnEl.style.top = top + "px";
    btnEl.style.left = left + "px";
  }

  function positionPanel(rect) {
    var top = rect.bottom + window.scrollY + 8;
    var left = rect.left + window.scrollX;
    var viewportRight = window.scrollX + document.documentElement.clientWidth;
    var maxLeft = viewportRight - PANEL_W - 12;
    var minLeft = window.scrollX + 8;
    if (left > maxLeft) left = maxLeft;
    if (left < minLeft) left = minLeft;
    panelEl.style.top = top + "px";
    panelEl.style.left = left + "px";
  }

  // ---- Button show / hide ----------------------------------------------

  function showButton(rect) {
    ensureHost();
    positionButton(rect);
    btnEl.style.display = "block";
  }

  function hideButton() {
    if (btnEl) btnEl.style.display = "none";
  }

  // ---- Context extraction ----------------------------------------------

  function getContext(sel, term) {
    var node = sel.anchorNode;
    if (!node) return term;

    var el;
    if (node.nodeType === Node.TEXT_NODE) {
      el = node.parentElement;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      el = node;
    } else {
      el = node.parentElement;
    }
    if (!el) return term;

    var block = null;
    if (el.closest) block = el.closest(BLOCK_SELECTOR);
    if (!block) block = el;

    var text = (block.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) text = term;
    if (text.length > CONTEXT_MAX) {
      // Data minimization: send a window centered on the selected term, not
      // whatever happens to start the block.
      var needle = (term || "").replace(/\s+/g, " ").trim().slice(0, 100);
      var at = needle ? text.indexOf(needle) : -1;
      var start = 0;
      if (at >= 0) {
        start = Math.max(0, at - Math.floor((CONTEXT_MAX - needle.length) / 2));
        start = Math.min(start, Math.max(0, text.length - CONTEXT_MAX));
      }
      text = text.slice(start, start + CONTEXT_MAX);
    }
    return text;
  }

  // ---- View helpers -----------------------------------------------------

  function scrollToBottom() {
    if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function setThinking(on) {
    if (!thinkingEl) return;
    thinkingEl.style.display = on ? "block" : "none";
    if (on) {
      bodyEl.appendChild(thinkingEl); // keep it at the bottom
      scrollToBottom();
    }
  }

  function setBusy(on) {
    busy = on;
    if (simplifyBtn) simplifyBtn.disabled = on;
    if (technicalBtn) technicalBtn.disabled = on;
    if (sendBtn) sendBtn.disabled = on;
  }

  function appendUserBubble(text) {
    var el = document.createElement("div");
    el.className = "pje-msg pje-user";
    el.textContent = text;
    bodyEl.appendChild(el);
    scrollToBottom();
  }

  function clearError() {
    if (!bodyEl) return;
    var existing = bodyEl.querySelectorAll(".pje-error");
    for (var i = 0; i < existing.length; i++) existing[i].remove();
  }

  function showError(message) {
    setThinking(false);
    setBusy(false);
    streamEl = null;
    streamText = "";

    var msg = String(message || "Something went wrong.");
    var text = msg;
    if (/api\s*key|apikey|missing key|no api key|unauthor|invalid key|401|403/i.test(msg)) {
      text = msg + "\n\nOpen the extension options to set your API key and provider.";
    }

    var el = document.createElement("div");
    el.className = "pje-error";
    el.textContent = text;
    bodyEl.appendChild(el);
    scrollToBottom();
  }

  // ---- Port / streaming -------------------------------------------------

  function cleanupPort() {
    if (port) {
      var p = port;
      port = null; // null first so onDisconnect's guard skips our own close
      try { p.disconnect(); } catch (e) { /* ignore */ }
    }
  }

  function ensurePort() {
    if (port) return true;

    try {
      port = chrome.runtime.connect({ name: "explain" });
    } catch (err) {
      showError("Could not reach the extension background. Try reloading the page.");
      return false;
    }

    var thisPort = port;

    thisPort.onMessage.addListener(function (msg) {
      if (!msg || thisPort !== port) return;

      if (msg.type === "chunk") {
        setThinking(false);
        if (!streamEl) return; // stray chunk with no active target
        streamText += (msg.text || "");
        renderMarkdownInto(streamEl, streamText);
        scrollToBottom();
      } else if (msg.type === "done") {
        setThinking(false);
        if (streamEl && !streamText) {
          streamEl.textContent = "(No explanation was returned.)";
        }
        streamEl = null;
        streamText = "";
        setBusy(false);
      } else if (msg.type === "error") {
        showError(msg.message);
      }
    });

    thisPort.onDisconnect.addListener(function () {
      var lastErr = chrome.runtime && chrome.runtime.lastError;
      if (thisPort !== port) return; // we closed it intentionally
      port = null;
      if (busy) {
        showError(lastErr && lastErr.message
          ? lastErr.message
          : "The connection closed unexpectedly. Try reloading the page.");
      }
    });

    return true;
  }

  function postToPort(message) {
    try {
      port.postMessage(message);
      return true;
    } catch (err) {
      showError("Could not send the request. Try reloading the page.");
      cleanupPort();
      return false;
    }
  }

  // Single-answer explanation (default / simple / technical). Replaces the
  // whole body with one plain answer element and streams into it.
  function runExplain(mode) {
    if (!ensurePort()) return;
    chatMode = false;
    clearError();
    bodyEl.textContent = "";
    bodyEl.appendChild(thinkingEl);

    streamEl = document.createElement("div");
    streamEl.className = "pje-single";
    streamText = "";
    bodyEl.appendChild(streamEl);

    setBusy(true);
    setThinking(true);
    var payload = {
      term: pending.term,
      context: pending.context,
      pageTitle: pending.pageTitle
    };
    if (mode === "simple" || mode === "technical") payload.mode = mode;
    if (!postToPort(payload)) {
      setBusy(false);
      setThinking(false);
    }
  }

  function doSimplify() {
    if (busy || !pending) return;
    if (chatMode) {
      sendFollowup(SIMPLIFY_FOLLOWUP, "Simplify");
    } else {
      runExplain("simple");
    }
  }

  function doTechnical() {
    if (busy || !pending) return;
    if (chatMode) {
      sendFollowup(TECHNICAL_FOLLOWUP, "More technical");
    } else {
      runExplain("technical");
    }
  }

  // Promote the current single answer into a chat: relabel it as an assistant
  // bubble so the conversation reads naturally.
  function enterChatMode() {
    if (chatMode) return;
    chatMode = true;
    var current = bodyEl.querySelector(".pje-single");
    if (current) current.className = "pje-msg pje-assistant";
  }

  function sendFollowup(text, displayAs) {
    if (busy || !pending) return;
    var followup = String(text || "").trim().slice(0, FOLLOWUP_MAX);
    if (!followup) return;
    if (!port) {
      showError("This conversation ended. Close the popup and explain again.");
      return;
    }
    enterChatMode();
    clearError();
    appendUserBubble(displayAs || followup);

    streamEl = document.createElement("div");
    streamEl.className = "pje-msg pje-assistant";
    streamText = "";
    bodyEl.appendChild(streamEl);

    setBusy(true);
    setThinking(true);
    if (!postToPort({ followup: followup })) {
      setBusy(false);
      setThinking(false);
    }
  }

  function submitInput() {
    if (!inputEl) return;
    var text = inputEl.value;
    if (!String(text || "").trim()) return;
    inputEl.value = "";
    sendFollowup(text);
  }

  // ---- Popup open / close ----------------------------------------------

  function openPopup() {
    if (!pending) return;
    ensureHost();
    hideButton();

    // Fresh conversation per popup.
    cleanupPort();
    setBusy(false);
    chatMode = false;
    streamEl = null;
    streamText = "";
    bodyEl.textContent = "";
    bodyEl.appendChild(thinkingEl);
    if (inputEl) inputEl.value = "";

    var term = pending.term;
    titleEl.textContent = term.length > 80 ? term.slice(0, 79) + "…" : term;
    titleEl.title = term;

    // Prefer a fresh rect (in case the page scrolled between select and click).
    var rect = pending.rect;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      var r = sel.getRangeAt(0).getBoundingClientRect();
      if (r && (r.width || r.height)) rect = r;
    }

    positionPanel(rect);
    panelEl.style.display = "flex";
    popupOpen = true;

    document.addEventListener("keydown", onPanelKeyDown, true);
    document.addEventListener("mousedown", onOutsideMouseDown, true);

    runExplain("default");
  }

  function closePopup() {
    if (!popupOpen) return;
    popupOpen = false;
    if (panelEl) panelEl.style.display = "none";
    document.removeEventListener("keydown", onPanelKeyDown, true);
    document.removeEventListener("mousedown", onOutsideMouseDown, true);
    cleanupPort();
    setBusy(false);
    chatMode = false;
    streamEl = null;
    streamText = "";
  }

  // ---- Event handlers ---------------------------------------------------

  function pathIncludesHost(e) {
    if (!host) return false;
    if (typeof e.composedPath === "function") {
      var path = e.composedPath();
      for (var i = 0; i < path.length; i++) {
        if (path[i] === host) return true;
      }
      return false;
    }
    // Fallback for very old engines.
    return !!(e.target && host.contains && host.contains(e.target));
  }

  // Builds `pending` from the current selection. Returns true when valid.
  function captureSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;

    var term = sel.toString().trim();
    if (term.length < MIN_LEN || term.length > MAX_LEN) return false;

    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;

    pending = {
      term: term,
      context: getContext(sel, term),
      pageTitle: (document.title || "").slice(0, 200),
      rect: rect
    };
    return true;
  }

  function onDocMouseUp(e) {
    // Reject page-synthesized events: a hostile page could dispatch fake
    // mouseup/keydown + a programmatic selection to drive billed API calls.
    if (!e.isTrusted) return;
    // Ignore interactions that happen inside our own UI (button/popup).
    if (pathIncludesHost(e)) return;

    if (!captureSelection()) {
      hideButton();
      return;
    }

    // Re-selection while a popup is open replaces it.
    if (popupOpen) closePopup();

    showButton(pending.rect);
  }

  function onSelectionChange() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 ||
        sel.toString().trim().length === 0) {
      hideButton();
    }
  }

  function isEditableTarget(e) {
    var t = e.target;
    if (!t) return false;
    var tag = (t.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || !!t.isContentEditable;
  }

  // Panel-scoped shortcuts, active only while the popup is open:
  // Escape close, ^S simplify, ^T more technical, ^F focus follow-up input.
  function onPanelKeyDown(e) {
    if (!e.isTrusted) return; // ignore synthetic key events
    if (e.key === "Escape" || e.keyCode === 27) {
      closePopup();
      return;
    }
    if (!e.ctrlKey || e.metaKey || e.altKey) return;

    var k = (e.key || "").toLowerCase();
    if (k === "s") {
      e.preventDefault();
      e.stopPropagation();
      doSimplify();
    } else if (k === "t") {
      e.preventDefault();
      e.stopPropagation();
      doTechnical();
    } else if (k === "f") {
      e.preventDefault();
      e.stopPropagation();
      if (inputEl) inputEl.focus();
    }
  }

  // Global shortcut: ^E explains the current selection (no button click).
  function onGlobalKeyDown(e) {
    if (!e.isTrusted) return; // block zero-click billing via synthetic Ctrl+E
    if (!e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    if (isEditableTarget(e) || pathIncludesHost(e)) return;

    if (!captureSelection()) return;

    e.preventDefault();
    e.stopPropagation();
    if (popupOpen) closePopup();
    ensureHost();
    openPopup();
  }

  function onOutsideMouseDown(e) {
    if (!e.isTrusted) return; // ignore synthetic clicks
    if (pathIncludesHost(e)) return; // click inside our popup: keep it open
    closePopup();
  }

  // ---- Wire up global listeners ----------------------------------------

  document.addEventListener("mouseup", onDocMouseUp, true);
  document.addEventListener("selectionchange", onSelectionChange, true);
  document.addEventListener("keydown", onGlobalKeyDown, true);
})();
