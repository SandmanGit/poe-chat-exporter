# Project Rules

## Scope

This repository publishes the `poe-exporter/` Chrome/Edge Manifest V3 extension, its lightweight regression checks, and project coordination notes.

Do not publish local investigation artifacts such as `result1/`, `test_web/`, `test_extension/`, or `skills/`.

## Verification

Before claiming changes are complete, run:

```bash
npm test
npm run check
```

For browser behavior changes, reload `poe-exporter/` as an unpacked extension in Chrome or Edge and manually test on a Poe chat page.

## Safety

- Do not commit secrets, tokens, cookies, `.env` files, or private chat exports.
- Do not bypass errors to make tests pass.
- Changes to `manifest.json` permissions must be explained in `README.md`.
