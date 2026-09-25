import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { generate, sasProfile, validate } from '../src/model';
import { sasAction } from '../src/sas';

const profile = sasProfile('https://uat.example.test');
function fixture() {
  const dom = new JSDOM(readFileSync('demo/sas.html', 'utf8'), { url: profile.origin + profile.route, runScripts: 'dangerously' });
  const w = dom.window;
  for (const key of ['document','location','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLElement','Event','MutationObserver','getComputedStyle'] as const)
    Object.defineProperty(globalThis, key, {value:key === 'getComputedStyle' ? w.getComputedStyle.bind(w) : w[key],configurable:true});
  w.Element.prototype.getClientRects = function() { return this.closest('[hidden]') ? [] as unknown as DOMRectList : [{width:10,height:10}] as unknown as DOMRectList; };
  const state = globalThis as typeof globalThis & { __sasAdds?: unknown; __ticketFillRunning?: boolean }; delete state.__sasAdds; delete state.__ticketFillRunning;
  return { dom, d: w.document, calls: (w as unknown as {fixture:{adds:number;searches:number;selections:number;tabVisits:string[]}}).fixture };
}
test('SAS preset validates without selectors and check is read-only', async () => {
  const {dom,d,calls}=fixture(); try {
    validate(profile); const result=await sasAction({action:'check',profile});
    assert.equal(result.outcomes[0].status,'unchanged'); assert.equal(calls.tabVisits.length,0); assert.equal((d.querySelector('#first') as HTMLInputElement).value,'');
  } finally {dom.window.close();}
});
test('SAS fills all tabs, delayed dropdowns and test autocomplete; adds one sample and provider, repeats safely', async () => {
  const {dom,d,calls}=fixture(); try {
    const record=generate('QA-00150',profile);
    const result=await sasAction({action:'fill',profile,record});
    assert(result.outcomes.every(o=>!['failed','skipped'].includes(o.status)),JSON.stringify(result.outcomes));
    assert.equal((d.querySelector('#first') as HTMLInputElement).value,record.firstName);
    assert.equal((d.querySelector('#mrn') as HTMLInputElement).value,record.mrn);
    assert.equal((d.querySelector('#dob') as HTMLInputElement).value,'1990-01-01');
    for(const selector of ['[name=gender][value=Unknown]','[name=consent][value=yes]','[name=data][value=in]']) assert((d.querySelector(selector) as HTMLInputElement).checked);
    assert.equal(d.querySelector('[data-label="Bill Type"]')?.getAttribute('data-value'),'Self');
    assert.equal(calls.adds,1);assert.equal(calls.selections,1);assert.equal(calls.searches,1);
    assert.equal(d.querySelector('#selected tbody tr td:nth-child(2)')?.textContent,'TCHE');
    assert.equal(d.querySelector('#samples tbody tr td:nth-child(3)')?.textContent,'1');
    const date=new Date();assert.equal(d.querySelector('#samples tbody tr td:nth-child(5)')?.textContent,`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`);
    assert(!(d.querySelector('#retention') as HTMLInputElement).checked);assert(!(d.querySelector('#sequential') as HTMLInputElement).checked);assert.equal(d.querySelector('#submission')?.textContent,'No submission');
    const again=await sasAction({action:'fill',profile,record});
    assert(again.outcomes.every(o=>o.status==='unchanged'),JSON.stringify(again.outcomes));assert.equal(calls.adds,1);assert.equal(calls.selections,1);
  } finally {dom.window.close();}
});
test('SAS refuses another route before navigating or writing', async () => {
  const {dom,d,calls}=fixture();try {
    const result=await sasAction({action:'fill',profile:{...profile,route:'/wrong'},record:generate('A',profile)});
    assert.equal(result.outcomes[0].status,'failed');assert.equal(calls.tabVisits.length,0);assert.equal((d.querySelector('#first') as HTMLInputElement).value,'');
  } finally {dom.window.close();}
});
test('preserves existing patient data; conflicting sample default prevents Add; three providers prevent selection', async () => {
  const {dom,d,calls}=fixture();try {
    (d.querySelector('#first') as HTMLInputElement).value='Existing';
    (d.querySelector('#tubes') as HTMLInputElement).value='2';
    d.querySelector('#selected tbody')!.innerHTML='<tr><td>A</td><td>OTHER</td><td><button>Remove</button></td></tr>'.repeat(3);
    const result=await sasAction({action:'fill',profile:{...profile,patientDefaults:false},record:generate('A',profile)});
    assert.equal((d.querySelector('#first') as HTMLInputElement).value,'Existing');assert.equal((d.querySelector('#dob') as HTMLInputElement).value,'');
    assert.equal(calls.adds,0);assert.equal(calls.selections,0);assert.equal(calls.searches,0);
    assert(result.outcomes.some(o=>o.field==='Add sample'&&o.status==='failed'));assert(result.outcomes.some(o=>o.field==='Provider'&&o.reason.includes('Three')));
  } finally {dom.window.close();}
});
test('unverified Add and Select actions are reported and never blindly repeated', async () => {
  const {dom,d,calls}=fixture();try {
    (d.querySelector('#add') as HTMLElement).onclick=()=>{calls.adds++;};
    // The fixture still returns fresh search rows, but selecting one provides no confirmation.
    d.addEventListener('click',e=>{
      const target=e.target as HTMLElement;
      if (target.matches('#providers button')) {e.stopImmediatePropagation();calls.selections++;}
    },true);
    const record=generate('UNCERTAIN',profile);
    const first=await sasAction({action:'fill',profile,record});
    assert(first.outcomes.some(o=>o.field==='Add sample'&&o.status==='failed'));
    assert(first.outcomes.some(o=>o.field==='Provider Information'&&o.status==='failed'));
    const again=await sasAction({action:'fill',profile,record});
    assert(again.outcomes.some(o=>o.field==='Add sample'&&o.status==='skipped'));
    assert(again.outcomes.some(o=>o.field==='Provider'&&o.status==='skipped'));
    assert.equal(calls.adds,1);assert.equal(calls.selections,1);
  } finally {dom.window.close();}
});
