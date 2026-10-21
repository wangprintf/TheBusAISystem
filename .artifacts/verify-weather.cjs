const { chromium }=require('C:/Users/wangmeng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
await page.goto('http://127.0.0.1:51745/preview');
await page.waitForSelector('.weather-day',{timeout:25000});
console.log('Weather count',await page.locator('.weather-day').count());
for(const width of [1920,1366,1200,900,390]){
 await page.setViewportSize({width,height:1000});
 const result=await page.evaluate(()=>{
 const selectors=['#weather-root','.page-heading','.top-actions','.center-nav-orders','.center-nav-devices','#patrol-agent-root'];
 const rects=selectors.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {s,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width}});
 const overlaps=[];for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y)overlaps.push([a.s,b.s]);}
 return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,overlaps,rects};});
 console.log(JSON.stringify(result));assert.equal(result.overlaps.length,0);
 await page.locator('[data-weather-day="2"]').click();
 await page.locator('.weather-dialog').waitFor({state:'visible'});
 assert.match(await page.locator('.weather-detail').innerText(),/最大风速/);
 await page.locator('[data-weather-select="5"]').click();
 assert.equal(await page.locator('[data-weather-select="5"]').getAttribute('aria-pressed'),'true');
 const fits=await page.locator('.weather-dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight});assert.ok(fits);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.weather-dialog').isVisible(),false);
}
await page.setViewportSize({width:1920,height:1080});
await page.screenshot({path:'.artifacts/weather-summary.png'});
await page.locator('[data-weather-day="0"]').click();
console.log('Live details:',await page.locator('.weather-detail').innerText());
await page.screenshot({path:'.artifacts/weather-dialog.png'});
await page.locator('[data-weather-close]').click();
await page.route('https://api.open-meteo.com/**',r=>r.abort());
await page.reload();await page.locator('#weather-root').getByText('天气暂不可用 · 点击详情重试').waitFor();
await page.locator('[data-weather-open]').click();
await page.unroute('https://api.open-meteo.com/**');
await page.locator('[data-weather-refresh]').click();
await page.waitForSelector('.weather-day',{timeout:25000});
assert.equal(await page.locator('.weather-date-picker button').count(),7);
await page.locator('[data-weather-close]').click();
await page.locator('[data-center-page="devices"]').click();await page.waitForSelector('#device-table-body');
await page.locator('[data-weather-open]').click();assert.ok(await page.locator('.weather-dialog').isVisible());
console.log('Dialog switching, Escape, close, network failure/retry and device navigation passed');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});

