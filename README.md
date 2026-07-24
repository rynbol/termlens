# TermLens

**Read papers and technical articles without drowning in jargon.** Highlight a term on any web page and TermLens explains it in plain language — *in the context of the paragraph you're reading*, not just a dictionary definition. Then ask follow-ups, or tap **Simplify** / **More technical** to re-pitch the answer.

- 🦊 **Works in Firefox (and Chrome), Manifest V3.** Built and tested on **Zen Browser**.
- 🔑 **Bring your own API key.** Anthropic, Groq, or any OpenAI-compatible endpoint (including local Ollama). No account, no server, no subscription.
- 🔒 **Private by design.** Your key is stored on your device only and sent straight to the provider you chose — never to us (there is no "us"). No telemetry.

TermLens is a paper jargon explainer for people who'd rather own their tools than rent them.

---

## Install on Zen Browser / Firefox (primary)

Firefox-based browsers load an unpacked extension as a temporary add-on:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select this project's `manifest.json`. The whole extension loads from there.

> **Temporary add-ons are removed when the browser restarts** — repeat these steps after each restart. (A permanent install needs a signed build, which is out of scope for this dev setup.)

### Required: enable host permissions (Firefox MV3 gotcha)

On Firefox MV3, host permissions are **opt-in** and are *not* granted on load. Until you grant them the content script can't run, so **the Explain button never appears**:

1. Open the Extensions manager (`about:addons`).
2. Find **TermLens** → **Permissions** tab.
3. Enable **Access your data for all websites**.

Reload any open page and selecting text will show the button.

---

## Install on Chrome (secondary)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder (the one containing `manifest.json`).

Chrome grants host permissions on load — no extra step.

---

## Set up your provider

Open the options page — Firefox/Zen: `about:addons` → **TermLens** → **Options**; Chrome: `chrome://extensions` → **TermLens** → **Details** → **Extension options**.

**Anthropic (default):** paste a key from the [Anthropic Console](https://console.anthropic.com/). Default model `claude-haiku-4-5` — fast and cheap.

**Groq (fastest):** set **Provider** to **Groq**, paste a key from the [Groq Console](https://console.groq.com/), model e.g. `llama-3.1-8b-instant`. The base URL is handled for you.

**OpenAI / any OpenAI-compatible endpoint:** set **Provider** to **OpenAI-compatible** and fill in **Base URL** + **Model**:

- OpenAI: base `https://api.openai.com/v1`, model e.g. `gpt-5-mini` (reasoning is auto-pinned to minimal so answers stay instant).
- Local Ollama: base `http://localhost:11434/v1`, model e.g. `llama3.1` — no key needed.

There's also a **Simpler explanations by default** toggle (on) and three system-prompt presets (ELI5 / Technical but simple / One-liner).

---

## Usage

1. Select a word or phrase on any HTML page.
2. Click the floating **Explain** button — or press **Ctrl+E** to skip the button.
3. The explanation streams into a popup as a single plain answer. From there:
   - **Simplify (Ctrl+S)** — rewrites the answer you're looking at to be simpler still. Repeatable.
   - **More technical (Ctrl+T)** — rewrites it with more depth and precision. Repeatable.
   - **Follow-up (Ctrl+F)** — ask anything; this is what turns the popup into a chat, keeping the passage as context.
   - **Esc** closes.

Identical lookups are cached locally, so repeats are instant and free.

### PDFs and papers

Browsers open PDFs in a privileged built-in viewer where extensions can't run, so the highlight button can never appear there. TermLens ships **its own PDF reader** instead (bundled PDF.js), where highlight-to-explain works exactly as it does on web pages. Three ways in:

- **A PDF link on a page** — right-click it → **Open PDF in TermLens**.
- **A PDF URL** (e.g. `https://arxiv.org/pdf/2310.06770`) — click the toolbar icon, paste it under **Read a PDF**, press **Open**.
- **A PDF you're already viewing** — click the toolbar icon → **Reopen this tab's PDF in TermLens**.
- **A downloaded PDF** — toolbar icon → **open the reader**, then use its Open-file button or drag the PDF in.

Scanned/image-only PDFs have no text layer to select, so they need OCR and aren't supported. **Paste mode** (toolbar icon, top section) remains available for those and for anywhere else the button can't reach.

---

## Privacy & security

- **Your API key never leaves your device.** It's stored in `chrome.storage.local` (device-only, not browser-synced) and sent only to the provider you configured.
- **HTTPS enforced.** TermLens refuses to send your key over plaintext `http://` to any non-localhost host.
- **No telemetry, no server, no third parties.** Requests go browser → your provider, full stop.
- **Prompt-injection hardened.** Page text is fenced with a per-request random token so a malicious page can't smuggle instructions into the model, and all responses render as inert text/markdown (never HTML), so nothing on a page can inject scripts through the popup.
- **Synthetic-event guarded.** Only genuine user input can trigger a (billed) explanation — a hostile page can't drive the extension on its own.

---

## How it works

- **Content script** (`src/content.js` + `src/content.css`): detects selections, shows the button, renders the mini-chat popup inside a closed shadow DOM.
- **Background** (`src/background.js`): one self-contained classic script — messaging port, provider dispatch, streaming SSE parsing, local response cache, per-conversation history.
- **Options / popup** (`options.html`, `popup.html`, `src/*.js`): settings, paste mode, and the PDF reader entry points.
- **PDF reader** (`pdf/`): a vendored copy of Mozilla's PDF.js served as an extension page, with the content script loaded into it.

No build step, no bundler, no dependencies, no module syntax — it uses only the `chrome.*` API namespace, which both Firefox and Chrome support natively.

---

## Third-party code

`pdf/` is a vendored copy of **[PDF.js](https://github.com/mozilla/pdf.js) v6.1.200** (Apache License 2.0 — see [`pdf/LICENSE`](pdf/LICENSE)), used as TermLens's PDF reader.

Two files carry TermLens modifications, each marked with a `TermLens modification` comment:

- `pdf/web/viewer.html` — loads `src/content.js` / `src/content.css` so highlight-to-explain works inside the viewer.
- `pdf/web/viewer.mjs` — the viewer's same-origin check also accepts `http(s)` documents, so remote PDFs (arXiv and friends) open via the extension's host permissions. Other URL schemes stay blocked, and the viewer is not web-accessible: only TermLens's own UI can open it.

Source maps and PDF.js's sample document are gitignored (debug-only / unused). To re-vendor or upgrade:

```sh
curl -L -o /tmp/pdfjs.zip https://github.com/mozilla/pdf.js/releases/download/v6.1.200/pdfjs-6.1.200-dist.zip
mkdir -p pdf && unzip -q -o /tmp/pdfjs.zip -d pdf && rm /tmp/pdfjs.zip
```

…then re-apply the two modifications above (`git diff` against a clean extract will show them).

---

## License

MIT — see [LICENSE](LICENSE). Vendored PDF.js remains under Apache 2.0.
