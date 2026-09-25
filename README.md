# Ticket Order Autofill

A local Chrome Manifest V3 extension for filling synthetic test orders. No backend, telemetry, remote scripts, or data-generation service.

## Install now

The built extension is in **`D:\Orders-data-filler\dist`**.

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the `dist` folder.
4. Pin **Ticket Order Autofill** using Chrome's Extensions menu.
5. Open your development or UAT order page and click the extension.

## Set up your order form

### SAS create-order tabs

On `https://rare-accessioning-qa.baylorgenetics.com/orders/sample/create-order`, the extension automatically offers **SAS — Create new order**. Reload the extension after installing this update, open the order page, enter a ticket, and click **Fill Order**. Keep the popup open until the results appear.

The workflow opens **Patient Information → Test Information → Provider Information** and uses these defaults:

| Section | Values / actions |
| --- | --- |
| Patient | Ticket-linked first/last name, accession and medical reference number |
| Optional synthetic patient defaults | DOB January 1, 1990 and gender Unknown; toggle in the popup |
| Sample | Blood, 1 tube, quantity 1, current local date, test code 1500 (selects its autocomplete result when present), then Add Sampletype |
| Billing and consents | Self; Consent for Testing Yes; Use of Data Opt In |
| Provider | Select TCHE in Institution Code, Search, select the first available TCHE result |

It selects **one** provider, preserves an existing TCHE provider, and does not add another if three selected providers are detected. It leaves Sequential Test Request, NY Sample Retention, Documents, and final Create Order to you. Existing patient values are preserved unless overwrite is enabled. If an existing sample input conflicts with a requested default, sample addition stops until overwrite is enabled or the field is corrected. Dropdown defaults and the two test consent choices are set explicitly.

The workflow supports native selects, labeled ng-select controls, and accessible dropdown/autocomplete options. It waits for tabs, options, added sample rows, and fresh provider results. Ambiguous options and unverified actions appear as **Needs review**. It never clicks final Create Order. An added Blood / 1500 sample or selected TCHE provider is reused on repeat runs. After an unverified Add/Select click, a page-local guard prevents a second click; inspect the form before retrying. Reload for a new order if the application clears the form without navigation.

For another SAS test environment, create a profile, choose **SAS tabs: Patient → Test → Provider**, enter the exact origin/route, and use `body` as the scope. Patient selectors are optional overrides. **Check Mapping** only checks the three tabs without navigating; fields are resolved when Fill Order opens their tab. The screenshots do not contain DOM markup: the workflow is verified against the local fixture, not the live QA website. Actual control labels, option text, or added-row layouts may require adjustments.

Local SAS fixture: run `npm run demo` and open `http://127.0.0.1:4173/orders/sample/create-order`.

### Other forms (mapped fields)

1. Choose **Set up this form**. Enter a profile name.
2. Confirm the exact origin and order route. `/orders/new` matches that path only; enabling child paths also permits `/orders/new/step`, but never `/orders/new-admin`. Query strings and fragments do not participate in route matching.
3. Set the **Form or section CSS selector** to the intended patient/order section, e.g. `#patient-order`. The selector must match exactly one element.
4. Click **Scan fields**. Confirm the four suggested mappings or enter selectors yourself. The dropdown suggestions show labels. If multiple patient/guardian fields have the same label, select the intended field explicitly. Text selectors are relative to the form scope.
5. Add only the consent groups you want answered Yes. Enter a descriptive label, a group/container selector relative to the form, and the exact Yes radio selector relative to that group. Example: group `#care-consent`, Yes `input[value="yes"]`. An explicit selector is authoritative; confirm it actually represents Yes.
6. Click **Check Mapping**, then **Save profile**. Neither action changes form values. Save requires valid mappings on the current page.

Profile setup/editing is built into the popup so it retains the page's temporary `activeTab` permission. Profiles can be selected, edited, and deleted there. The SAS preset is offered only on the exact QA order URL above; other sites require setup.

## Fill an order

1. Open the extension and select your profile.
2. Enter the **ticket number as text**, such as `ESIN-001234`. Leading zeros and letters are preserved. Surrounding whitespace is trimmed. References are case-sensitive.
3. Review the generated preview and click **Fill Order**.
4. Review the results and submit the order yourself.

### Your requested ticket behavior

- Ticket reference is **required**, overriding the PRD's optional reference.
- The same ticket and name settings produce the same first and last names, including after browser restarts. Names use an alphabetic ticket hash, with `Test` as the default prefix; they are synthetic identifiers rather than realistic patient names. Hash collisions are possible.
- Accession is `ACC-<number>` and MRN is `MRN-<the-same-number>`.
- The numeric suffix combines the ticket's first 12 digits (or its numeric hash when it has no digits), a millisecond timestamp, and 10 random digits. The complete ticket remains visible in the preview. These are probabilistically unique test references, not globally guaranteed identifiers.
- Example shape: `ACC-001234<timestamp><random>` / `MRN-001234<timestamp><random>`.
- **New Test Data** makes a fresh identifier pair while keeping names stable for the ticket. It does not change the page until Fill Order.
- The current record is retained in `chrome.storage.session`, separately for each tab and profile. Editing a profile resets that profile's record in the current tab. Browser restart clears records; names are regenerated consistently and reference numbers are fresh.
- Existing text is preserved by default. Enable **Overwrite existing text** to replace it. If one reference is prefilled and the other is empty, preserving existing text can leave a mixed pair: inspect field results and enable overwrite when you intend to replace the complete record.
- Configured consents are set to Yes regardless of the text overwrite setting. Other radio groups remain unchanged.

## Build and test

Requires Node.js 22 or newer and npm.

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run demo
```

Open `http://127.0.0.1:4173/orders/new`. Configure:

| Setting | Value |
| --- | --- |
| Origin | `http://127.0.0.1:4173` |
| Route | `/orders/new` |
| Scope | `#order` |
| First name | `#first` |
| Last name | `#last` |
| Accession | `#acc` |
| MRN | `#mrn` |
| Care consent group / Yes | `#care` / `input[value="yes"]` |
| Research consent group / Yes | `#research` / `input[value="yes"]` |

The demo includes unrelated radio controls, guardian names, a prefill button, a temporarily hidden MRN, and a controlled-input fixture with accepting/rejecting modes.

For packaged extension smoke testing, stop the demo server first (the test uses port 4173):

```powershell
npx playwright install chromium
npm run smoke
```

This launches an isolated Chrome for Testing profile, loads the real `dist` extension, triggers its action to grant `activeTab`, and exercises the bundled popup document in a background tab. Headless action popovers are not exposed as Playwright pages, so the background tab provides the UI automation surface while preserving the active order tab. No Chrome APIs are mocked. Reports/screenshots go to `test-results/`.

After changes, rebuild and click **Reload** for the extension in `chrome://extensions`.

## Limits and real-form validation

The following limits describe the original **Mapped fields** workflow. The SAS workflow's navigation, dropdowns, waits, and limitations are described above.

- Top-level, visible DOM only. No iframe, Shadow DOM, custom dropdown, or custom non-native radio support.
- Supported text input types: text, search, tel. Passwords, file inputs, hidden data inputs, disabled inputs, and read-only text are excluded.
- Names are alphabetic. Input pattern and length constraints are checked before writing. Long reference IDs may be skipped on forms with short maximum lengths; selectors and limits need validation against your application.
- Mappings must resolve uniquely. No automatic fallback or automatic navigation. Missing/hidden dynamic fields are skipped immediately; open the relevant step and invoke again when ready.
- Native setters and bubbling events support ordinary DOM inputs. The runner re-resolves controls after updates and checks persistence twice over roughly 400 ms, with a five-second run deadline. This catches the supplied rejecting fixture; it cannot prove arbitrary asynchronous framework model acceptance. JavaScript blocked by the host page can delay wall-clock completion.
- The extension does not click Submit, Save, or Next or call order APIs. Your application's own field listeners may validate or autosave.
- Only local versioned profiles and session test records are stored. No filled-form history or synchronized storage.

To adjust controls that fail on the actual form, provide sanitized HTML for those controls and their containers. Include IDs, names, labels, input constraints, and whether they are inside frames or Shadow DOM. Remove patient data and credentials. The SAS URL and visible labels come from the supplied screenshots; the actual DOM has not been inspected.

See [VERIFICATION.md](VERIFICATION.md) for observed results.

## Architecture and references

- `src/model.ts`: profiles, validation, route matching, ticket-linked data.
- `src/page.ts`: isolated-world scanning, mapping checks, native adapters, fill and verification.
- `src/sas.ts`: SAS tab navigation, dropdowns, sample addition, billing/consents, provider search and selection.
- `src/popup.ts`: profile editor, preview, local/session storage, execution UI.
- `public/`: Manifest V3 and popup markup/styles.
- `demo/`, `tests/`, `scripts/smoke.mjs`: fixtures and verification.

Uses Chrome's [`scripting` API](https://developer.chrome.com/docs/extensions/reference/api/scripting) with temporary `activeTab` access and [local/session storage](https://developer.chrome.com/docs/extensions/reference/api/storage). Installation follows Chrome's [Load unpacked workflow](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).
