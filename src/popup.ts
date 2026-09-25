import { fields, generate, validate, sasProfile, matches, type Field, type Profile, type RecordData } from './model';
import { pageAction, type Outcome, type Candidate } from './page';
import { sasAction } from './sas';
const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const captions: Record<Field,string> = { firstName: 'First name', lastName: 'Last name', accession: 'Accession number', mrn: 'MRN' };
let profiles: Profile[] = [], active: Profile | undefined, record: RecordData | undefined, tabId: number, pageUrl = '', editingId = '', busy = false;
const selected = () => profiles.find(p => p.id === $<HTMLSelectElement>('profiles').value);
const sessionKey = () => `record:${tabId}:${active?.id}`;
function message(text: string) { $('results').textContent = text; }
function show(outcomes: Outcome[], elapsed: number) {
  const counts = (s: string) => outcomes.filter(o => o.status === s).length;
  const heading = document.createElement('strong');
  heading.textContent = `${counts('failed') || counts('skipped') ? 'Needs review' : 'Complete'}: ${counts('filled')} filled · ${counts('unchanged')} unchanged · ${counts('skipped')} skipped · ${counts('failed')} failed (${elapsed} ms)`;
  const ul = document.createElement('ul'); for (const o of outcomes) { const li = document.createElement('li'); li.className = o.status; li.textContent = `${o.field}: ${o.status} — ${o.reason}`; ul.append(li); }
  $('results').replaceChildren(heading, ul);
}
function preview() {
  $('preview').replaceChildren();
  if (!record) { $('preview').textContent = 'Enter your ticket to preview test data.'; return; }
  for (const [label, value] of [['Ticket', record.ticket], ['First name', record.firstName], ['Last name', record.lastName], ['Accession', record.accession], ['MRN', record.mrn]]) { const line = document.createElement('div'); line.textContent = `${label}: ${value}`; $('preview').append(line); }
}
async function ensureRecord(fresh = false) {
  if (!active) throw Error('Save and select a form profile first.');
  const ticket = $('ticket').value.trim();
  if (fresh || !record || record.ticket !== ticket) { record = generate(ticket, active); await chrome.storage.session.set({ [sessionKey()]: record }); }
  preview();
}
async function select() {
  active = selected(); record = undefined;
  if (active) { const key = sessionKey(); record = (await chrome.storage.session.get(key))[key] as RecordData | undefined; $('overwrite').checked = active.overwrite; }
  $('ticket').value = record?.ticket || '';
  $('consentSummary').textContent = active?.workflow === 'sas' ? 'SAS: Blood · 1 tube · quantity 1 · today · test 1500 · Add sample · Self bill · testing Yes · data Opt In · one TCHE provider.' : `Configured consents will be set to Yes (${active?.consents.length || 0}). ${active?.consents.map(c => c.label).join(', ') || ''}`;
  $('patientDefaultsRow').hidden = active?.workflow !== 'sas';
  $('patientDefaults').checked = active?.patientDefaults ?? true;
  preview(); await chrome.storage.local.set({ selectedProfile: active?.id || '' });
}
function renderProfiles(id?: string) {
  const select = $<HTMLSelectElement>('profiles'); select.replaceChildren();
  if (!profiles.length) select.add(new Option('Set up a form to get started', ''));
  for (const p of profiles) select.add(new Option(p.name, p.id));
  if (id) select.value = id;
}
function consentRow(c = { label: '', group: '', yes: '' }) {
  const row = document.createElement('div'); row.className = 'consent';
  for (const key of ['label', 'group', 'yes'] as const) { const label = document.createElement('label'); label.textContent = {label:'Consent label',group:'Group CSS selector',yes:'Yes option CSS selector'}[key]; const input = document.createElement('input'); input.dataset.key = key; input.value = c[key]; input.required = true; label.append(input); row.append(label); }
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.onclick = () => row.remove(); row.append(remove); $('consents').append(row);
}
function edit(p?: Profile) {
  editingId = p?.id || '';
  const u = new URL(pageUrl);
  $('profileName').value = p?.name || ''; $('origin').value = p?.origin || u.origin; $('route').value = p?.route || u.pathname;
  $('descendants').checked = p?.descendants || false; $('scope').value = p?.scope || 'form';
  $('workflow').value = p?.workflow || 'mapped'; workflowUI();
  for (const field of fields) $(field).value = p?.mappings[field] || '';
  $('prefix').value = p?.prefix ?? 'Test'; $('maxLength').value = String(p?.maxLength || 30); $('defaultOverwrite').checked = p?.overwrite || false;
  $('consents').replaceChildren(); p?.consents.forEach(consentRow);
  $<HTMLDetailsElement>('editor').open = true; $('profileName').focus();
}
function workflowUI() {
  const sas = $('workflow').value === 'sas';
  for (const f of fields) $(f).required = !sas;
  $('mappedConsents').hidden = sas; $('scan').hidden = sas;
  $('mappingHint').textContent = sas ? 'Patient selectors are optional overrides. The SAS workflow finds controls by label in each tab.' : 'Suggestions use labels and field metadata. Confirm the intended patient section.';
}
function draft(): Profile {
  return { version: 1, id: editingId || crypto.randomUUID(), name: $('profileName').value.trim(), origin: $('origin').value.trim(), route: $('route').value.trim(), descendants: $('descendants').checked, scope: $('scope').value.trim(), mappings: Object.fromEntries(fields.map(f => [f, $(f).value.trim()])) as Record<Field,string>, consents: $('workflow').value === 'sas' ? [] : Array.from(document.querySelectorAll('.consent')).map(row => Object.fromEntries(Array.from(row.querySelectorAll('input')).map(i => [i.dataset.key, i.value.trim()])) as unknown as Profile['consents'][number]), prefix: $('prefix').value, maxLength: Number($('maxLength').value), overwrite: $('defaultOverwrite').checked, workflow: $('workflow').value === 'sas' ? 'sas' : undefined, patientDefaults: profiles.find(p => p.id === editingId)?.patientDefaults ?? true };
}
async function invoke(action: 'scan' | 'check' | 'fill', profile: Profile) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: profile.workflow === 'sas' ? sasAction : pageAction, args: [{ action, profile, record, overwrite: $('overwrite').checked }] });
  if (!result?.result) throw Error('The page did not return a result. Reopen the extension on the order page.');
  return result.result;
}
async function run(fn: () => Promise<void>) {
  if (busy) return; busy = true;
  const buttons = Array.from(document.querySelectorAll('button')); buttons.forEach(b => b.disabled = true);
  try { await fn(); } catch (e) { message(e instanceof Error ? e.message : String(e)); }
  finally { busy = false; buttons.forEach(b => b.disabled = false); }
}
function suggestions(candidates: Candidate[]) {
  for (const f of fields) {
    const list = $<HTMLDataListElement>(`list-${f}`); list.replaceChildren();
    for (const c of candidates.filter(c => ['text','search','tel'].includes(c.type) && c.selector)) list.append(new Option(c.label, c.selector));
    const pattern = {firstName:/first.?name|given-name/i,lastName:/last.?name|family-name|surname/i,accession:/accession/i,mrn:/\bmrn\b|medical.?record/i}[f];
    const matches = candidates.filter(c => c.type !== 'radio' && pattern.test(c.label));
    if (!$(f).value && matches.length === 1) $(f).value = matches[0].selector;
  }
  message(`Scanned ${candidates.length} inputs. Confirm suggested text mappings. Add consent mappings explicitly; no consent groups were selected automatically.`);
  const radioList = document.createElement('ul');
  for (const c of candidates.filter(c => c.type === 'radio')) { const li = document.createElement('li'); li.textContent = `${c.label}: ${c.selector || 'No unique stable selector; use advanced mapping.'}`; radioList.append(li); }
  if (radioList.children.length) $('results').append(radioList);
}
for (const f of fields) { const label = document.createElement('label'); label.textContent = captions[f] + ' selector'; const input = document.createElement('input'); input.id = f; input.required = true; input.setAttribute('list', `list-${f}`); const list = document.createElement('datalist'); list.id = `list-${f}`; label.append(input, list); $('mappings').append(label); }
$('setup').onclick = () => edit(); $('edit').onclick = () => edit(selected());
$('workflow').onchange = workflowUI;
$('patientDefaults').onchange = () => void run(async () => { if (active) { active.patientDefaults = $('patientDefaults').checked; await chrome.storage.local.set({ profiles }); } });
$('profiles').onchange = () => void run(select);
$('ticket').onchange = () => { void ensureRecord().catch(e => message(String(e))); };
$('ticket').oninput = () => { if (record?.ticket !== $('ticket').value.trim()) $('preview').textContent = 'Ticket changed. Leave this field or click Fill Order to generate its data.'; };
$('new').onclick = () => void run(() => ensureRecord(true));
$('fill').onclick = () => void run(async () => { await ensureRecord(); validate(active!); message(active?.workflow === 'sas' ? 'Filling Patient, Test, and Provider tabs… Keep this popup open while the workflow runs.' : 'Filling mapped fields…'); const r = await invoke('fill', active!); show(r.outcomes, r.elapsed); });
$('scan').onclick = () => void run(async () => { const r = await invoke('scan', draft()); if (r.candidates) suggestions(r.candidates); else show(r.outcomes, r.elapsed); });
$('check').onclick = () => void run(async () => { const p = draft(); validate(p); const r = await invoke('check', p); show(r.outcomes, r.elapsed); });
$('addConsent').onclick = () => consentRow();
$('profileForm').onsubmit = e => { e.preventDefault(); void run(async () => { const p = draft(); validate(p); const checked = await invoke('check', p); if (checked.outcomes.some(o => o.status === 'skipped' || o.status === 'failed')) { show(checked.outcomes, checked.elapsed); return; } profiles = profiles.filter(other => other.id !== p.id).concat(p); await chrome.storage.local.set({ profiles }); await chrome.storage.session.remove(`record:${tabId}:${p.id}`); renderProfiles(p.id); await select(); $<HTMLDetailsElement>('editor').open = false; message('Profile saved. Enter a ticket number to create your test record.'); }); };
$('delete').onclick = () => void run(async () => { if (!editingId) return; profiles = profiles.filter(p => p.id !== editingId); await chrome.storage.local.set({ profiles }); await chrome.storage.session.remove(`record:${tabId}:${editingId}`); renderProfiles(); await select(); $<HTMLDetailsElement>('editor').open = false; message('Profile deleted.'); });
void run(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw Error('Open an HTTP or HTTPS test order page, then reopen this extension.');
  tabId = tab.id; pageUrl = tab.url; $('site').textContent = new URL(pageUrl).origin + new URL(pageUrl).pathname;
  const saved = await chrome.storage.local.get(['profiles', 'selectedProfile']); profiles = (Array.isArray(saved.profiles) ? saved.profiles : []).filter((p: Profile) => p.version === 1);
  const preset = sasProfile();
  if (matches(pageUrl, preset) && !profiles.some(p => p.workflow === 'sas' && matches(pageUrl, p))) { profiles.push(preset); await chrome.storage.local.set({ profiles }); }
  const matching = profiles.find(p => matches(pageUrl, p));
  const savedProfile = profiles.find(p => p.id === saved.selectedProfile && matches(pageUrl, p));
  renderProfiles(savedProfile?.id || matching?.id); await select(); if (!profiles.length) edit();
});
