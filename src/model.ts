export const fields = ['firstName', 'lastName', 'accession', 'mrn'] as const;
export type Field = typeof fields[number];
export interface Consent { label: string; group: string; yes: string }
export interface Profile {
  version: 1; id: string; name: string; origin: string; route: string;
  descendants: boolean; scope: string; mappings: Record<Field, string>;
  consents: Consent[]; prefix: string; maxLength: number; overwrite: boolean;
  workflow?: 'sas'; patientDefaults?: boolean;
}
export interface RecordData { ticket: string; firstName: string; lastName: string; accession: string; mrn: string }
export function matches(url: string, p: Profile): boolean {
  const u = new URL(url);
  return u.origin === p.origin && (u.pathname === p.route || (p.descendants && u.pathname.startsWith(p.route === '/' ? '/' : p.route + '/')));
}
export function validate(p: Profile): void {
  const u = new URL(p.origin);
  if (!['http:', 'https:'].includes(u.protocol) || u.origin !== p.origin) throw Error('Use an exact HTTP or HTTPS origin without a trailing slash.');
  if (!p.name.trim() || !p.scope.trim() || !p.route.startsWith('/') || /[?#]/.test(p.route) || (p.route !== '/' && p.route.endsWith('/'))) throw Error('Enter a name, scope, and pathname (no query, fragment, or trailing slash).');
  if (p.workflow && p.workflow !== 'sas') throw Error('Unknown form workflow.');
  if (!p.workflow && !fields.every(f => p.mappings[f].trim())) throw Error('Map all four text fields.');
  if (!/^[A-Za-z]*$/.test(p.prefix) || !Number.isInteger(p.maxLength) || p.maxLength < p.prefix.length + 8 || p.maxLength > 100) throw Error('Use an alphabetic prefix and a name limit between prefix length + 8 and 100.');
  if (p.consents.length > 16 || p.consents.some(c => !c.label.trim() || !c.group.trim() || !c.yes.trim())) throw Error('Each consent needs a label, group selector, and explicit Yes selector; maximum 16.');
}
export function sasProfile(origin = 'https://rare-accessioning-qa.baylorgenetics.com'): Profile {
  return { version: 1, id: 'sas-qa', name: 'SAS — Create new order', origin, route: '/orders/sample/create-order', descendants: false, scope: 'body',
    mappings: { firstName: '', lastName: '', accession: '', mrn: '' }, consents: [], prefix: 'Test', maxLength: 30, overwrite: false, workflow: 'sas', patientDefaults: true };
}
// Deterministic alphabetic ticket encoding: names are stable even after Chrome restarts.
export function generate(ticket: string, p: Profile): RecordData {
  ticket = ticket.trim();
  if (!ticket || ticket.length > 120) throw Error('Enter a ticket reference (1–120 characters).');
  let hash = 2166136261;
  for (const c of ticket) hash = Math.imul(hash ^ c.codePointAt(0)!, 16777619) >>> 0;
  const letters = (n: number) => { let s = ''; for (let i = 0; i < 7; i++) { s += String.fromCharCode(97 + n % 26); n = Math.floor(n / 26); } return s; };
  const suffix = (ticket.replace(/\D/g, '').slice(0, 12) || String(hash)) + Date.now() + String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(10, '0');
  return { ticket, firstName: (p.prefix + 'A' + letters(hash)).slice(0, p.maxLength), lastName: (p.prefix + 'Z' + letters((hash ^ 0x9e3779b9) >>> 0)).slice(0, p.maxLength), accession: 'ACC-' + suffix, mrn: 'MRN-' + suffix };
}
