"use strict";
(() => {
  // src/model.ts
  var fields = ["firstName", "lastName", "accession", "mrn"];
  function matches(url, p) {
    const u = new URL(url);
    return u.origin === p.origin && (u.pathname === p.route || p.descendants && u.pathname.startsWith(p.route === "/" ? "/" : p.route + "/"));
  }
  function validate(p) {
    const u = new URL(p.origin);
    if (!["http:", "https:"].includes(u.protocol) || u.origin !== p.origin) throw Error("Use an exact HTTP or HTTPS origin without a trailing slash.");
    if (!p.name.trim() || !p.scope.trim() || !p.route.startsWith("/") || /[?#]/.test(p.route) || p.route !== "/" && p.route.endsWith("/")) throw Error("Enter a name, scope, and pathname (no query, fragment, or trailing slash).");
    if (p.workflow && p.workflow !== "sas") throw Error("Unknown form workflow.");
    if (!p.workflow && !fields.every((f) => p.mappings[f].trim())) throw Error("Map all four text fields.");
    if (!/^[A-Za-z]*$/.test(p.prefix) || !Number.isInteger(p.maxLength) || p.maxLength < p.prefix.length + 8 || p.maxLength > 100) throw Error("Use an alphabetic prefix and a name limit between prefix length + 8 and 100.");
    if (p.consents.length > 16 || p.consents.some((c) => !c.label.trim() || !c.group.trim() || !c.yes.trim())) throw Error("Each consent needs a label, group selector, and explicit Yes selector; maximum 16.");
  }
  function sasProfile(origin = "https://rare-accessioning-qa.baylorgenetics.com") {
    return {
      version: 1,
      id: "sas-qa",
      name: "SAS \u2014 Create new order",
      origin,
      route: "/orders/sample/create-order",
      descendants: false,
      scope: "body",
      mappings: { firstName: "", lastName: "", accession: "", mrn: "" },
      consents: [],
      prefix: "Test",
      maxLength: 30,
      overwrite: false,
      workflow: "sas",
      patientDefaults: true
    };
  }
  function generate(ticket, p) {
    ticket = ticket.trim();
    if (!ticket || ticket.length > 120) throw Error("Enter a ticket reference (1\u2013120 characters).");
    let hash = 2166136261;
    for (const c of ticket) hash = Math.imul(hash ^ c.codePointAt(0), 16777619) >>> 0;
    const letters = (n) => {
      let s = "";
      for (let i = 0; i < 7; i++) {
        s += String.fromCharCode(97 + n % 26);
        n = Math.floor(n / 26);
      }
      return s;
    };
    const suffix = (ticket.replace(/\D/g, "").slice(0, 12) || String(hash)) + Date.now() + String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(10, "0");
    return { ticket, firstName: (p.prefix + "A" + letters(hash)).slice(0, p.maxLength), lastName: (p.prefix + "Z" + letters((hash ^ 2654435769) >>> 0)).slice(0, p.maxLength), accession: "ACC-" + suffix, mrn: "MRN-" + suffix };
  }

  // src/page.ts
  async function pageAction(req) {
    const start = Date.now(), deadline = start + 5e3, p = req.profile;
    const outcomes = [];
    const result = () => ({ outcomes, elapsed: Date.now() - start });
    const allowed = () => location.origin === p.origin && (location.pathname === p.route || p.descendants && location.pathname.startsWith(p.route === "/" ? "/" : p.route + "/"));
    const one = (root, selector) => {
      const found = root.querySelectorAll(selector);
      if (found.length !== 1) throw Error(`Selector matched ${found.length} controls; expected exactly 1: ${selector}`);
      return found[0];
    };
    const scope = () => {
      if (!allowed()) throw Error("Page is outside the configured origin/route.");
      if (Date.now() >= deadline) throw Error("Five-second run limit reached.");
      return one(document, p.scope);
    };
    const visible = (el) => {
      const css = getComputedStyle(el);
      return !!el.getClientRects().length && css.visibility !== "hidden" && css.visibility !== "collapse" && css.display !== "none" && !el.closest("[inert]");
    };
    const textControl = (el) => {
      if (!(el instanceof HTMLInputElement) || !["text", "search", "tel"].includes(el.type)) throw Error("Target must be a supported text input.");
      if (el.matches(":disabled") || el.readOnly || !visible(el)) throw Error("Input is disabled, read-only, or hidden.");
      return el;
    };
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const label = (el) => Array.from(el.labels || []).map((l) => l.textContent?.trim()).join(" ") || el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim() || el.placeholder || el.name || el.id;
    try {
      const root = scope();
      if (req.action === "scan") {
        const candidates = Array.from(root.querySelectorAll("input")).filter((el) => !["password", "file", "hidden"].includes(el.type)).map((el) => {
          let selector = el.id ? "#" + CSS.escape(el.id) : el.name ? `input[name=${JSON.stringify(el.name)}]` + (el.type === "radio" ? `[value=${JSON.stringify(el.value)}]` : "") : "";
          if (!selector || root.querySelectorAll(selector).length !== 1) selector = "";
          return { label: [label(el), el.autocomplete, el.name].filter(Boolean).join(" \xB7 "), selector, type: el.type };
        });
        return { ...result(), candidates };
      }
      const entries = Object.entries(p.mappings);
      const resolveText = (sel) => textControl(one(scope(), sel));
      const resolveRadio = (c) => {
        const group = one(scope(), c.group), el = one(group, c.yes);
        if (!(el instanceof HTMLInputElement) || el.type !== "radio" || el.matches(":disabled")) throw Error("Yes target must be an enabled native radio.");
        if (!el.name) throw Error("Radio must have a name for native group exclusivity.");
        const siblings = Array.from(document.querySelectorAll("input[type=radio]")).filter((r) => r.name === el.name && r.form === el.form);
        if (siblings.some((r) => !group.contains(r))) throw Error("Radio group extends outside the mapped group.");
        const interactive = visible(el) ? el : Array.from(el.labels || []).find(visible);
        if (!interactive || el.closest("[inert]")) throw Error("No visible interactive radio or label.");
        return { el, interactive };
      };
      if (req.action === "check") {
        for (const [field, sel] of entries) {
          try {
            resolveText(sel);
            outcomes.push({ field, status: "unchanged", reason: "Exactly one editable text input matched." });
          } catch (e) {
            outcomes.push({ field, status: "skipped", reason: String(e) });
          }
        }
        for (const c of p.consents) {
          try {
            resolveRadio(c);
            outcomes.push({ field: c.label, status: "unchanged", reason: "Exactly one group and explicit Yes target matched." });
          } catch (e) {
            outcomes.push({ field: c.label, status: "skipped", reason: String(e) });
          }
        }
        return result();
      }
      const state = globalThis;
      if (state.__ticketFillRunning) throw Error("A fill is already running in this page.");
      if (!req.record?.ticket) throw Error("Ticket-linked test data is required.");
      state.__ticketFillRunning = true;
      const verify = [];
      try {
        const targets = entries.map(([field, sel]) => {
          try {
            return { field, el: one(scope(), sel) };
          } catch {
            return { field, el: null };
          }
        });
        for (const [field, sel] of entries) {
          let wrote = false;
          try {
            scope();
            if (targets.some((t) => t.field === field && t.el && targets.some((other) => other.field !== field && other.el === t.el))) throw Error("Multiple text mappings point to the same input.");
            const el = resolveText(sel), value = req.record[field];
            if (typeof value !== "string") throw Error("Missing generated value.");
            if (el.value === value || el.value !== "" && !req.overwrite) {
              outcomes.push({ field, status: "unchanged", reason: el.value === value ? "Already contains this record." : "Existing text preserved; enable overwrite to replace it." });
              continue;
            }
            if (el.maxLength >= 0 && value.length > el.maxLength || el.minLength > 0 && value.length < el.minLength) throw Error("Generated value does not satisfy input length constraints.");
            const probe = el.cloneNode();
            probe.value = value;
            if (!probe.checkValidity()) throw Error("Generated value does not satisfy the input pattern or constraints.");
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
            wrote = true;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            resolveText(sel).dispatchEvent(new Event("change", { bubbles: true }));
            const outcome = { field, status: "filled", reason: "Value accepted after verification." };
            outcomes.push(outcome);
            verify.push({ outcome, read: () => resolveText(sel).value === value });
          } catch (e) {
            outcomes.push({ field, status: wrote ? "failed" : "skipped", reason: String(e) });
          }
        }
        for (const c of p.consents) {
          let wrote = false;
          try {
            const { el, interactive } = resolveRadio(c);
            const outcome = { field: c.label, status: el.checked ? "unchanged" : "filled", reason: el.checked ? "Already set to Yes." : "Yes selection verified." };
            if (!el.checked) {
              wrote = true;
              interactive.click();
            }
            outcomes.push(outcome);
            verify.push({ outcome, read: () => resolveRadio(c).el.checked });
          } catch (e) {
            outcomes.push({ field: c.label, status: wrote ? "failed" : "skipped", reason: String(e) });
          }
        }
        for (const delay of [120, 280]) {
          await pause(Math.max(0, Math.min(delay, deadline - Date.now())));
          for (const item of verify) {
            try {
              if (!item.read()) throw Error("Application rejected or reverted the value.");
            } catch (e) {
              item.outcome.status = "failed";
              item.outcome.reason = String(e);
            }
          }
        }
      } finally {
        state.__ticketFillRunning = false;
      }
    } catch (e) {
      outcomes.push({ field: "Form", status: "failed", reason: String(e) });
    }
    return result();
  }

  // src/sas.ts
  async function sasAction(req) {
    const start = Date.now(), deadline = start + 9e4, p = req.profile;
    const outcomes = [];
    const state = globalThis;
    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const pause = (ms = 100) => new Promise((r) => setTimeout(r, ms));
    const guard = () => {
      if (location.origin !== p.origin || !(location.pathname === p.route || p.descendants && location.pathname.startsWith(p.route === "/" ? "/" : p.route + "/"))) throw Error("Page is outside the configured origin/route.");
      if (Date.now() > deadline) throw Error("SAS workflow reached its 90-second limit.");
    };
    const visible = (el) => {
      const css = getComputedStyle(el);
      return !!el.getClientRects().length && css.display !== "none" && !["hidden", "collapse"].includes(css.visibility) && !el.closest('[hidden],[inert],[aria-hidden="true"]');
    };
    const enabled = (el) => !el.matches(':disabled,[aria-disabled="true"],.ng-select-disabled,.ng-option-disabled,.mat-option-disabled,.mat-mdc-option-disabled') && !el.closest("[inert]");
    const root = () => {
      guard();
      const found = document.querySelectorAll(p.scope);
      if (found.length !== 1) throw Error("Form scope must match exactly one element.");
      return found[0];
    };
    const all = (selector, scope = root()) => Array.from(scope.querySelectorAll(selector)).filter(visible);
    const unique = (items, label) => {
      const deduped = Array.from(new Set(items));
      if (deduped.length !== 1) throw Error(`${label}: found ${deduped.length} controls; expected one. Check the page labels or profile mappings.`);
      return deduped[0];
    };
    const wait = async (read, description, ms = 6e3) => {
      const until = Math.min(deadline, Date.now() + ms);
      do {
        guard();
        const value = read();
        if (value) return value;
        await pause();
      } while (Date.now() < until);
      throw Error(`Timed out waiting for ${description}.`);
    };
    const text = (el) => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll("mat-icon,.material-icons,svg").forEach((n) => n.remove());
      clone.querySelectorAll('td,th,[role="cell"]').forEach((n) => n.append(" "));
      return clone.textContent?.trim() || "";
    };
    const click = (el) => {
      guard();
      if (!visible(el) || !enabled(el)) throw Error("Control is hidden or disabled.");
      el.click();
    };
    const named = (selector, names, scope = root()) => all(selector, scope).filter((el) => names.some((n) => norm(text(el)) === norm(n) || norm(el.getAttribute("aria-label")) === norm(n)));
    const button = (names, scope = root()) => unique(named('button,[role="button"],input[type="button"]', names, scope), names[0]);
    const labelTexts = (el) => {
      const native = el;
      const labels = Array.from(native.labels || []).map((l) => text(l));
      labels.push(...["aria-label", "placeholder", "name", "id", "formcontrolname"].map((a) => el.getAttribute(a) || ""));
      labels.push(...(el.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || ""));
      let container = el.parentElement;
      for (let level = 0; container && level < 3; level++, container = container.parentElement) {
        const controls = Array.from(container.querySelectorAll('input:not([type="hidden"]),select,ng-select,mat-select,[role="combobox"]'));
        const unrelated = controls.some((other) => other !== el && !other.contains(el) && !el.contains(other));
        if (unrelated) break;
        labels.push(...Array.from(container.querySelectorAll("label,mat-label,.ng-placeholder")).map((l) => text(l)));
      }
      return labels;
    };
    const control = (names, dropdown2 = false, mapping) => {
      if (mapping) return unique(all(mapping), names[0]);
      const selector = dropdown2 ? 'select,ng-select,mat-select,[role="combobox"]' : 'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="password"]):not([type="file"]),textarea';
      let candidates = all(selector).filter((el) => labelTexts(el).some((l) => names.some((n) => norm(l) === norm(n))));
      if (dropdown2) candidates = candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
      return unique(candidates, names[0]);
    };
    const hasControl = (names, dropdown2 = false) => {
      try {
        return control(names, dropdown2);
      } catch {
        return void 0;
      }
    };
    const write = (el, value) => {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el instanceof HTMLInputElement && !["text", "search", "tel", "number", "date"].includes(el.type) || el.readOnly || !enabled(el)) throw Error("Expected an editable text, number, or date input.");
      const probe = el.cloneNode();
      probe.value = value;
      if (el.maxLength >= 0 && value.length > el.maxLength || !probe.checkValidity()) throw Error("Value does not satisfy this field\u2019s constraints.");
      const prototype = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (el.isConnected) {
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    };
    const field = async (caption, names, value, mapping) => {
      const read = () => control(names, false, mapping);
      const el = read();
      if (el.value === value || el.value && !req.overwrite) {
        outcomes.push({ field: caption, status: "unchanged", reason: el.value === value ? "Already set." : "Existing value preserved." });
        return;
      }
      write(el, value);
      await pause(300);
      if (read().value !== value) throw Error(`${caption}: application rejected or reverted the value.`);
      outcomes.push({ field: caption, status: "filled", reason: "Value verified." });
    };
    const tab = async (name, ready) => {
      const el = unique(named('[role="tab"],.mat-tab-label,.mat-mdc-tab,button,a', [name]), name);
      click(el);
      await wait(() => ready() ? true : void 0, `${name} fields`);
      await pause(200);
    };
    const optionMatches = (value, desired) => norm(value) === norm(desired);
    const dropdownValue = (el, desired) => {
      if (el instanceof HTMLSelectElement) return Array.from(el.selectedOptions).some((o) => optionMatches(o.textContent || "", desired));
      return Array.from(el.querySelectorAll(".ng-value-label,.mat-select-value-text,.mat-mdc-select-value-text,[data-selected-value]")).some((n) => optionMatches(text(n), desired)) || el.getAttribute("aria-expanded") !== "true" && optionMatches(text(el), desired);
    };
    const dropdown = async (caption, names, desired) => {
      let el = control(names, true);
      if (dropdownValue(el, desired)) {
        outcomes.push({ field: caption, status: "unchanged", reason: `Already ${desired}.` });
        return;
      }
      if (!enabled(el)) throw Error(`${caption} is disabled.`);
      if (el instanceof HTMLSelectElement) {
        const options = Array.from(el.options).filter((o) => !o.disabled && optionMatches(o.textContent || "", desired));
        if (options.length !== 1) throw Error(`${caption}: expected one exact ${desired} option.`);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, options[0].value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        const before = new Set(all('[role="option"],.ng-option,mat-option', document));
        click(el.querySelector(".ng-select-container") || el);
        const input = el instanceof HTMLInputElement ? el : el.querySelector('input:not([type="hidden"])');
        if (input && !input.readOnly) write(input, desired);
        const options = () => {
          el = control(names, true);
          const ids = [el, ...Array.from(el.querySelectorAll("[aria-controls],[aria-owns]"))].flatMap((n) => `${n.getAttribute("aria-controls") || ""} ${n.getAttribute("aria-owns") || ""}`.trim().split(/\s+/)).filter(Boolean);
          const panels = ids.map((id) => document.getElementById(id)).filter((n) => !!n);
          return all('[role="option"],.ng-option,mat-option', document).filter((o) => enabled(o) && (panels.length ? panels.some((panel) => panel.contains(o)) : !before.has(o)) && optionMatches(text(o), desired));
        };
        const found = await wait(() => {
          const items = options();
          if (items.length > 1) throw Error(`${caption}: ambiguous ${desired} options.`);
          return items[0];
        }, `${caption} option ${desired}`);
        click(found);
      }
      await wait(() => dropdownValue(control(names, true), desired), `${caption} selection`);
      outcomes.push({ field: caption, status: "filled", reason: `${desired} selected.` });
    };
    const radio = async (caption, groupNames, option, preserve = false) => {
      const labels = all("label,legend,mat-label,p,span,div").filter((el) => groupNames.some((n) => norm(text(el)) === norm(n)));
      const groups = [];
      for (const label of labels) {
        let node = label;
        for (let i = 0; node && i < 5; i++, node = node.parentElement) {
          if (node.querySelector('input[type="radio"],[role="radio"]')) {
            groups.push(node);
            break;
          }
        }
      }
      let group = unique(Array.from(new Set(groups)).filter((g) => !groups.some((other) => other !== g && g.contains(other))), caption);
      const radios = Array.from(group.querySelectorAll('input[type="radio"]'));
      const targets = radios.filter((r) => labelTexts(r).some((l) => norm(l) === norm(option)) || norm(r.value) === norm(option));
      const target = unique(targets, `${caption}: ${option}`);
      if (!target.name || Array.from(document.querySelectorAll('input[type="radio"]')).some((r) => r.name === target.name && r.form === target.form && !group.contains(r))) throw Error(`${caption}: radio group is not isolated.`);
      if (target.checked || preserve && radios.some((r) => r.checked) && !req.overwrite) {
        outcomes.push({ field: caption, status: "unchanged", reason: "Existing selection preserved." });
        return;
      }
      if (!enabled(target)) throw Error(`${caption} is disabled.`);
      const interactive = visible(target) ? target : Array.from(target.labels || []).find(visible);
      if (!interactive) throw Error(`${caption}: no interactive radio label.`);
      click(interactive);
      await pause(250);
      group = root();
      const current = Array.from(group.querySelectorAll('input[type="radio"]')).find((r) => r.name === target.name && r.value === target.value);
      if (!current?.checked) throw Error(`${caption}: selection was not accepted.`);
      outcomes.push({ field: caption, status: "filled", reason: `${option} selected.` });
    };
    const attempt = async (name, fn) => {
      try {
        await fn();
        return true;
      } catch (e) {
        outcomes.push({ field: name, status: "failed", reason: e instanceof Error ? e.message : String(e) });
        return false;
      }
    };
    const sampleRows = () => all('tr,[role="row"],.card,mat-card,.sample-card,.sample-item').filter((el) => /\bblood\b/i.test(text(el)) && /\b1500\b/.test(text(el)) && !el.querySelector('input,ng-select,select,[role="combobox"]'));
    const selectedProviders = () => {
      const headings = all("h1,h2,h3,h4,legend,div,span").filter((el) => ["selectedproviders", "selectedprovider"].includes(norm(text(el))));
      for (const heading of headings) {
        let parent = heading.parentElement;
        for (let i = 0; parent && i < 3; i++, parent = parent.parentElement) {
          const rows = all('tr,[role="row"],.provider-card,.provider-item', parent).filter((row) => (row.querySelector('td,[role="cell"]') || named('button,[role="button"]', ["Remove", "Deselect"], row).length) && !named('button,[role="button"]', ["Select"], row).length);
          if (rows.length) return rows;
        }
      }
      return [];
    };
    let locked = false;
    try {
      const scope = root();
      if (req.action !== "fill") {
        for (const name of ["Patient Information", "Test Information", "Provider Information"]) unique(named('[role="tab"],.mat-tab-label,.mat-mdc-tab,button,a', [name]), name);
        outcomes.push({ field: "SAS workflow", status: "unchanged", reason: "Three form tabs found. Controls are resolved by label when each tab opens; check does not navigate or change values." });
        return { outcomes, elapsed: Date.now() - start };
      }
      if (state.__ticketFillRunning) throw Error("A fill is already running in this page.");
      if (!req.record?.ticket) throw Error("Ticket-linked test data is required.");
      state.__ticketFillRunning = true;
      locked = true;
      if (!state.__sasAdds || state.__sasAdds.root !== scope) state.__sasAdds = { root: scope };
      const ledger = state.__sasAdds;
      await attempt("Patient Information", async () => {
        await tab("Patient Information", () => hasControl(["First Name"], false));
        const entries = [
          ["firstName", ["First Name"]],
          ["lastName", ["Last Name"]],
          ["accession", ["AccessionNumber", "Accession Number"]],
          ["mrn", ["Medical Reference Number", "Medical Record Number", "MRN"]]
        ];
        for (const [key, names] of entries) await attempt(names[0], () => field(names[0], [...names], req.record[key], p.mappings[key]));
        if (p.patientDefaults) {
          await attempt("Date of Birth", async () => {
            const input = control(["Date of Birth", "DOB"]);
            await field("Date of Birth", ["Date of Birth", "DOB"], input.type === "date" ? "1990-01-01" : "01/01/1990");
          });
          await attempt("Patient Gender", () => radio("Patient Gender", ["Patient Gender", "Gender"], "Unknown", true));
        } else outcomes.push({ field: "DOB / gender", status: "skipped", reason: "Patient defaults disabled; complete required fields manually." });
      });
      await attempt("Test Information", async () => {
        await tab("Test Information", () => hasControl(["Sample Type", "Select Sample Type"], true));
        if (sampleRows().length) outcomes.push({ field: "Add sample", status: "unchanged", reason: "A Blood / 1500 sample already exists; no duplicate added. Review its quantity and date." });
        else if (ledger.sample) outcomes.push({ field: "Add sample", status: "skipped", reason: "Add was already clicked on this page. Review the sample list before retrying; reload the page for a new order." });
        else await attempt("Add sample", async () => {
          await dropdown("Sample Type", ["Sample Type", "Select Sample Type"], "Blood");
          const ensureSampleField = async (caption, names, value) => {
            await field(caption, names, value);
            if (control(names).value !== value) throw Error(`${caption}: existing value differs from the sample default. Enable overwrite to add the requested sample.`);
          };
          await ensureSampleField("Number of Tubes", ["Number of Tubes", "Enter no of tubes"], "1");
          await ensureSampleField("Sample Quantity", ["Sample Quantity", "Enter sample quantity"], "1");
          const today = /* @__PURE__ */ new Date(), date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          const dateInput = control(["Sample Date"]);
          await ensureSampleField("Sample Date", ["Sample Date"], dateInput.type === "date" ? date : `${date.slice(5, 7)}/${date.slice(8)}/${date.slice(0, 4)}`);
          const testNames = ["Client Test Code/Test Code/Test Name/Hospital Code", "Test Code"];
          const testInput = control(testNames);
          if (testInput.value && testInput.value !== "1500" && !req.overwrite) throw Error("Existing test code preserved. Enable overwrite to use 1500.");
          const before = new Set(all('[role="option"],.ng-option,mat-option', document));
          write(testInput, "1500");
          const autocomplete = testInput.getAttribute("role") === "combobox" || testInput.hasAttribute("aria-autocomplete") || !!testInput.closest("ng-select") || testInput.hasAttribute("matAutocomplete");
          if (autocomplete) {
            const option = await wait(() => {
              const ids = `${testInput.getAttribute("aria-controls") || ""} ${testInput.getAttribute("aria-owns") || ""}`.trim().split(/\s+/).filter(Boolean);
              const options = all('[role="option"],.ng-option,mat-option', document).filter((el) => enabled(el) && (ids.length ? ids.some((id) => document.getElementById(id)?.contains(el)) : !before.has(el)) && /^1500(?:\b|\s*[-:])/i.test(text(el).trim()));
              if (options.length > 1) throw Error("Multiple tests match code 1500; select the intended test manually.");
              return options[0];
            }, "test code 1500 result");
            click(option);
          } else {
            await pause(300);
            if (control(testNames).value !== "1500") throw Error("Test code was rejected.");
          }
          outcomes.push({ field: "Test Code", status: "filled", reason: "1500 entered / selected." });
          const add = await wait(() => {
            const b = button(["Add Sampletype", "Add Sample Type", "Add Samples", "Add Sample"]);
            return enabled(b) ? b : void 0;
          }, "enabled Add Sample button");
          ledger.sample = true;
          click(add);
          await wait(() => sampleRows().length > 0, "added Blood / 1500 sample row");
          outcomes.push({ field: "Add sample", status: "filled", reason: "Blood / 1500 sample appears in the sample list." });
        });
        await attempt("Bill Type", () => dropdown("Bill Type", ["Bill Type", "Select Bill Type"], "Self"));
        await attempt("Consent for Testing", () => radio("Consent for Testing", ["Consent for Testing"], "Yes"));
        await attempt("Use of Data", () => radio("Use of Data", ["Use of Data"], "Opt In"));
      });
      await attempt("Provider Information", async () => {
        await tab("Provider Information", () => hasControl(["Institution Code"], true));
        const existing = selectedProviders();
        if (existing.some((row) => /\bTCHE\b/i.test(text(row)))) {
          outcomes.push({ field: "Provider", status: "unchanged", reason: "A TCHE provider is already selected; no additional provider added." });
          return;
        }
        if (existing.length >= 3) {
          outcomes.push({ field: "Provider", status: "skipped", reason: "Three providers are already selected. No provider added." });
          return;
        }
        if (ledger.provider) {
          outcomes.push({ field: "Provider", status: "skipped", reason: "Select was already clicked on this page. Review the selected providers; no duplicate selection attempted." });
          return;
        }
        await dropdown("Institution Code", ["Institution Code"], "TCHE");
        for (const names of [["First Name"], ["Last Name"], ["NPI"], ["Phone #"], ["Fax #"], ["Email"]]) {
          const input = hasControl(names);
          if (input?.value) throw Error("Clear existing provider search filters to search only TCHE.");
        }
        const eligible = () => all('tr,[role="row"]').filter((row) => Array.from(row.querySelectorAll('td,[role="cell"]')).some((cell) => norm(text(cell)) === "tche") && named('button,[role="button"]', ["Select"], row).some(enabled));
        const previousRows = new Map(eligible().map((row) => [row, text(row)]));
        let changed = previousRows.size === 0;
        const observer = new MutationObserver(() => {
          if (Array.from(previousRows).some(([row, value]) => !row.isConnected || !visible(row) || text(row) !== value)) changed = true;
        });
        observer.observe(root(), { subtree: true, childList: true, characterData: true, attributes: true });
        try {
          click(button(["Search"]));
          const row = await wait(() => {
            const rows = eligible();
            return changed || rows.some((r) => !previousRows.has(r)) ? rows[0] : void 0;
          }, "fresh TCHE provider search results", 12e3);
          ledger.provider = true;
          click(button(["Select"], row));
          await wait(() => selectedProviders().some((selected2) => /\bTCHE\b/i.test(text(selected2))) || row.isConnected && named('button,[role="button"]', ["Selected", "Remove", "Deselect"], row).length > 0, "selected TCHE provider");
          outcomes.push({ field: "Provider", status: "filled", reason: "One TCHE provider selected (below the maximum of three)." });
        } finally {
          observer.disconnect();
        }
      });
    } catch (e) {
      outcomes.push({ field: "SAS workflow", status: "failed", reason: e instanceof Error ? e.message : String(e) });
    } finally {
      if (locked) state.__ticketFillRunning = false;
    }
    return { outcomes, elapsed: Date.now() - start };
  }

  // src/popup.ts
  var $ = (id) => document.getElementById(id);
  var captions = { firstName: "First name", lastName: "Last name", accession: "Accession number", mrn: "MRN" };
  var profiles = [];
  var active;
  var record;
  var tabId;
  var pageUrl = "";
  var editingId = "";
  var busy = false;
  var selected = () => profiles.find((p) => p.id === $("profiles").value);
  var sessionKey = () => `record:${tabId}:${active?.id}`;
  function message(text) {
    $("results").textContent = text;
  }
  function show(outcomes, elapsed) {
    const counts = (s) => outcomes.filter((o) => o.status === s).length;
    const heading = document.createElement("strong");
    heading.textContent = `${counts("failed") || counts("skipped") ? "Needs review" : "Complete"}: ${counts("filled")} filled \xB7 ${counts("unchanged")} unchanged \xB7 ${counts("skipped")} skipped \xB7 ${counts("failed")} failed (${elapsed} ms)`;
    const ul = document.createElement("ul");
    for (const o of outcomes) {
      const li = document.createElement("li");
      li.className = o.status;
      li.textContent = `${o.field}: ${o.status} \u2014 ${o.reason}`;
      ul.append(li);
    }
    $("results").replaceChildren(heading, ul);
  }
  function preview() {
    $("preview").replaceChildren();
    if (!record) {
      $("preview").textContent = "Enter your ticket to preview test data.";
      return;
    }
    for (const [label, value] of [["Ticket", record.ticket], ["First name", record.firstName], ["Last name", record.lastName], ["Accession", record.accession], ["MRN", record.mrn]]) {
      const line = document.createElement("div");
      line.textContent = `${label}: ${value}`;
      $("preview").append(line);
    }
  }
  async function ensureRecord(fresh = false) {
    if (!active) throw Error("Save and select a form profile first.");
    const ticket = $("ticket").value.trim();
    if (fresh || !record || record.ticket !== ticket) {
      record = generate(ticket, active);
      await chrome.storage.session.set({ [sessionKey()]: record });
    }
    preview();
  }
  async function select() {
    active = selected();
    record = void 0;
    if (active) {
      const key = sessionKey();
      record = (await chrome.storage.session.get(key))[key];
      $("overwrite").checked = active.overwrite;
    }
    $("ticket").value = record?.ticket || "";
    $("consentSummary").textContent = active?.workflow === "sas" ? "SAS: Blood \xB7 1 tube \xB7 quantity 1 \xB7 today \xB7 test 1500 \xB7 Add sample \xB7 Self bill \xB7 testing Yes \xB7 data Opt In \xB7 one TCHE provider." : `Configured consents will be set to Yes (${active?.consents.length || 0}). ${active?.consents.map((c) => c.label).join(", ") || ""}`;
    $("patientDefaultsRow").hidden = active?.workflow !== "sas";
    $("patientDefaults").checked = active?.patientDefaults ?? true;
    preview();
    await chrome.storage.local.set({ selectedProfile: active?.id || "" });
  }
  function renderProfiles(id) {
    const select2 = $("profiles");
    select2.replaceChildren();
    if (!profiles.length) select2.add(new Option("Set up a form to get started", ""));
    for (const p of profiles) select2.add(new Option(p.name, p.id));
    if (id) select2.value = id;
  }
  function consentRow(c = { label: "", group: "", yes: "" }) {
    const row = document.createElement("div");
    row.className = "consent";
    for (const key of ["label", "group", "yes"]) {
      const label = document.createElement("label");
      label.textContent = { label: "Consent label", group: "Group CSS selector", yes: "Yes option CSS selector" }[key];
      const input = document.createElement("input");
      input.dataset.key = key;
      input.value = c[key];
      input.required = true;
      label.append(input);
      row.append(label);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.onclick = () => row.remove();
    row.append(remove);
    $("consents").append(row);
  }
  function edit(p) {
    editingId = p?.id || "";
    const u = new URL(pageUrl);
    $("profileName").value = p?.name || "";
    $("origin").value = p?.origin || u.origin;
    $("route").value = p?.route || u.pathname;
    $("descendants").checked = p?.descendants || false;
    $("scope").value = p?.scope || "form";
    $("workflow").value = p?.workflow || "mapped";
    workflowUI();
    for (const field of fields) $(field).value = p?.mappings[field] || "";
    $("prefix").value = p?.prefix ?? "Test";
    $("maxLength").value = String(p?.maxLength || 30);
    $("defaultOverwrite").checked = p?.overwrite || false;
    $("consents").replaceChildren();
    p?.consents.forEach(consentRow);
    $("editor").open = true;
    $("profileName").focus();
  }
  function workflowUI() {
    const sas = $("workflow").value === "sas";
    for (const f of fields) $(f).required = !sas;
    $("mappedConsents").hidden = sas;
    $("scan").hidden = sas;
    $("mappingHint").textContent = sas ? "Patient selectors are optional overrides. The SAS workflow finds controls by label in each tab." : "Suggestions use labels and field metadata. Confirm the intended patient section.";
  }
  function draft() {
    return { version: 1, id: editingId || crypto.randomUUID(), name: $("profileName").value.trim(), origin: $("origin").value.trim(), route: $("route").value.trim(), descendants: $("descendants").checked, scope: $("scope").value.trim(), mappings: Object.fromEntries(fields.map((f) => [f, $(f).value.trim()])), consents: $("workflow").value === "sas" ? [] : Array.from(document.querySelectorAll(".consent")).map((row) => Object.fromEntries(Array.from(row.querySelectorAll("input")).map((i) => [i.dataset.key, i.value.trim()]))), prefix: $("prefix").value, maxLength: Number($("maxLength").value), overwrite: $("defaultOverwrite").checked, workflow: $("workflow").value === "sas" ? "sas" : void 0, patientDefaults: profiles.find((p) => p.id === editingId)?.patientDefaults ?? true };
  }
  async function invoke(action, profile) {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: profile.workflow === "sas" ? sasAction : pageAction, args: [{ action, profile, record, overwrite: $("overwrite").checked }] });
    if (!result?.result) throw Error("The page did not return a result. Reopen the extension on the order page.");
    return result.result;
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    const buttons = Array.from(document.querySelectorAll("button"));
    buttons.forEach((b) => b.disabled = true);
    try {
      await fn();
    } catch (e) {
      message(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
      buttons.forEach((b) => b.disabled = false);
    }
  }
  function suggestions(candidates) {
    for (const f of fields) {
      const list = $(`list-${f}`);
      list.replaceChildren();
      for (const c of candidates.filter((c2) => ["text", "search", "tel"].includes(c2.type) && c2.selector)) list.append(new Option(c.label, c.selector));
      const pattern = { firstName: /first.?name|given-name/i, lastName: /last.?name|family-name|surname/i, accession: /accession/i, mrn: /\bmrn\b|medical.?record/i }[f];
      const matches2 = candidates.filter((c) => c.type !== "radio" && pattern.test(c.label));
      if (!$(f).value && matches2.length === 1) $(f).value = matches2[0].selector;
    }
    message(`Scanned ${candidates.length} inputs. Confirm suggested text mappings. Add consent mappings explicitly; no consent groups were selected automatically.`);
    const radioList = document.createElement("ul");
    for (const c of candidates.filter((c2) => c2.type === "radio")) {
      const li = document.createElement("li");
      li.textContent = `${c.label}: ${c.selector || "No unique stable selector; use advanced mapping."}`;
      radioList.append(li);
    }
    if (radioList.children.length) $("results").append(radioList);
  }
  for (const f of fields) {
    const label = document.createElement("label");
    label.textContent = captions[f] + " selector";
    const input = document.createElement("input");
    input.id = f;
    input.required = true;
    input.setAttribute("list", `list-${f}`);
    const list = document.createElement("datalist");
    list.id = `list-${f}`;
    label.append(input, list);
    $("mappings").append(label);
  }
  $("setup").onclick = () => edit();
  $("edit").onclick = () => edit(selected());
  $("workflow").onchange = workflowUI;
  $("patientDefaults").onchange = () => void run(async () => {
    if (active) {
      active.patientDefaults = $("patientDefaults").checked;
      await chrome.storage.local.set({ profiles });
    }
  });
  $("profiles").onchange = () => void run(select);
  $("ticket").onchange = () => {
    void ensureRecord().catch((e) => message(String(e)));
  };
  $("ticket").oninput = () => {
    if (record?.ticket !== $("ticket").value.trim()) $("preview").textContent = "Ticket changed. Leave this field or click Fill Order to generate its data.";
  };
  $("new").onclick = () => void run(() => ensureRecord(true));
  $("fill").onclick = () => void run(async () => {
    await ensureRecord();
    validate(active);
    message(active?.workflow === "sas" ? "Filling Patient, Test, and Provider tabs\u2026 Keep this popup open while the workflow runs." : "Filling mapped fields\u2026");
    const r = await invoke("fill", active);
    show(r.outcomes, r.elapsed);
  });
  $("scan").onclick = () => void run(async () => {
    const r = await invoke("scan", draft());
    if (r.candidates) suggestions(r.candidates);
    else show(r.outcomes, r.elapsed);
  });
  $("check").onclick = () => void run(async () => {
    const p = draft();
    validate(p);
    const r = await invoke("check", p);
    show(r.outcomes, r.elapsed);
  });
  $("addConsent").onclick = () => consentRow();
  $("profileForm").onsubmit = (e) => {
    e.preventDefault();
    void run(async () => {
      const p = draft();
      validate(p);
      const checked = await invoke("check", p);
      if (checked.outcomes.some((o) => o.status === "skipped" || o.status === "failed")) {
        show(checked.outcomes, checked.elapsed);
        return;
      }
      profiles = profiles.filter((other) => other.id !== p.id).concat(p);
      await chrome.storage.local.set({ profiles });
      await chrome.storage.session.remove(`record:${tabId}:${p.id}`);
      renderProfiles(p.id);
      await select();
      $("editor").open = false;
      message("Profile saved. Enter a ticket number to create your test record.");
    });
  };
  $("delete").onclick = () => void run(async () => {
    if (!editingId) return;
    profiles = profiles.filter((p) => p.id !== editingId);
    await chrome.storage.local.set({ profiles });
    await chrome.storage.session.remove(`record:${tabId}:${editingId}`);
    renderProfiles();
    await select();
    $("editor").open = false;
    message("Profile deleted.");
  });
  void run(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw Error("Open an HTTP or HTTPS test order page, then reopen this extension.");
    tabId = tab.id;
    pageUrl = tab.url;
    $("site").textContent = new URL(pageUrl).origin + new URL(pageUrl).pathname;
    const saved = await chrome.storage.local.get(["profiles", "selectedProfile"]);
    profiles = (Array.isArray(saved.profiles) ? saved.profiles : []).filter((p) => p.version === 1);
    const preset = sasProfile();
    if (matches(pageUrl, preset) && !profiles.some((p) => p.workflow === "sas" && matches(pageUrl, p))) {
      profiles.push(preset);
      await chrome.storage.local.set({ profiles });
    }
    const matching = profiles.find((p) => matches(pageUrl, p));
    const savedProfile = profiles.find((p) => p.id === saved.selectedProfile && matches(pageUrl, p));
    renderProfiles(savedProfile?.id || matching?.id);
    await select();
    if (!profiles.length) edit();
  });
})();
