# Poe Exporter Bugfix Coordination

## Current Truth

- `result1/` contains historical export samples only. The old assistant-message issue shown there has already been resolved and must not be treated as a current bug.
- The extension can currently be loaded in both Chrome and Edge. Browser loading is no longer in the active fix queue.
- The fix queue below follows master's requested order. Do not reorder items unless master explicitly changes the priority.
- This file is the shared coordination board for Codex and Gemini agent work on the Poe Exporter project.

## Fix Queue

1. Connect the normal export flow to the existing `auto_export` scroll-export logic, removing or reducing the dependency on manually scrolling to the top before export.
2. Improve batch export loading readiness so extraction does not depend on a fixed 3.5 second wait that can return empty data when Poe loads slowly or background rendering is limited.
3. Improve message deduplication keys so `role + first 100 characters` does not accidentally merge different messages in long conversations or conversations with similar openings.
4. Establish tests, README notes, and explicit acceptance criteria. Use local samples or minimal DOM fixtures to lock down known deviations before future bug fixes.

## Agent Notes

### 2026-04-28 Codex
- Finding: Started the ordered fix queue. Normal export now calls `auto_export`; batch extraction waits for message readiness before scroll export; scroll dedup uses a full-message key; README and static regression checks were added.
- Evidence: `node tests/static-regression.test.js` and `node --check` pass for changed JavaScript files.
- Next: Manually reload `poe-exporter/` in Chrome or Edge and verify single Markdown/JSON export plus batch export on live Poe pages.

### 2026-04-29 Codex
- Finding: After master reported scroll loading still failed, `auto_export` was changed from single-container `scrollTop = 0` to multi-target history loading: it anchors on the first visible message, scrolls all likely message ancestors plus `document.scrollingElement`, dispatches upward `WheelEvent`s, and waits for message/top-anchor/scroll-state changes before stopping.
- Evidence: `node tests/static-regression.test.js` and `node --check poe-exporter/content.js` pass.
- Next: Reload the extension and test a long Poe conversation; use `[PoeExporter] Collected so far` logs to confirm whether message count increases during upward loading.

### 2026-04-29 Codex Follow-up
- Finding: Master's console showed the prior multi-target loop still collected only 3 messages and stopped after 7 attempts, so the code was not moving Poe's actual history-loading target. `findScrollTargets` now scans all page-level candidates with `scrollHeight > clientHeight`, ignores CSS overflow assumptions, probes which targets actually move, prefers movable targets containing visible messages, and logs `[PoeExporter] Scroll targets:` summaries.
- Evidence: `node tests/static-regression.test.js`, `node --check poe-exporter/content.js`, `node --check poe-exporter/background.js`, and `node --check poe-exporter/popup/popup.js` pass.
- Next: Reload the extension and rerun export. If message count still stays flat, copy the new `[PoeExporter] Scroll targets:` console line so the real container selection can be corrected precisely.

### 2026-04-29 Codex Follow-up 2
- Finding: Master's console showed `[PoeExporter] Scroll targets: none movable`, so the scroll loop had no target and did not dispatch wheel events. `auto_export` now builds fallback history event targets from the first visible message ancestors, `main`, document scroll roots, `document`, and `window`, then dispatches upward `WheelEvent`s even when no movable `scrollTop` target is found.
- Evidence: `node tests/static-regression.test.js`, `node --check poe-exporter/content.js`, `node --check poe-exporter/background.js`, and `node --check poe-exporter/popup/popup.js` pass.
- Next: Reload and retest. If `[PoeExporter] Wheel event targets:` appears but message count still remains unchanged, Poe likely requires browser-level trusted input events instead of synthetic DOM wheel events.

### 2026-04-29 Codex Follow-up 3
- Finding: Master confirmed manual scrolling loads more messages, while synthetic content-script scrolling still stays at 3. The extension now requests `debugger` permission and the background service worker handles `trusted_scroll` by using Chrome DevTools Protocol `Input.dispatchMouseEvent` with `type: "mouseWheel"`.
- Evidence: `node tests/static-regression.test.js`, `node --check poe-exporter/content.js`, `node --check poe-exporter/background.js`, and `node --check poe-exporter/popup/popup.js` pass.
- Next: Reload the extension so the new `debugger` permission is active. During export, confirm console shows `[PoeExporter] Trusted wheel event: sent`; if it shows fallback, check the background service worker console for the `trusted_scroll` error.

### 2026-04-30 Codex
- Finding: Master reported trusted wheel causes visible flicker and still does not move upward reliably. The content script no longer calls `scrollIntoView` or performs DOM `scrollTop` fallback after a trusted wheel is sent. Trusted wheel coordinates are now calculated from the active scroll target's viewport rectangle, and the background service worker keeps the debugger session attached across repeated wheel dispatches until `trusted_scroll_end`.
- Evidence: `node tests/static-regression.test.js`, `node --check poe-exporter/content.js`, `node --check poe-exporter/background.js`, and `node --check poe-exporter/popup/popup.js` pass.
- Next: Reload the extension and retest. If message count still stays flat, capture the `Scroll targets` line and whether visible flicker is gone; next adjustment should focus on wheel `deltaY` direction/size or target coordinate.

### 2026-04-30 Codex Follow-up
- Finding: Since the logged Poe scroll target can report negative `scrollTop`, fixed `deltaY=-900` is likely wrong for some chat layouts. `auto_export` now probes both trusted wheel directions, compares message count, earliest message key, and scroll signature after each probe, then caches the effective `trustedScrollDeltaY` for the rest of the export loop.
- Evidence: `node tests/static-regression.test.js` and `npm run check` pass.
- Next: Reload and retest. Watch for `[PoeExporter] Trusted wheel probe deltaY=...` and `[PoeExporter] Trusted wheel direction selected:` to confirm which direction Poe accepts.

### YYYY-MM-DD AgentName
- Finding:
- Evidence:
- Next:

## Verification Rules

- Before changing code, confirm the target bug is still reproducible or has clear risk evidence.
- Verify each fix independently. Do not combine multiple issues into one conclusion.
- Do not use the historical assistant-message anomaly in `result1/` as evidence for a current bug.
- For extension behavior changes, run at least `node --check` on changed JavaScript files and manually verify loading or behavior in Chrome or Edge.
