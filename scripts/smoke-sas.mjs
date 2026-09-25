import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const server = createServer(async (_req,res) => {res.setHeader('Content-Type','text/html');res.end(await readFile('demo/sas.html'));});
await new Promise(r=>server.listen(4173,'127.0.0.1',r));
let context;
try {
  context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:{width:1200,height:1000}});
  context.setDefaultTimeout(15000);
  const page=context.pages()[0], browserCdp=await context.browser().newBrowserCDPSession();
  const {id}=await browserCdp.send('Extensions.loadUnpacked',{path:resolve('dist')});
  await page.goto('http://127.0.0.1:4173/orders/sample/create-order');
  const {targetInfos}=await browserCdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
  const target=targetInfos.find(t=>t.url.includes('/orders/sample/create-order'));
  await browserCdp.send('Extensions.triggerAction',{id,targetId:target.targetId});
  const pending=context.waitForEvent('page');
  await browserCdp.send('Target.createTarget',{url:`chrome-extension://${id}/popup.html`,background:true});
  const popup=await pending;await popup.waitForLoadState();
  await popup.locator('#profileName').fill('SAS local fixture');
  await popup.locator('#workflow').selectOption('sas');await popup.locator('#scope').fill('body');
  await popup.getByRole('button',{name:'Save profile',exact:true}).click();
  await popup.locator('#results').filter({hasText:'Profile saved'}).waitFor();
  assert(await popup.locator('#patientDefaultsRow').isVisible());
  await popup.locator('#ticket').fill('SAS-001500');await popup.locator('#fill').click();
  await popup.locator('#results strong').waitFor({timeout:100000});
  let summary=await popup.locator('#results').innerText();assert.match(summary,/^Complete:/);assert.doesNotMatch(summary,/failed —|skipped —/);
  const calls=await page.evaluate(()=>window.fixture);
  assert.equal(calls.adds,1);assert.equal(calls.selections,1);assert.equal(calls.searches,1);assert.deepEqual(calls.tabVisits,['patient','test','provider']);
  assert.equal(await page.locator('#selected tbody tr').count(),1);assert.equal(await page.locator('#submission').innerText(),'No submission');
  assert.equal(await page.locator('#provider-first').inputValue(),'');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/sas-provider.png',fullPage:true});await popup.screenshot({path:'test-results/sas-popup.png',fullPage:true});
  await popup.locator('#fill').click();await popup.locator('#results strong').waitFor({timeout:100000});
  summary=await popup.locator('#results').innerText();assert.match(summary,/^Complete:/);
  assert.equal(await page.evaluate(()=>fixture.adds),1);assert.equal(await page.evaluate(()=>fixture.selections),1);
  await page.getByRole('tab',{name:'TEST INFORMATION',exact:true}).click();await page.screenshot({path:'test-results/sas-test.png',fullPage:true});
  assert(await page.locator('[name=consent][value=yes]').isChecked());assert(await page.locator('[name=data][value=in]').isChecked());assert(!await page.locator('#retention').isChecked());
  await page.getByRole('tab',{name:'PATIENT INFORMATION',exact:true}).click();await page.screenshot({path:'test-results/sas-patient.png',fullPage:true});
  assert.equal(await page.locator('#dob').inputValue(),'1990-01-01');assert(await page.locator('[name=gender][value=Unknown]').isChecked());
  await writeFile('test-results/sas-smoke.json',JSON.stringify({browser:context.browser().version(),calls,repeatSummary:summary,scope:'Local fixture; actual QA website not connected.'},null,2));
  console.log('PASS: SAS packaged popup, profile setup, three tabs, custom dropdowns, async autocomplete, Add sample, Self/Yes/Opt In, one TCHE provider, safe repeat, no submission.');
} catch(error) {for(const p of context?.pages()||[]) console.error(p.url(),await p.locator('body').innerText().catch(()=>''));throw error;}
finally {await context?.close();await new Promise(r=>server.close(r));}
