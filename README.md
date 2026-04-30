# Poe Chat Exporter

Chrome/Edge Manifest V3 extension for exporting Poe chat pages to Markdown or JSON.

The extension is built for personal archiving of Poe conversations. It runs locally in the browser and downloads export files through the browser download API.

## Features

- Export the current Poe chat as Markdown.
- Export the current Poe chat as JSON, including raw HTML for each message.
- Batch export chats listed in the Poe sidebar.
- Attempt to load virtualized chat history before exporting.
- Preserve code blocks and common Markdown formatting through Turndown.

## Install From Source

1. Open Chrome or Edge extension management:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select the `poe-exporter/` directory.
5. Open a Poe chat page such as `https://poe.com/chat/...`.
6. Click the extension icon and export Markdown or JSON.

## Permissions

The extension requests:

- `activeTab`: inspect the current Poe tab when the popup is used.
- `scripting`: inject or re-inject the content script when needed.
- `downloads`: save Markdown and JSON files.
- `offscreen`: create stable Blob URLs for downloads in Manifest V3.
- `debugger`: dispatch trusted mouse-wheel events through the Chrome DevTools Protocol.

The `debugger` permission exists because Poe's virtualized history loading may ignore synthetic wheel events sent from a content script. The current trusted-scroll implementation is still under active investigation; see `BUGFIX_COORDINATION.md`.

## Project Layout

```text
poe-exporter/
  manifest.json
  background.js
  content.js
  offscreen.html
  offscreen.js
  popup/
  utils/
tests/
  static-regression.test.js
BUGFIX_COORDINATION.md
AGENTS.md
```

## Current Fix Queue

The shared bugfix queue is tracked in `BUGFIX_COORDINATION.md`. Agents must follow that order unless master changes it.

## Acceptance Criteria

- Normal single-chat export uses the content script `auto_export` flow so it can load earlier virtualized messages before downloading.
- Scroll export tries all likely scroll targets, anchors on the first visible message, and dispatches upward wheel events to trigger Poe's virtualized history loading.
- When DOM wheel events are ignored, scroll export requests a trusted `Input.dispatchMouseEvent` mouse-wheel event from the background worker.
- Trusted wheel direction is detected at runtime because Poe's chat container can use reverse or negative `scrollTop` behavior.
- Batch export waits for message content readiness before extraction and must not rely on a fixed 3.5 second delay.
- Scroll export deduplicates messages with a stable full-message key, not `role + first 100 characters`.
- Historical samples in `result1/` are evidence only for past behavior; they are not current bug reports.

## Verification

Run syntax checks for changed JavaScript files:

```bash
npm run check
```

The check script runs `node --check` against the extension JavaScript files.

Run the local regression checks:

```bash
npm test
```

For extension behavior changes, manually reload `poe-exporter/` in Chrome or Edge and verify the affected export flow on a Poe chat page.

## Privacy Notes

- Do not commit exported conversations.
- Do not commit saved Poe web pages, cookies, tokens, or local browser data.
- This public repository intentionally excludes `result1/`, `test_web/`, `test_extension/`, and local skill folders.

## License

No open-source license has been selected yet. Unless a license is added later, all rights are reserved by the repository owner.
