# Verification

## SAS workflow update — 2026-09-25

- `npm run typecheck` and `npm run build` passed. The updated unpacked extension is in `dist/`.
- `npm test`: **13/13 passed**, including the original eight tests and five SAS tests for read-only setup checks, all three tabs, delayed custom dropdowns/autocomplete, current local sample date, sample addition, provider selection, repeat runs, route restriction, preserving existing values, the three-provider limit, and preventing retries after unconfirmed Add/Select clicks.
- `npm run smoke`: both mapped-form and SAS packaged extension tests passed in Chrome for Testing **153.0.8010.12**.
- SAS initial fill: **17 filled, 0 unchanged, 0 skipped, 0 failed** in 4,881 ms. One sample was added, Search was clicked once, and one TCHE provider was selected.
- SAS repeat: **0 filled, 11 unchanged, 0 skipped, 0 failed** in 665 ms; no duplicate sample or provider.
- Verified Yes testing consent, Opt In data use, optional synthetic DOB/gender, empty provider name filters, and no final submission. Sequential test request and NY retention remained unchecked.
- Reviewed the generated SAS popup screenshot for legibility. Screenshots and results are in `test-results/sas-*.png` and `test-results/sas-smoke.json`.

These are local DOM fixture and real packaged-extension tests, not tests against the authenticated QA site. The screenshot-based labels and control adapters still need validation against its actual HTML, dropdown options, and selected-row layouts. The workflow reports unresolved/ambiguous controls and unconfirmed additions for review. It supports native radios, native selects, ng-select, and accessible dropdown options; frames and Shadow DOM are not supported. The 90-second workflow deadline is cooperative.

## Original mapped-form verification — 2026-09-15

## Passed

- TypeScript strict check: `npm run typecheck`.
- Production build: `npm run build`; `dist/manifest.json`, `popup.html`, `style.css`, and bundled `popup.js` produced.
- `npm test`: **8/8 tests passed**. Covered origin/path boundaries, string ticket handling, stable names, paired fresh numeric references, overwrite behavior, consent isolation, repeated runs, duplicate selectors/alias mappings, disabled controls, input length constraints, mismatched scope, accepted replacement nodes, delayed rejected values, missing fields, and overlap prevention.
- `npm run smoke`: passed in **Chrome for Testing 153.0.8010.12**, using the actual unpacked extension, Chrome storage, scripting injection, and popup UI logic.
- Initial browser demo fill: **6 filled, 0 unchanged, 0 skipped, 0 failed in 430 ms** (four text inputs and two native consent groups).
- Form-model fixture retained the generated first name across synchronous DOM replacement.
- Care and research consents became Yes; unrelated brochure answer and guardian fields stayed unchanged.
- No form submission occurred.
- Popup reopened with the saved profile, string ticket, and same session record. Repeat fill reported six unchanged.
- New Test Data left the page unchanged. With overwrite enabled, only the two regenerated references changed; ticket names remained stable.
- Rejecting fixture: **3 filled, 2 unchanged, 1 failed in 424 ms**. The rejected first name was correctly reported as failed.
- Extended 20-control browser benchmark: **18 filled, 2 unchanged, 0 skipped, 0 failed in 422 ms**, below the two-second target. This uses four text fields and sixteen explicitly mapped consent groups.
- Inspected the generated popup screenshot for text legibility and layout.

## Test boundary / remaining validation

The smoke harness triggers the extension action, then opens its bundled popup HTML in a background tab because headless popovers are not surfaced as Playwright pages. This tests real extension-to-page communication and permission acquisition without mocked APIs. The visible toolbar popover size/scrolling and installation in the user's regular Chrome profile have not been manually verified.

Dynamic missing controls are skipped promptly; the runner does not wait for them to appear. The five-second bound is a cooperative deadline and cannot interrupt a host page blocking JavaScript.

No real organization order form, framework adapter, or application backend has been tested. Framework-specific model acceptance beyond the demo's DOM replacement/rejection fixtures needs supplied markup and validation in development/UAT. Iframes, Shadow DOM, and custom controls are outside the implemented scope.

Artifacts: `test-results/smoke.json`, `test-results/popup.png`, `test-results/demo.png`. Browser test artifacts are ignored by Git; rerun `npm run smoke` to regenerate.
