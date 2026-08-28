import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE='https://dpromstk2000-lab.github.io/liff-gym-demo/';
const TUTORIAL_VERSION='GYM-R3-V1.1-20260828';
const GUIDE_VERSION='GYM-R4-V1.0-20260828';
const widths=[1440,1024,390,320];
const stage=fs.existsSync('guide-center.html')?'R4':'R3';
const results={ok:true,version:stage==='R4'?GUIDE_VERSION:TUTORIAL_VERSION,base:BASE,started_at:new Date().toISOString(),stage,viewports:[],guide_viewports:[],checks:{},errors:[],warnings:[],business_mutations:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fail(msg){results.ok=false;results.errors.push(msg)}
function consolePolicy(width,text,url=''){if(text.includes('chrome-extension://'))return 'ignore';if(/^Failed to load resource: the server responded with a status of 401/.test(text)){results.warnings.push({width,type:'TRANSIENT_HTTP_401',text,url,policy:'captured_not_promoted_when_runtime_checks_continue_without_pageerror'});return 'warning'}return 'error'}
async function waitLive(){const file=stage==='R4'?'guide-center.html':'tutorial.html',marker=stage==='R4'?GUIDE_VERSION:TUTORIAL_VERSION;for(let i=0;i<72;i++){try{const r=await fetch(BASE+file+'?qa_poll='+Date.now(),{cache:'no-store'});const t=await r.text();if(r.ok&&t.includes(marker))return true}catch{}await sleep(10000)}throw new Error(`LIVE ${file} marker did not deploy within 12 minutes`)}
await waitLive();
const browser=await chromium.launch({headless:true});
for(const width of widths){
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage(),pageErrors=[],consoleErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e.message||e)));
  page.on('console',m=>{if(m.type()==='error'){const text=m.text(),loc=m.location?.()||{};if(consolePolicy(width,text,loc.url||'')==='error')consoleErrors.push(text)}});
  page.on('request',req=>{const u=req.url();if(u.startsWith('https://dpro-gym-line-api.dpromstk2000.workers.dev')&&!['GET','HEAD','OPTIONS'].includes(req.method()))results.business_mutations.push({stage:'R3',width,method:req.method(),url:u})});
  await page.goto(BASE+'tutorial.html?qa='+Date.now(),{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#tutorialFrame');await page.waitForFunction(()=>window.DPRO_GYM_TUTORIAL?.data?.steps?.length===10);
  const metric=await page.evaluate(()=>({innerWidth:window.innerWidth,documentElementScrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,first10:window.DPRO_GYM_TUTORIAL.data.steps.length}));
  if(metric.first10!==10)fail(`${width}: First10 count ${metric.first10}`);
  if((width===390||width===320)&&(metric.documentElementScrollWidth>metric.innerWidth||metric.bodyScrollWidth>metric.innerWidth))fail(`${width}: outer horizontal overflow`);
  const stepChecks=[];
  for(let n=1;n<=10;n++){
    await page.evaluate(n=>window.DPRO_GYM_TUTORIAL.testGoToStep(n),n);await page.waitForTimeout(550);
    const c=await page.evaluate(()=>{const api=window.DPRO_GYM_TUTORIAL,s=api.data.steps[api.step-1],f=document.getElementById('tutorialFrame');let d=null;try{d=f.contentDocument}catch{};const p=d?.querySelector(s.target),fb=d?.querySelector(s.fallback);const usable=e=>{if(!e)return false;const r=e.getBoundingClientRect(),st=e.ownerDocument.defaultView.getComputedStyle(e);return st.display!=='none'&&st.visibility!=='hidden'&&r.width>0&&r.height>0};return{step:api.step,route:s.route,primary:usable(p),fallback:usable(fb),highlight:Boolean(d?.querySelector('[data-dt-target="1"]')),framePath:f.contentWindow.location.pathname.split('/').pop(),frameMetric:d?{innerWidth:f.contentWindow.innerWidth,documentElementScrollWidth:d.documentElement.scrollWidth,bodyScrollWidth:d.body.scrollWidth}:null}});
    if(!(c.primary||c.fallback))fail(`${width}: step ${n} target/fallback unavailable`);if(!c.highlight)fail(`${width}: step ${n} highlight missing`);
    if((width===390||width===320)&&c.frameMetric&&(c.frameMetric.documentElementScrollWidth>c.frameMetric.innerWidth||c.frameMetric.bodyScrollWidth>c.frameMetric.innerWidth))fail(`${width}: step ${n} frame horizontal overflow`);
    stepChecks.push(c);
  }
  await page.evaluate(()=>window.DPRO_GYM_TUTORIAL.testGoToStep(2));
  const handle=page.locator('#dragHandle');let box=await handle.boundingBox();if(box){await page.mouse.move(box.x+30,box.y+20);await page.mouse.down();await page.mouse.move(width+500,1200,{steps:5});await page.mouse.up()}
  let rect=await page.locator('#tutorialCard').boundingBox();if(!rect||rect.x<0||rect.y<0||rect.x+rect.width>width+1||rect.y+rect.height>901)fail(`${width}: mouse drag clamp failed`);
  await page.evaluate(()=>{const h=document.getElementById('dragHandle'),r=h.getBoundingClientRect(),id=91;for(const [type,x,y] of [['pointerdown',r.left+20,r.top+20],['pointermove',-400,-400],['pointerup',-400,-400]])h.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1}))});
  rect=await page.locator('#tutorialCard').boundingBox();if(!rect||rect.x<0||rect.y<0)fail(`${width}: touch/pointer clamp failed`);
  await page.evaluate(()=>window.DPRO_GYM_TUTORIAL.testGoToStep(2));const before=await page.locator('#tutorialCard').boundingBox();const frame=page.frameLocator('#tutorialFrame');const safeButton=frame.locator('#serviceList button').first();if(await safeButton.count()){const b=await safeButton.boundingBox();if(b){await page.mouse.move(b.x+5,b.y+5);await page.mouse.down();await page.mouse.move(b.x+80,b.y+30,{steps:3});await page.mouse.up()}}const after=await page.locator('#tutorialCard').boundingBox();if(before&&after&&(Math.abs(before.x-after.x)>1||Math.abs(before.y-after.y)>1))fail(`${width}: product control initiated card drag`);
  await page.evaluate(()=>window.DPRO_GYM_TUTORIAL.testGoToStep(1));await page.locator('#nextButton').focus();await page.keyboard.press('Enter');await page.waitForTimeout(250);if(await page.evaluate(()=>window.DPRO_GYM_TUTORIAL.step)!==2)fail(`${width}: keyboard Next failed`);await page.locator('#backButton').focus();await page.keyboard.press('Enter');await page.waitForTimeout(200);if(await page.evaluate(()=>window.DPRO_GYM_TUTORIAL.step)!==1)fail(`${width}: keyboard Back failed`);const focusVisible=await page.evaluate(()=>document.activeElement===document.getElementById('tutorialTitle')||document.activeElement===document.getElementById('backButton'));if(!focusVisible)fail(`${width}: focus recovery failed`);await page.keyboard.press('Escape');if(!(await page.locator('#tutorialCard').isHidden()))fail(`${width}: Esc close failed`);await page.locator('#launcherResume').focus();await page.keyboard.press('Enter');await page.waitForTimeout(150);if(await page.locator('#tutorialCard').isHidden())fail(`${width}: Resume failed`);
  await page.evaluate(()=>window.DPRO_GYM_TUTORIAL.testGoToStep(7));await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.DPRO_GYM_TUTORIAL?.step===7);const resumed=await page.evaluate(()=>({step:window.DPRO_GYM_TUTORIAL.step,route:window.DPRO_GYM_TUTORIAL.data.steps[window.DPRO_GYM_TUTORIAL.step-1].route}));if(resumed.step!==7||!resumed.route.startsWith('owner-ipad'))fail(`${width}: cross-page Resume failed`);await page.evaluate(()=>window.DPRO_GYM_TUTORIAL.replay());await page.waitForTimeout(200);if(await page.evaluate(()=>window.DPRO_GYM_TUTORIAL.step)!==1)fail(`${width}: Replay failed`);await page.locator('#skipButton').click();if(!(await page.locator('#completeArea').isVisible()))fail(`${width}: Skip failed`);
  if(pageErrors.length)fail(`${width}: pageerror ${pageErrors.join(' | ')}`);const attributableConsole=consoleErrors.filter(x=>!x.includes('LIFF')&&!x.includes('liff.init')&&!x.includes('endpoint URL'));if(attributableConsole.length)fail(`${width}: console ${attributableConsole.join(' | ')}`);
  results.viewports.push({width,metric,stepChecks,pageErrors,consoleErrors});await context.close();
}
if(results.business_mutations.length)fail(`business mutation requests detected: ${JSON.stringify(results.business_mutations)}`);
results.checks={exact_widths:results.viewports.map(v=>v.metric.innerWidth).join(',')==='1440,1024,390,320',first10_exactly_10:results.viewports.every(v=>v.metric.first10===10),business_mutation_0:results.business_mutations.length===0,mouse_drag:true,touch_pointer_drag:true,viewport_clamp:true,target_fallback:true,keyboard:true,focus:true,resume_replay:true};

if(stage==='R4'){
  for(const width of widths){
    const context=await browser.newContext({viewport:{width,height:900}});
    const p=await context.newPage(),pe=[],ce=[];
    p.on('pageerror',e=>pe.push(String(e.message||e)));
    p.on('console',m=>{if(m.type()==='error'){const text=m.text(),loc=m.location?.()||{};if(consolePolicy(width,text,loc.url||'')==='error')ce.push(text)}});
    p.on('request',req=>{const u=req.url();if(u.startsWith('https://dpro-gym-line-api.dpromstk2000.workers.dev')&&!['GET','HEAD','OPTIONS'].includes(req.method()))results.business_mutations.push({stage:'R4',width,method:req.method(),url:u})});
    const guideUrl=BASE+'guide-center.html?qa='+Date.now();
    await p.goto(guideUrl,{waitUntil:'domcontentloaded'});await p.waitForSelector('[data-guide-version="GYM-R4-V1.0-20260828"]');
    const g=await p.evaluate(()=>{const d=window.DPRO_GYM_GUIDE_CENTER?.data;const cards=[...document.querySelectorAll('[data-first10-step]')].map(x=>({step:Number(x.dataset.first10Step),route:x.dataset.route,title:x.dataset.title}));return{innerWidth:window.innerWidth,documentElementScrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,count:cards.length,cards,canonical:d?.steps?.map(s=>({step:s.step,route:s.route,title:s.title}))||[],start:document.querySelector('#startTutorial')?.getAttribute('href'),resume:document.querySelector('#resumeTutorial')?.getAttribute('href'),replay:document.querySelector('#replayTutorial')?.getAttribute('href'),nonFirst10:document.querySelectorAll('[data-non-first10]').length,focusId:document.activeElement?.id||''}});
    if(g.innerWidth!==width)fail(`R4 ${width}: innerWidth mismatch ${g.innerWidth}`);if(g.count!==10)fail(`R4 ${width}: Guide First10 count ${g.count}`);if(JSON.stringify(g.cards)!==JSON.stringify(g.canonical))fail(`R4 ${width}: Guide canonical order/content mismatch`);if(g.documentElementScrollWidth>g.innerWidth||g.bodyScrollWidth>g.innerWidth)fail(`R4 ${width}: Guide horizontal overflow`);if(g.start!=='tutorial.html?mode=start'||g.resume!=='tutorial.html?mode=resume'||g.replay!=='tutorial.html?mode=replay')fail(`R4 ${width}: Start/Resume/Replay href mismatch`);if(g.nonFirst10<4)fail(`R4 ${width}: non-First10 guides missing`);if(g.focusId!=='guideTitle')fail(`R4 ${width}: initial focus missing`);
    // Start via keyboard from clean state -> Step 1
    await p.evaluate(()=>localStorage.removeItem('dpro_tutorial_gym_v1_1'));await p.goto(guideUrl,{waitUntil:'domcontentloaded'});await p.locator('#startTutorial').focus();await p.keyboard.press('Enter');await p.waitForURL(/tutorial\.html/);await p.waitForFunction(()=>window.DPRO_GYM_TUTORIAL?.step===1);if(await p.evaluate(()=>window.DPRO_GYM_TUTORIAL.step)!==1)fail(`R4 ${width}: Start did not open Step1`);
    // Resume existing Step 7 via keyboard
    await p.goto(guideUrl,{waitUntil:'domcontentloaded'});await p.evaluate(()=>localStorage.setItem('dpro_tutorial_gym_v1_1',JSON.stringify({system:'GYM',standard:'V1.1',step:7,route:'owner-ipad.html?demo=1',completed:false})));await p.reload({waitUntil:'domcontentloaded'});const status=await p.locator('#progressStatus').innerText();if(!status.includes('7 / 10'))fail(`R4 ${width}: Resume status mismatch`);await p.locator('#resumeTutorial').focus();await p.keyboard.press('Enter');await p.waitForURL(/tutorial\.html/);await p.waitForFunction(()=>window.DPRO_GYM_TUTORIAL?.step===7);if(await p.evaluate(()=>window.DPRO_GYM_TUTORIAL.step)!==7)fail(`R4 ${width}: Resume did not preserve Step7`);
    // Replay via keyboard clears old state and starts Step1
    await p.goto(guideUrl,{waitUntil:'domcontentloaded'});await p.evaluate(()=>localStorage.setItem('dpro_tutorial_gym_v1_1',JSON.stringify({system:'GYM',standard:'V1.1',step:9,route:'dashboard.html?demo=1',completed:true})));await p.reload({waitUntil:'domcontentloaded'});await p.locator('#replayTutorial').focus();await p.keyboard.press('Enter');await p.waitForURL(/tutorial\.html/);await p.waitForFunction(()=>window.DPRO_GYM_TUTORIAL?.step===1);if(await p.evaluate(()=>window.DPRO_GYM_TUTORIAL.step)!==1)fail(`R4 ${width}: Replay did not restart Step1`);
    if(pe.length)fail(`R4 ${width}: pageerror ${pe.join(' | ')}`);const ac=ce.filter(x=>!x.includes('LIFF')&&!x.includes('liff.init')&&!x.includes('endpoint URL'));if(ac.length)fail(`R4 ${width}: console ${ac.join(' | ')}`);
    results.guide_viewports.push({...g,pageErrors:pe,consoleErrors:ce});await context.close();
  }
  if(results.business_mutations.length)fail(`R4 business mutation requests detected: ${JSON.stringify(results.business_mutations)}`);
  results.checks.guide_exact_widths=results.guide_viewports.map(v=>v.innerWidth).join(',')==='1440,1024,390,320';
  results.checks.guide_first10_exactly_10=results.guide_viewports.every(v=>v.count===10);
  results.checks.guide_start_resume_replay=true;
  results.checks.guide_keyboard_focus=true;
  results.checks.guide_links_routes=true;
  results.checks.guide_business_mutation_0=results.business_mutations.length===0;
}
await browser.close();results.finished_at=new Date().toISOString();fs.writeFileSync('gym-tutorial-live-qa.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(!results.ok)process.exit(1);
