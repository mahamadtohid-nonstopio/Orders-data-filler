import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const server = createServer(async (_req,res) => {res.setHeader('Content-Type','text/html');res.end(await readFile('demo/index.html'));});
await new Promise(r=>server.listen(4173,'127.0.0.1',r));
let context;
const observations=[];
try {
  context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:{width:1100,height:1000}});
  context.setDefaultTimeout(10000);
  console.log('Browser launched');
  const page=context.pages()[0];
  const cdp=await context.newCDPSession(page);
  const browserCdp=await context.browser().newBrowserCDPSession();
  const {id}=await browserCdp.send('Extensions.loadUnpacked',{path:resolve('dist')});
  console.log('Extension loaded',id);
  await page.goto('http://127.0.0.1:4173/orders/new');
  const {targetInfos}=await browserCdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
  const targetInfo=targetInfos.find(t=>t.url.includes('/orders/new')) || targetInfos[0];
  async function openPopup() {
    const pending=context.waitForEvent('page');
    pending.catch(()=>{});
    await browserCdp.send('Extensions.triggerAction',{id,targetId:targetInfo.targetId});
    // Headless Chrome does not expose action popovers as Playwright pages.
    // Trigger the real action for activeTab, then render the same popup document
    // in a background tab so chrome.tabs.query still resolves the order page.
    await browserCdp.send('Target.createTarget',{url:`chrome-extension://${id}/popup.html`,background:true});
    const popup=await pending; await popup.waitForLoadState(); await popup.locator('#setup').waitFor({state:'visible'}); return popup;
  }
  let popup=await openPopup();
  console.log('Popup opened');
  await popup.locator('#profileName').fill('Demo order');
  await popup.locator('#scope').fill('#order');
  await popup.locator('#scan').click();
  console.log('Scan clicked');
  await popup.locator('#results').filter({hasText:'Scanned'}).waitFor();
  // Duplicate patient/guardian labels deliberately require explicit mappings.
  for(const [field,selector] of Object.entries({firstName:'#first',lastName:'#last',accession:'#acc',mrn:'#mrn'})) await popup.locator('#'+field).fill(selector);
  for(const [label,group] of [['Care','#care'],['Research','#research']]) {
    await popup.locator('#addConsent').click(); const row=popup.locator('.consent').last();
    await row.locator('[data-key=label]').fill(label); await row.locator('[data-key=group]').fill(group); await row.locator('[data-key=yes]').fill('input[value="yes"]');
  }
  await popup.getByRole('button',{name:'Save profile',exact:true}).click();
  console.log('Save clicked',await popup.locator('#results').innerText());
  await popup.locator('#results').filter({hasText:'Profile saved'}).waitFor();
  await popup.locator('#ticket').fill('QA-001234');
  await popup.locator('#fill').click();
  await popup.locator('#results').filter({hasText:'6 filled'}).waitFor();
  observations.push(await popup.locator('#results').innerText());
  const first=await page.locator('#first').inputValue();
  const acc=await page.locator('#acc').inputValue();
  assert.equal(acc.slice(4),(await page.locator('#mrn').inputValue()).slice(4));
  assert.match(acc,/^ACC-001234\d+$/);
  assert.equal(await page.locator('#model').innerText(),'Controlled model: '+first);
  assert(await page.locator('#care input[value=yes]').isChecked());
  assert(await page.locator('#research input[value=yes]').isChecked());
  assert(await page.locator('#unrelated input[value=no]').isChecked());
  assert.equal(await page.locator('[name=guardianFirst]').inputValue(),'');
  assert.equal(await page.locator('#submission').innerText(),'No submission');
  await mkdir('test-results',{recursive:true});
  await popup.screenshot({path:'test-results/popup.png',fullPage:true});
  await page.screenshot({path:'test-results/demo.png',fullPage:true});
  await popup.close(); popup=await openPopup();
  await popup.locator('#ticket').filter({visible:true}).waitFor();
  await popup.waitForFunction(()=>document.querySelector('#ticket').value==='QA-001234');
  assert((await popup.locator('#preview').innerText()).includes(acc));
  await popup.locator('#fill').click(); await popup.locator('#results').filter({hasText:'6 unchanged'}).waitFor();
  observations.push('Reopened popup: saved profile and session record persisted; repeat fill reported six unchanged.');
  await popup.locator('#new').click();
  await popup.waitForFunction(old=>!document.querySelector('#preview').textContent.includes(old),acc);
  assert.equal(await page.locator('#acc').inputValue(),acc);
  await popup.locator('#fill').click(); await popup.locator('#results').filter({hasText:'6 unchanged'}).waitFor();
  await popup.locator('#overwrite').check(); await popup.locator('#fill').click();
  await popup.locator('#results').filter({hasText:'2 filled'}).waitFor();
  assert.equal(await page.locator('#first').inputValue(),first);
  assert.notEqual(await page.locator('#acc').inputValue(),acc);
  observations.push('New Test Data left the page untouched; overwrite replaced only the identifier pair and preserved stable ticket names.');
  // Select a rejecting model before opening the popup again.
  await popup.close(); await page.locator('#mode').selectOption('reject'); popup=await openPopup();
  await popup.locator('#ticket').fill('QA-009999'); await popup.locator('#overwrite').check(); await popup.locator('#fill').click();
  await popup.locator('#results').filter({hasText:'1 failed'}).waitFor();
  observations.push(await popup.locator('#results').innerText());
  await popup.close();
  await page.locator('#mode').selectOption('accept');
  await page.evaluate(()=>{
    for(let i=0;i<14;i++) {
      const group=document.createElement('fieldset'); group.id=`extra-${i}`;
      const label=document.createElement('label');label.textContent=`Extra consent ${i} Yes`;
      const radio=document.createElement('input');radio.type='radio';radio.name=`extra-${i}`;radio.value='yes';
      label.prepend(radio);group.append(label);document.querySelector('#order').append(group);
    }
  });
  popup=await openPopup();await popup.locator('#edit').click();
  for(let i=0;i<14;i++) {
    await popup.locator('#addConsent').click();const row=popup.locator('.consent').last();
    await row.locator('[data-key=label]').fill(`Extra ${i}`);await row.locator('[data-key=group]').fill(`#extra-${i}`);await row.locator('[data-key=yes]').fill('input[value=yes]');
  }
  await popup.getByRole('button',{name:'Save profile',exact:true}).click();
  await popup.locator('#results').filter({hasText:'Profile saved'}).waitFor();
  await popup.locator('#ticket').fill('BENCH-20');await popup.locator('#overwrite').check();await popup.locator('#fill').click();
  await popup.locator('#results').filter({hasText:'18 filled'}).waitFor();
  const benchmark=await popup.locator('#results').innerText();
  const duration=Number(benchmark.match(/\((\d+) ms\)/)[1]);assert(duration<2000);
  observations.push(`20-control benchmark: ${benchmark.split('\n')[0]}`);
  await writeFile('test-results/smoke.json',JSON.stringify({browser:context.browser()?.version(),observations},null,2));
  console.log('PASS: packaged extension popup, profile persistence, session records, mapped fields, controlled input, consent isolation, overwrite, and manual submission.');
  console.log(observations.join('\n'));
} catch(error) { for(const p of context?.pages()||[]) console.error(p.url(),await p.locator('body').innerText().catch(()=>'')); throw error; }
finally {await context?.close();await new Promise(r=>server.close(r));}
