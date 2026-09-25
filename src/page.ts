import type { Profile, RecordData } from './model';
export interface Outcome { field: string; status: 'filled' | 'unchanged' | 'skipped' | 'failed'; reason: string }
export interface Candidate { label: string; selector: string; type: string }
export interface PageRequest { action: 'scan' | 'check' | 'fill'; profile: Profile; record?: RecordData; overwrite?: boolean }
// Self-contained because Chrome serializes this function into the isolated world.
export async function pageAction(req: PageRequest): Promise<{ candidates?: Candidate[]; outcomes: Outcome[]; elapsed: number }> {
  const start = Date.now(), deadline = start + 5000, p = req.profile;
  const outcomes: Outcome[] = [];
  const result = () => ({ outcomes, elapsed: Date.now() - start });
  const allowed = () => location.origin === p.origin && (location.pathname === p.route || (p.descendants && location.pathname.startsWith(p.route === '/' ? '/' : p.route + '/')));
  const one = (root: ParentNode, selector: string): Element => { const found = root.querySelectorAll(selector); if (found.length !== 1) throw Error(`Selector matched ${found.length} controls; expected exactly 1: ${selector}`); return found[0]; };
  const scope = () => { if (!allowed()) throw Error('Page is outside the configured origin/route.'); if (Date.now() >= deadline) throw Error('Five-second run limit reached.'); return one(document, p.scope); };
  const visible = (el: Element) => { const css = getComputedStyle(el); return !!el.getClientRects().length && css.visibility !== 'hidden' && css.visibility !== 'collapse' && css.display !== 'none' && !el.closest('[inert]'); };
  const textControl = (el: Element): HTMLInputElement => {
    if (!(el instanceof HTMLInputElement) || !['text', 'search', 'tel'].includes(el.type)) throw Error('Target must be a supported text input.');
    if (el.matches(':disabled') || el.readOnly || !visible(el)) throw Error('Input is disabled, read-only, or hidden.');
    return el;
  };
  const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  const label = (el: HTMLInputElement) => Array.from(el.labels || []).map(l => l.textContent?.trim()).join(' ') || el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim() || el.placeholder || el.name || el.id;
  try {
    const root = scope();
    if (req.action === 'scan') {
      const candidates = Array.from(root.querySelectorAll('input')).filter(el => !['password', 'file', 'hidden'].includes(el.type)).map(el => {
        let selector = el.id ? '#' + CSS.escape(el.id) : el.name ? `input[name=${JSON.stringify(el.name)}]` + (el.type === 'radio' ? `[value=${JSON.stringify(el.value)}]` : '') : '';
        if (!selector || root.querySelectorAll(selector).length !== 1) selector = '';
        return { label: [label(el), el.autocomplete, el.name].filter(Boolean).join(' · '), selector, type: el.type };
      });
      return { ...result(), candidates };
    }
    const entries = Object.entries(p.mappings);
    const resolveText = (sel: string) => textControl(one(scope(), sel));
    const resolveRadio = (c: Profile['consents'][number]) => {
      const group = one(scope(), c.group), el = one(group, c.yes);
      if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || el.matches(':disabled')) throw Error('Yes target must be an enabled native radio.');
      // A native radio name can span containers: reject groups that could affect outside controls.
      if (!el.name) throw Error('Radio must have a name for native group exclusivity.');
      const siblings = Array.from(document.querySelectorAll('input[type=radio]')).filter(r => (r as HTMLInputElement).name === el.name && (r as HTMLInputElement).form === el.form);
      if (siblings.some(r => !group.contains(r))) throw Error('Radio group extends outside the mapped group.');
      const interactive = visible(el) ? el : Array.from(el.labels || []).find(visible);
      if (!interactive || el.closest('[inert]')) throw Error('No visible interactive radio or label.');
      return { el, interactive };
    };
    if (req.action === 'check') {
      for (const [field, sel] of entries) { try { resolveText(sel); outcomes.push({ field, status: 'unchanged', reason: 'Exactly one editable text input matched.' }); } catch (e) { outcomes.push({ field, status: 'skipped', reason: String(e) }); } }
      for (const c of p.consents) { try { resolveRadio(c); outcomes.push({ field: c.label, status: 'unchanged', reason: 'Exactly one group and explicit Yes target matched.' }); } catch (e) { outcomes.push({ field: c.label, status: 'skipped', reason: String(e) }); } }
      return result();
    }
    const state = globalThis as typeof globalThis & { __ticketFillRunning?: boolean };
    if (state.__ticketFillRunning) throw Error('A fill is already running in this page.');
    if (!req.record?.ticket) throw Error('Ticket-linked test data is required.');
    state.__ticketFillRunning = true;
    const verify: { outcome: Outcome; read: () => boolean }[] = [];
    try {
      // Detect aliases before any write; two logical fields must never share a target.
      const targets = entries.map(([field, sel]) => { try { return { field, el: one(scope(), sel) }; } catch { return { field, el: null }; } });
      for (const [field, sel] of entries) {
        let wrote = false;
        try {
          scope();
          if (targets.some(t => t.field === field && t.el && targets.some(other => other.field !== field && other.el === t.el))) throw Error('Multiple text mappings point to the same input.');
          const el = resolveText(sel), value = req.record[field as keyof RecordData];
          if (typeof value !== 'string') throw Error('Missing generated value.');
          if (el.value === value || (el.value !== '' && !req.overwrite)) { outcomes.push({ field, status: 'unchanged', reason: el.value === value ? 'Already contains this record.' : 'Existing text preserved; enable overwrite to replace it.' }); continue; }
          if ((el.maxLength >= 0 && value.length > el.maxLength) || (el.minLength > 0 && value.length < el.minLength)) throw Error('Generated value does not satisfy input length constraints.');
          const probe = el.cloneNode() as HTMLInputElement; probe.value = value;
          if (!probe.checkValidity()) throw Error('Generated value does not satisfy the input pattern or constraints.');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
          wrote = true;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          // Resolve again after a synchronous rerender before dispatching change.
          resolveText(sel).dispatchEvent(new Event('change', { bubbles: true }));
          const outcome: Outcome = { field, status: 'filled', reason: 'Value accepted after verification.' };
          outcomes.push(outcome); verify.push({ outcome, read: () => resolveText(sel).value === value });
        } catch (e) { outcomes.push({ field, status: wrote ? 'failed' : 'skipped', reason: String(e) }); }
      }
      for (const c of p.consents) {
        let wrote = false;
        try {
          const { el, interactive } = resolveRadio(c);
          const outcome: Outcome = { field: c.label, status: el.checked ? 'unchanged' : 'filled', reason: el.checked ? 'Already set to Yes.' : 'Yes selection verified.' };
          if (!el.checked) { wrote = true; (interactive as HTMLElement).click(); }
          outcomes.push(outcome); verify.push({ outcome, read: () => resolveRadio(c).el.checked });
        } catch (e) { outcomes.push({ field: c.label, status: wrote ? 'failed' : 'skipped', reason: String(e) }); }
      }
      // Two bounded checks catch deferred model updates and replacement nodes.
      for (const delay of [120, 280]) {
        await pause(Math.max(0, Math.min(delay, deadline - Date.now())));
        for (const item of verify) {
          try { if (!item.read()) throw Error('Application rejected or reverted the value.'); }
          catch (e) { item.outcome.status = 'failed'; item.outcome.reason = String(e); }
        }
      }
    } finally { state.__ticketFillRunning = false; }
  } catch (e) { outcomes.push({ field: 'Form', status: 'failed', reason: String(e) }); }
  return result();
}
