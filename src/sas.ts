import type { PageRequest, Outcome, Candidate } from './page';

// Chrome serializes this function: keep all runtime helpers inside it.
export async function sasAction(req: PageRequest): Promise<{ outcomes: Outcome[]; elapsed: number; candidates?: Candidate[] }> {
  const start = Date.now(), deadline = start + 90000, p = req.profile;
  const outcomes: Outcome[] = [];
  const state = globalThis as typeof globalThis & { __ticketFillRunning?: boolean; __sasAdds?: { root: Element; sample?: boolean; provider?: boolean } };
  const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pause = (ms = 100) => new Promise<void>(r => setTimeout(r, ms));
  const guard = () => {
    if (location.origin !== p.origin || !(location.pathname === p.route || (p.descendants && location.pathname.startsWith(p.route === '/' ? '/' : p.route + '/')))) throw Error('Page is outside the configured origin/route.');
    if (Date.now() > deadline) throw Error('SAS workflow reached its 90-second limit.');
  };
  const visible = (el: Element): boolean => {
    const css = getComputedStyle(el);
    return !!el.getClientRects().length && css.display !== 'none' && !['hidden', 'collapse'].includes(css.visibility) && !el.closest('[hidden],[inert],[aria-hidden="true"]');
  };
  const enabled = (el: Element) => !el.matches(':disabled,[aria-disabled="true"],.ng-select-disabled,.ng-option-disabled,.mat-option-disabled,.mat-mdc-option-disabled') && !el.closest('[inert]');
  const root = () => {
    guard(); const found = document.querySelectorAll(p.scope);
    if (found.length !== 1) throw Error('Form scope must match exactly one element.');
    return found[0];
  };
  const all = (selector: string, scope: ParentNode = root()) => Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(visible);
  const unique = (items: HTMLElement[], label: string) => {
    const deduped = Array.from(new Set(items));
    if (deduped.length !== 1) throw Error(`${label}: found ${deduped.length} controls; expected one. Check the page labels or profile mappings.`);
    return deduped[0];
  };
  const wait = async <T>(read: () => T | undefined | false, description: string, ms = 6000): Promise<T> => {
    const until = Math.min(deadline, Date.now() + ms);
    do { guard(); const value = read(); if (value) return value; await pause(); } while (Date.now() < until);
    throw Error(`Timed out waiting for ${description}.`);
  };
  const text = (el: Element) => {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll('mat-icon,.material-icons,svg').forEach(n => n.remove());
    clone.querySelectorAll('td,th,[role="cell"]').forEach(n => n.append(' '));
    return clone.textContent?.trim() || '';
  };
  const click = (el: HTMLElement) => { guard(); if (!visible(el) || !enabled(el)) throw Error('Control is hidden or disabled.'); el.click(); };
  const named = (selector: string, names: string[], scope: ParentNode = root()) => all(selector, scope).filter(el => names.some(n => norm(text(el)) === norm(n) || norm(el.getAttribute('aria-label')) === norm(n)));
  const button = (names: string[], scope: ParentNode = root()) => unique(named('button,[role="button"],input[type="button"]', names, scope), names[0]);
  const labelTexts = (el: HTMLElement): string[] => {
    const native = el as HTMLInputElement;
    const labels = Array.from(native.labels || []).map(l => text(l));
    labels.push(...['aria-label', 'placeholder', 'name', 'id', 'formcontrolname'].map(a => el.getAttribute(a) || ''));
    labels.push(...(el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || ''));
    // Angular/ng-select forms often use a label without a for attribute.
    let container = el.parentElement;
    for (let level = 0; container && level < 3; level++, container = container.parentElement) {
      const controls = Array.from(container.querySelectorAll('input:not([type="hidden"]),select,ng-select,mat-select,[role="combobox"]'));
      const unrelated = controls.some(other => other !== el && !other.contains(el) && !el.contains(other));
      if (unrelated) break;
      labels.push(...Array.from(container.querySelectorAll('label,mat-label,.ng-placeholder')).map(l => text(l)));
    }
    return labels;
  };
  const control = (names: string[], dropdown = false, mapping?: string): HTMLElement => {
    if (mapping) return unique(all(mapping), names[0]);
    const selector = dropdown ? 'select,ng-select,mat-select,[role="combobox"]' : 'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="password"]):not([type="file"]),textarea';
    let candidates = all(selector).filter(el => labelTexts(el).some(l => names.some(n => norm(l) === norm(n))));
    if (dropdown) candidates = candidates.filter(el => !candidates.some(other => other !== el && other.contains(el)));
    return unique(candidates, names[0]);
  };
  const hasControl = (names: string[], dropdown = false) => { try { return control(names, dropdown); } catch { return undefined; } };
  const write = (el: HTMLElement, value: string) => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || (el instanceof HTMLInputElement && !['text', 'search', 'tel', 'number', 'date'].includes(el.type)) || el.readOnly || !enabled(el)) throw Error('Expected an editable text, number, or date input.');
    const probe = el.cloneNode() as HTMLInputElement; probe.value = value;
    if ((el.maxLength >= 0 && value.length > el.maxLength) || !probe.checkValidity()) throw Error('Value does not satisfy this field’s constraints.');
    const prototype = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // Input handlers may replace the element; callers verify the fresh control.
    if (el.isConnected) { el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); }
  };
  const field = async (caption: string, names: string[], value: string, mapping?: string) => {
    const read = () => control(names, false, mapping) as HTMLInputElement;
    const el = read();
    if (el.value === value || (el.value && !req.overwrite)) {
      outcomes.push({ field: caption, status: 'unchanged', reason: el.value === value ? 'Already set.' : 'Existing value preserved.' }); return;
    }
    write(el, value); await pause(300);
    if (read().value !== value) throw Error(`${caption}: application rejected or reverted the value.`);
    outcomes.push({ field: caption, status: 'filled', reason: 'Value verified.' });
  };
  const tab = async (name: string, ready: () => unknown) => {
    const el = unique(named('[role="tab"],.mat-tab-label,.mat-mdc-tab,button,a', [name]), name);
    click(el); await wait(() => ready() ? true : undefined, `${name} fields`); await pause(200);
  };
  const optionMatches = (value: string, desired: string) => norm(value) === norm(desired);
  const dropdownValue = (el: HTMLElement, desired: string) => {
    if (el instanceof HTMLSelectElement) return Array.from(el.selectedOptions).some(o => optionMatches(o.textContent || '', desired));
    return Array.from(el.querySelectorAll('.ng-value-label,.mat-select-value-text,.mat-mdc-select-value-text,[data-selected-value]')).some(n => optionMatches(text(n), desired)) || (el.getAttribute('aria-expanded') !== 'true' && optionMatches(text(el), desired));
  };
  const dropdown = async (caption: string, names: string[], desired: string) => {
    let el = control(names, true);
    if (dropdownValue(el, desired)) { outcomes.push({ field: caption, status: 'unchanged', reason: `Already ${desired}.` }); return; }
    if (!enabled(el)) throw Error(`${caption} is disabled.`);
    if (el instanceof HTMLSelectElement) {
      const options = Array.from(el.options).filter(o => !o.disabled && optionMatches(o.textContent || '', desired));
      if (options.length !== 1) throw Error(`${caption}: expected one exact ${desired} option.`);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, options[0].value);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Only options in a newly opened or explicitly associated popup are eligible.
      const before = new Set(all('[role="option"],.ng-option,mat-option', document));
      click(el.querySelector<HTMLElement>('.ng-select-container') || el);
      const input = el instanceof HTMLInputElement ? el : el.querySelector<HTMLInputElement>('input:not([type="hidden"])');
      if (input && !input.readOnly) write(input, desired);
      const options = () => {
        el = control(names, true);
        const ids = [el, ...Array.from(el.querySelectorAll('[aria-controls],[aria-owns]'))].flatMap(n => `${n.getAttribute('aria-controls') || ''} ${n.getAttribute('aria-owns') || ''}`.trim().split(/\s+/)).filter(Boolean);
        const panels = ids.map(id => document.getElementById(id)).filter((n): n is HTMLElement => !!n);
        return all('[role="option"],.ng-option,mat-option', document).filter(o => enabled(o) && (panels.length ? panels.some(panel => panel.contains(o)) : !before.has(o)) && optionMatches(text(o), desired));
      };
      const found = await wait(() => { const items = options(); if (items.length > 1) throw Error(`${caption}: ambiguous ${desired} options.`); return items[0]; }, `${caption} option ${desired}`);
      click(found);
    }
    await wait(() => dropdownValue(control(names, true), desired), `${caption} selection`);
    outcomes.push({ field: caption, status: 'filled', reason: `${desired} selected.` });
  };
  const radio = async (caption: string, groupNames: string[], option: string, preserve = false) => {
    const labels = all('label,legend,mat-label,p,span,div').filter(el => groupNames.some(n => norm(text(el)) === norm(n)));
    const groups: HTMLElement[] = [];
    for (const label of labels) {
      let node: HTMLElement | null = label;
      for (let i = 0; node && i < 5; i++, node = node.parentElement) {
        if (node.querySelector('input[type="radio"],[role="radio"]')) { groups.push(node); break; }
      }
    }
    let group = unique(Array.from(new Set(groups)).filter(g => !groups.some(other => other !== g && g.contains(other))), caption);
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const targets = radios.filter(r => labelTexts(r).some(l => norm(l) === norm(option)) || norm(r.value) === norm(option));
    const target = unique(targets, `${caption}: ${option}`) as HTMLInputElement;
    if (!target.name || Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).some(r => r.name === target.name && r.form === target.form && !group.contains(r))) throw Error(`${caption}: radio group is not isolated.`);
    if (target.checked || (preserve && radios.some(r => r.checked) && !req.overwrite)) { outcomes.push({ field: caption, status: 'unchanged', reason: 'Existing selection preserved.' }); return; }
    if (!enabled(target)) throw Error(`${caption} is disabled.`);
    const interactive = visible(target) ? target : Array.from(target.labels || []).find(visible);
    if (!interactive) throw Error(`${caption}: no interactive radio label.`);
    click(interactive); await pause(250);
    // Re-resolve the group after framework updates.
    group = root() as HTMLElement;
    const current = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find(r => r.name === target.name && r.value === target.value);
    if (!current?.checked) throw Error(`${caption}: selection was not accepted.`);
    outcomes.push({ field: caption, status: 'filled', reason: `${option} selected.` });
  };
  const attempt = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); return true; } catch (e) { outcomes.push({ field: name, status: 'failed', reason: e instanceof Error ? e.message : String(e) }); return false; }
  };
  const sampleRows = () => all('tr,[role="row"],.card,mat-card,.sample-card,.sample-item').filter(el => /\bblood\b/i.test(text(el)) && /\b1500\b/.test(text(el)) && !el.querySelector('input,ng-select,select,[role="combobox"]'));
  const selectedProviders = () => {
    const headings = all('h1,h2,h3,h4,legend,div,span').filter(el => ['selectedproviders', 'selectedprovider'].includes(norm(text(el))));
    for (const heading of headings) {
      let parent = heading.parentElement;
      for (let i = 0; parent && i < 3; i++, parent = parent.parentElement) {
        const rows = all('tr,[role="row"],.provider-card,.provider-item', parent).filter(row => (row.querySelector('td,[role="cell"]') || named('button,[role="button"]', ['Remove', 'Deselect'], row).length) && !named('button,[role="button"]', ['Select'], row).length);
        if (rows.length) return rows;
      }
    }
    return [];
  };
  let locked = false;
  try {
    const scope = root();
    if (req.action !== 'fill') {
      for (const name of ['Patient Information', 'Test Information', 'Provider Information']) unique(named('[role="tab"],.mat-tab-label,.mat-mdc-tab,button,a', [name]), name);
      outcomes.push({ field: 'SAS workflow', status: 'unchanged', reason: 'Three form tabs found. Controls are resolved by label when each tab opens; check does not navigate or change values.' });
      return { outcomes, elapsed: Date.now() - start };
    }
    if (state.__ticketFillRunning) throw Error('A fill is already running in this page.');
    if (!req.record?.ticket) throw Error('Ticket-linked test data is required.');
    state.__ticketFillRunning = true; locked = true;
    if (!state.__sasAdds || state.__sasAdds.root !== scope) state.__sasAdds = { root: scope };
    const ledger = state.__sasAdds;
    await attempt('Patient Information', async () => {
      await tab('Patient Information', () => hasControl(['First Name'], false));
      const entries = [
        ['firstName', ['First Name']], ['lastName', ['Last Name']],
        ['accession', ['AccessionNumber', 'Accession Number']], ['mrn', ['Medical Reference Number', 'Medical Record Number', 'MRN']]
      ] as const;
      for (const [key, names] of entries) await attempt(names[0], () => field(names[0], [...names], req.record![key], p.mappings[key]));
      if (p.patientDefaults) {
        await attempt('Date of Birth', async () => {
          const input = control(['Date of Birth', 'DOB']) as HTMLInputElement;
          await field('Date of Birth', ['Date of Birth', 'DOB'], input.type === 'date' ? '1990-01-01' : '01/01/1990');
        });
        await attempt('Patient Gender', () => radio('Patient Gender', ['Patient Gender', 'Gender'], 'Unknown', true));
      } else outcomes.push({ field: 'DOB / gender', status: 'skipped', reason: 'Patient defaults disabled; complete required fields manually.' });
    });
    await attempt('Test Information', async () => {
      await tab('Test Information', () => hasControl(['Sample Type', 'Select Sample Type'], true));
      if (sampleRows().length) outcomes.push({ field: 'Add sample', status: 'unchanged', reason: 'A Blood / 1500 sample already exists; no duplicate added. Review its quantity and date.' });
      else if (ledger.sample) outcomes.push({ field: 'Add sample', status: 'skipped', reason: 'Add was already clicked on this page. Review the sample list before retrying; reload the page for a new order.' });
      else await attempt('Add sample', async () => {
        await dropdown('Sample Type', ['Sample Type', 'Select Sample Type'], 'Blood');
        // Sample fields must contain these values before adding, even if prefilled differently.
        const ensureSampleField = async (caption: string, names: string[], value: string) => {
          await field(caption, names, value);
          if ((control(names) as HTMLInputElement).value !== value) throw Error(`${caption}: existing value differs from the sample default. Enable overwrite to add the requested sample.`);
        };
        await ensureSampleField('Number of Tubes', ['Number of Tubes', 'Enter no of tubes'], '1');
        await ensureSampleField('Sample Quantity', ['Sample Quantity', 'Enter sample quantity'], '1');
        const today = new Date(), date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const dateInput = control(['Sample Date']) as HTMLInputElement;
        await ensureSampleField('Sample Date', ['Sample Date'], dateInput.type === 'date' ? date : `${date.slice(5, 7)}/${date.slice(8)}/${date.slice(0, 4)}`);
        const testNames = ['Client Test Code/Test Code/Test Name/Hospital Code', 'Test Code'];
        const testInput = control(testNames) as HTMLInputElement;
        if (testInput.value && testInput.value !== '1500' && !req.overwrite) throw Error('Existing test code preserved. Enable overwrite to use 1500.');
        const before = new Set(all('[role="option"],.ng-option,mat-option', document));
        write(testInput, '1500');
        const autocomplete = testInput.getAttribute('role') === 'combobox' || testInput.hasAttribute('aria-autocomplete') || !!testInput.closest('ng-select') || testInput.hasAttribute('matAutocomplete');
        if (autocomplete) {
          const option = await wait(() => {
            const ids = `${testInput.getAttribute('aria-controls') || ''} ${testInput.getAttribute('aria-owns') || ''}`.trim().split(/\s+/).filter(Boolean);
            const options = all('[role="option"],.ng-option,mat-option', document).filter(el => enabled(el) && (ids.length ? ids.some(id => document.getElementById(id)?.contains(el)) : !before.has(el)) && /^1500(?:\b|\s*[-:])/i.test(text(el).trim()));
            if (options.length > 1) throw Error('Multiple tests match code 1500; select the intended test manually.');
            return options[0];
          }, 'test code 1500 result');
          click(option);
        } else { await pause(300); if ((control(testNames) as HTMLInputElement).value !== '1500') throw Error('Test code was rejected.'); }
        outcomes.push({ field: 'Test Code', status: 'filled', reason: '1500 entered / selected.' });
        const add = await wait(() => { const b = button(['Add Sampletype', 'Add Sample Type', 'Add Samples', 'Add Sample']); return enabled(b) ? b : undefined; }, 'enabled Add Sample button');
        ledger.sample = true; click(add);
        await wait(() => sampleRows().length > 0, 'added Blood / 1500 sample row');
        outcomes.push({ field: 'Add sample', status: 'filled', reason: 'Blood / 1500 sample appears in the sample list.' });
      });
      await attempt('Bill Type', () => dropdown('Bill Type', ['Bill Type', 'Select Bill Type'], 'Self'));
      await attempt('Consent for Testing', () => radio('Consent for Testing', ['Consent for Testing'], 'Yes'));
      await attempt('Use of Data', () => radio('Use of Data', ['Use of Data'], 'Opt In'));
    });
    await attempt('Provider Information', async () => {
      await tab('Provider Information', () => hasControl(['Institution Code'], true));
      const existing = selectedProviders();
      if (existing.some(row => /\bTCHE\b/i.test(text(row)))) { outcomes.push({ field: 'Provider', status: 'unchanged', reason: 'A TCHE provider is already selected; no additional provider added.' }); return; }
      if (existing.length >= 3) { outcomes.push({ field: 'Provider', status: 'skipped', reason: 'Three providers are already selected. No provider added.' }); return; }
      if (ledger.provider) { outcomes.push({ field: 'Provider', status: 'skipped', reason: 'Select was already clicked on this page. Review the selected providers; no duplicate selection attempted.' }); return; }
      await dropdown('Institution Code', ['Institution Code'], 'TCHE');
      // Search only the institution; preserve other filters but require the user to clear them.
      for (const names of [['First Name'], ['Last Name'], ['NPI'], ['Phone #'], ['Fax #'], ['Email']]) {
        const input = hasControl(names) as HTMLInputElement | undefined;
        if (input?.value) throw Error('Clear existing provider search filters to search only TCHE.');
      }
      const eligible = () => all('tr,[role="row"]').filter(row => Array.from(row.querySelectorAll('td,[role="cell"]')).some(cell => norm(text(cell)) === 'tche') && named('button,[role="button"]', ['Select'], row).some(enabled));
      const previousRows = new Map(eligible().map(row => [row, text(row)]));
      let changed = previousRows.size === 0;
      const observer = new MutationObserver(() => {
        if (Array.from(previousRows).some(([row, value]) => !row.isConnected || !visible(row) || text(row) !== value)) changed = true;
      });
      observer.observe(root(), { subtree: true, childList: true, characterData: true, attributes: true });
      try {
        click(button(['Search']));
        const row = await wait(() => {
          const rows = eligible();
          return (changed || rows.some(r => !previousRows.has(r))) ? rows[0] : undefined;
        }, 'fresh TCHE provider search results', 12000);
        ledger.provider = true;
        click(button(['Select'], row));
        await wait(() => selectedProviders().some(selected => /\bTCHE\b/i.test(text(selected))) || (row.isConnected && named('button,[role="button"]', ['Selected', 'Remove', 'Deselect'], row).length > 0), 'selected TCHE provider');
        outcomes.push({ field: 'Provider', status: 'filled', reason: 'One TCHE provider selected (below the maximum of three).' });
      } finally { observer.disconnect(); }
    });
  } catch (e) { outcomes.push({ field: 'SAS workflow', status: 'failed', reason: e instanceof Error ? e.message : String(e) }); }
  finally { if (locked) state.__ticketFillRunning = false; }
  return { outcomes, elapsed: Date.now() - start };
}
