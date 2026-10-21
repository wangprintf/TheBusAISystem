const {chromium}=require('C:/Users/wangmeng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 for (const style of ['DARK','DEFAULT']) {
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  const requests=[];
  page.on('response',r=>{if(/map\.gtimg\.com/.test(r.url()))requests.push({url:r.url().split('?')[0],status:r.status(),length:r.headers()['content-length']});});
  page.on('requestfailed',r=>{if(/map\.gtimg\.com/.test(r.url()))requests.push({url:r.url().split('?')[0],error:r.failure()?.errorText});});
  await page.route('https://api.open-meteo.com/**',r=>r.abort());
  await page.route('**/web/js/tencent-map.js',async r=>{const response=await r.fetch();let source=await response.text();source=source.replace("mapStyleId: 'DARK'",`mapStyleId: '${style}'`);await r.fulfill({response,body:source});});
  await page.goto('http://127.0.0.1:51745/map-preview');
  await page.waitForTimeout(15000);
  console.log(style,JSON.stringify(requests));
  await page.screenshot({path:'.artifacts/map-tiles-'+style+'.png'});
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
