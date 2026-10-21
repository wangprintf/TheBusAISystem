const {chromium}=require('C:/Users/wangmeng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 page.on('requestfailed',r=>console.log('FAILED',new URL(r.url()).hostname,r.failure()?.errorText));
 await page.route('https://api.open-meteo.com/**',r=>r.abort());
 await page.route('**/tests/fixtures/dashboard-device-data.js',async r=>{
  const response=await r.fetch();await r.fulfill({response,body:await response.text()+`\napi.getPersonnelLocations = async()=>[
  {accountId:'100001',name:'张丽',department:'巡检一队',status:'online',latitude:39.0900,longitude:117.2010},
  {accountId:'100002',name:'李明',department:'巡检二队',status:'online',latitude:39.0903,longitude:117.2013},
  {accountId:'100003',name:'王才',department:'巡检三队',status:'offline',latitude:39.9042,longitude:116.4074}];`});
 });
 await page.route('**/web/js/tencent-map.js',async r=>{
  const response=await r.fetch();let source=await response.text();
  source=source.replace('const hidePersonnelTooltip =','window.__polish = {map, get marker(){return personnelMarker}, get cluster(){return personnelCluster}};\n  const hidePersonnelTooltip =');
  await r.fulfill({response,body:source});
 });
 await page.goto('http://127.0.0.1:51745/map-preview');
 try{await page.waitForFunction(()=>window.__polish?.marker,null,{timeout:22000});}
 catch(e){console.log('MAP STATUS',await page.evaluate(()=>({sdk:!!window.TMap,map:!!window.__polish,personnel:document.querySelector('.personnel-map-control')?.innerText,message:document.querySelector('.map-message')?.innerText})));await page.screenshot({path:'.artifacts/polish-map-status.png'});await browser.close();throw e;}
 await page.waitForTimeout(2500);
 console.log('MAP',await page.evaluate(()=>({zoom:__polish.map.getZoom(),groups:__polish.cluster.getClusters().map(g=>g.geometries.length),markers:__polish.marker.getGeometries().map(g=>({id:g.id,properties:g.properties}))})));
 const screenPoint = async id => page.evaluate(id=>{
  const geometry=__polish.marker.getGeometries().find(g=>g.id===id);
  const point=__polish.map.projectToContainer(geometry.position);
  const box=document.querySelector('#dashboard-tencent-map').getBoundingClientRect();
  return {x:box.x+point.x,y:box.y+point.y};
 },id);
 const personPoint=await screenPoint('person-100003');
 await page.mouse.move(personPoint.x,personPoint.y);
 await page.locator('.personnel-map-tooltip').filter({hasText:'王才'}).waitFor();
 await page.mouse.click(personPoint.x,personPoint.y);
 await page.waitForFunction(()=>document.querySelector('.personnel-map-details strong')?.textContent==='王才');
 await page.locator('[data-close-personnel]').click();
 const clusterPoint=await screenPoint('personnel-cluster-0');
 await page.mouse.move(clusterPoint.x,clusterPoint.y);
 await page.locator('.personnel-map-tooltip').filter({hasText:'2 位人员'}).waitFor();
 await page.mouse.click(clusterPoint.x,clusterPoint.y);
 await page.waitForFunction(()=>__polish.map.getZoom()===11);
 await page.evaluate(()=>__polish.map.setZoom(18));
 await page.waitForFunction(()=>__polish.marker.getGeometries().filter(g=>g.properties.accountId).length===2);
 await page.waitForTimeout(5000);
 const expandedPoint=await screenPoint('person-100001');
 await page.mouse.move(expandedPoint.x,expandedPoint.y);
 await page.locator('.personnel-map-tooltip').filter({hasText:'张丽'}).waitFor();
 await page.mouse.click(expandedPoint.x,expandedPoint.y);
 await page.waitForFunction(()=>document.querySelector('.personnel-map-details strong')?.textContent==='张丽');
 await page.screenshot({path:'.artifacts/polish-real-map.png'});
 console.log('PASS: real SDK clusters, pointer hover, details clicks and zoom expansion');
 await browser.close();
})().catch(e=>{console.error(e.message);process.exit(1)});

