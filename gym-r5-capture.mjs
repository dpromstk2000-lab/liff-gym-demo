import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE='https://dpromstk2000-lab.github.io/liff-gym-demo/';
const OUT='r5-live';
const WORKER='https://dpro-gym-line-api.dpromstk2000.workers.dev';
fs.mkdirSync(OUT,{recursive:true});
const report={
  stage:'R5_LIVE_SCREENSHOT_CAPTURE',
  system:'GYM',
  base:BASE,
  started_at:new Date().toISOString(),
  screenshots:[],
  pageErrors:[],
  consoleErrors:[],
  warnings:[],
  business_mutations:[],
  first10:null,
  ok:true
};
const browser=await chromium.launch({headless:true});

function attach(page,label){
  page.on('pageerror',e=>report.pageErrors.push({label,message:String(e.message||e)}));
  page.on('console',m=>{
    if(m.type()!=='error') return;
    const text=m.text();
    if(text.includes('LIFF')||text.includes('liff.init')||text.includes('endpoint URL')) {
      report.warnings.push({label,type:'KNOWN_DEMO_HOST_WARNING',text}); return;
    }
    if(/^Failed to load resource: the server responded with a status of 401/.test(text)){
      report.warnings.push({label,type:'TRANSIENT_HTTP_401',text}); return;
    }
    report.consoleErrors.push({label,text});
  });
  page.on('request',req=>{
    if(req.url().startsWith(WORKER)&&!['GET','HEAD','OPTIONS'].includes(req.method())){
      report.business_mutations.push({label,method:req.method(),url:req.url()});
    }
  });
}
async function shot(page,file,label,meta={}){
  const fp=path.join(OUT,file);
  await page.screenshot({path:fp,fullPage:false,animations:'disabled'});
  const s=fs.statSync(fp);
  report.screenshots.push({file,label,bytes:s.size,...meta});
}
async function openPage(width,height,url,label){
  const context=await browser.newContext({viewport:{width,height}});
  const page=await context.newPage();
  attach(page,label);
  await page.goto(url,{waitUntil:'domcontentloaded'});
  return {context,page};
}

// Guide Center desktop
{
  const {context,page}=await openPage(1440,1000,BASE+'guide-center.html?capture=1','guide-desktop');
  await page.waitForSelector('[data-guide-version="GYM-R4-V1.0-20260828"]');
  await page.waitForTimeout(500);
  const m=await page.evaluate(()=>({innerWidth,scrollWidth:document.documentElement.scrollWidth,first10:document.querySelectorAll('[data-first10-step]').length}));
  report.first10=m.first10;
  await shot(page,'01_guide_center_1440.png','Guide Center 1440',m);
  await context.close();
}
// Guide Center mobile
{
  const {context,page}=await openPage(390,844,BASE+'guide-center.html?capture=1','guide-mobile');
  await page.waitForSelector('[data-guide-version="GYM-R4-V1.0-20260828"]');
  await page.waitForTimeout(500);
  const m=await page.evaluate(()=>({innerWidth,scrollWidth:document.documentElement.scrollWidth,first10:document.querySelectorAll('[data-first10-step]').length}));
  await shot(page,'02_guide_center_390.png','Guide Center 390',m);
  await context.close();
}
// Canonical First10 screenshots: one current LIVE screenshot per step.
{
  const {context,page}=await openPage(1024,900,BASE+'tutorial.html?capture=1','tutorial-first10');
  await page.waitForSelector('#tutorialFrame');
  await page.waitForFunction(()=>window.DPRO_GYM_TUTORIAL?.data?.steps?.length===10);
  for(let n=1;n<=10;n++){
    await page.evaluate(n=>window.DPRO_GYM_TUTORIAL.testGoToStep(n),n);
    await page.waitForTimeout(850);
    const meta=await page.evaluate(()=>{
      const api=window.DPRO_GYM_TUTORIAL;
      const step=api.data.steps[api.step-1];
      const f=document.getElementById('tutorialFrame');
      const d=f.contentDocument;
      const t=d?.querySelector('[data-dt-target="1"]');
      return {
        step:api.step,
        title:step.title,
        route:step.route,
        frameURL:f.contentWindow.location.href,
        highlighted:Boolean(t),
        outerInnerWidth:innerWidth,
        outerScrollWidth:document.documentElement.scrollWidth,
        frameInnerWidth:f.contentWindow.innerWidth,
        frameScrollWidth:d?.documentElement.scrollWidth||null
      };
    });
    await shot(page,`${String(n+2).padStart(2,'0')}_first10_step_${String(n).padStart(2,'0')}.png`,`First10 Step ${n}`,meta);
  }
  await context.close();
}

await browser.close();
report.finished_at=new Date().toISOString();
if(report.first10!==10) { report.ok=false; report.errors=['First10 is not exactly 10']; }
if(report.pageErrors.length||report.consoleErrors.length||report.business_mutations.length) report.ok=false;
for(const s of report.screenshots){
  if(s.scrollWidth && s.scrollWidth>s.innerWidth) report.ok=false;
  if(s.outerScrollWidth && s.outerScrollWidth>s.outerInnerWidth) report.ok=false;
  if(s.frameScrollWidth && s.frameScrollWidth>s.frameInnerWidth) report.ok=false;
  if(s.highlighted===false) report.ok=false;
}
fs.writeFileSync(path.join(OUT,'r5-live-capture.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.ok) process.exit(1);
