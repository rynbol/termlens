// TermLens — toolbar popup ("paste mode").
// For PDFs and other pages where content scripts can't run: the user copies
// text there and pastes it here. Reuses the exact same "explain" port protocol
// as the content script, so the background needs no changes.
// Plain classic script; chrome.* namespace only (works in Firefox and Chrome).

"use strict";

var TERM_MAX = 300;
var CONTEXT_MAX = 1500;

var port = null;

function $(id) {
  return document.getElementById(id);
}

function cleanupPort() {
  if (port) {
    var p = port;
    port = null;
    try {
      p.disconnect();
    } catch (e) {
      // Ignore.
    }
  }
}

function setBusy(busy) {
  $("explain").disabled = busy;
  $("keepopen").hidden = !busy;
}

function showOut(text, isError) {
  var out = $("out");
  out.hidden = false;
  out.classList.toggle("err", !!isError);
  out.textContent = text;
  return out;
}

function explain() {
  var term = $("term").value.replace(/\s+/g, " ").trim().slice(0, TERM_MAX);
  var context = $("context").value.replace(/\s+/g, " ").trim().slice(0, CONTEXT_MAX);

  if (!term) {
    showOut("Enter a term or phrase to explain.", true);
    return;
  }
  if (!context) {
    context = term;
  }

  cleanupPort();
  var out = showOut("Thinking…", false);
  setBusy(true);

  var firstChunk = false;
  var finished = false;

  try {
    port = chrome.runtime.connect({ name: "explain" });
  } catch (e) {
    showOut("Could not reach the extension background: " + (e && e.message ? e.message : e), true);
    setBusy(false);
    return;
  }

  port.onMessage.addListener(function (msg) {
    if (!msg) {
      return;
    }
    if (msg.type === "chunk") {
      if (!firstChunk) {
        firstChunk = true;
        out.textContent = "";
        out.classList.remove("err");
      }
      out.textContent += msg.text || "";
      out.scrollTop = out.scrollHeight;
    } else if (msg.type === "done") {
      finished = true;
      if (!firstChunk) {
        out.textContent = "(No explanation was returned.)";
      }
      setBusy(false);
      cleanupPort();
    } else if (msg.type === "error") {
      finished = true;
      showOut(msg.message || "Something went wrong.", true);
      setBusy(false);
      cleanupPort();
    }
  });

  port.onDisconnect.addListener(function () {
    if (port === null) {
      return; // Our own cleanup.
    }
    port = null;
    if (!finished) {
      if (!firstChunk) {
        showOut("Connection lost before a reply arrived. Try again.", true);
      }
      setBusy(false);
    }
  });

  try {
    port.postMessage({ term: term, context: context, pageTitle: "(pasted text)" });
  } catch (e) {
    showOut("Could not send the request: " + (e && e.message ? e.message : e), true);
    setBusy(false);
    cleanupPort();
  }
}

// ---- PDF reader section ----------------------------------------------------
// PDFs open in the browser's built-in viewer, where content scripts can't
// run. We route them into the extension's bundled PDF.js viewer instead
// (pdf/web/viewer.html), where the explain UI is available.

function viewerUrlFor(pdfUrl) {
  return (
    chrome.runtime.getURL("pdf/web/viewer.html") +
    "?file=" + encodeURIComponent(pdfUrl || "")
  );
}

function looksLikePdfUrl(url) {
  return (
    /^https?:\/\//i.test(url || "") &&
    (/\.pdf($|[?#])/i.test(url) || /^https?:\/\/arxiv\.org\/pdf\//i.test(url))
  );
}

function openPdfInViewer(pdfUrl) {
  chrome.tabs.create({ url: viewerUrlFor(pdfUrl) });
  window.close();
}

function openPdfFromInput() {
  var url = $("pdfUrl").value.trim();
  if (!url) {
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    showOut("PDF links must start with http(s)://", true);
    return;
  }
  openPdfInViewer(url);
}

function initPdfSection() {
  $("openPdf").addEventListener("click", openPdfFromInput);
  $("pdfUrl").addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      openPdfFromInput();
    }
  });
  $("openViewer").addEventListener("click", function (event) {
    event.preventDefault();
    openPdfInViewer("");
  });

  // Offer to reopen the current tab when it's a PDF shown in the built-in
  // viewer. Opening this popup grants activeTab, which exposes the URL.
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (chrome.runtime.lastError) {
        return;
      }
      var url = tabs && tabs[0] && tabs[0].url;
      if (looksLikePdfUrl(url)) {
        var btn = $("reopenPdf");
        btn.hidden = false;
        btn.addEventListener("click", function () {
          openPdfInViewer(url);
        });
      }
    });
  } catch (e) {
    // tabs API unavailable — the manual URL field still works.
  }
}

function init() {
  $("explain").addEventListener("click", explain);
  $("term").addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      explain();
    }
  });
  initPdfSection();
  $("term").focus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
