const {chromium}=require('C:/Users/wangmeng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage();
await page.goto('http://127.0.0.1:51745/preview');
await page.waitForSelector('.weather-day');
for(const [width,height] of [[1920,1080],[1920,900],[1366,768],[1200,800],[900,900],[390,844]]){
await page.setViewportSize({width,height});
console.log(JSON.stringify(await page.evaluate(()=>{
const selectors=['.topbar','#weather-root','.weather-status','.dashboard-grid','.dashboard-footer','.dash-left','.dash-center','.dash-right'];
return {viewport:[innerWidth,innerHeight],rects:selectors.map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {s,top:r.top,bottom:r.bottom,height:r.height,scroll:e.scrollHeight,client:e.clientHeight}}),mainScroll:document.querySelector('.main-content').scrollHeight};
})));
if(width===1366||width===1920)await page.screenshot({path:`.artifacts/compact-${width}-${height}.png`});
}
await browser.close();
})();
