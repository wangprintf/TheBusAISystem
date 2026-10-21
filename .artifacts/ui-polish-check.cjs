const { chromium } = require('C:/Users/wangmeng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const dates = Array.from({length:7}, (_,i) => new Date(Date.UTC(2026,9,18+i)).toISOString().slice(0,10));
const forecast = {daily:{time:dates,weather_code:[0,2,3,61,71,45,95],temperature_2m_max:[24,22,20,19,16,18,20],temperature_2m_min:[13,12,11,10,8,9,11],precipitation_probability_max:[0,10,20,80,60,10,90],precipitation_sum:[0,0,0,5,2,0,8],wind_speed_10m_max:[15,18,10,20,14,12,24],uv_index_max:[5,4,3,2,2,3,2],sunrise:dates.map(d=>d+'T06:20'),sunset:dates.map(d=>d+'T17:30')}};
(async()=>{
 const browser = await chromium.launch({headless:true,channel:'msedge'});
 const page = await browser.newPage();
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 await page.route('https://api.open-meteo.com/**',r=>r.fulfill({json:forecast}));
 await page.goto('http://127.0.0.1:51745/preview');
 await page.waitForSelector('.weather-day');
 for(const [width,height] of [[1920,1080],[1920,900],[1366,768],[1200,800],[900,900],[390,844]]){
  await page.setViewportSize({width,height});
  const layout = await page.evaluate(()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
   const trend=document.querySelector('.trend-panel'), t=rect(trend),weather=document.querySelector('#weather-root'),w=rect(weather);
   const header=['#weather-root','.page-heading','.top-actions','.center-nav-orders','.center-nav-devices','#patrol-agent-root'].map(s=>({s,...rect(document.querySelector(s))}));
   const overlaps=[];for(let i=0;i<header.length;i++)for(let j=i+1;j<header.length;j++){const a=header[i],b=header[j];if(a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y)overlaps.push([a.s,b.s]);}
   return {viewport:[innerWidth,innerHeight],overlaps,trend:{...t,scroll:trend.scrollHeight,client:trend.clientHeight},dates:[...trend.querySelectorAll('.priority-date')].map(e=>({text:e.textContent,...rect(e)})),weather:{...w,scroll:weather.scrollHeight,client:weather.clientHeight},daysFit:[...weather.querySelectorAll('.weather-day')].every(e=>{const r=rect(e);return r.x>=w.x&&r.right<=w.right&&r.bottom<=w.bottom}),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  console.log(JSON.stringify(layout));
  assert.equal(layout.overlaps.length,0);assert.ok(layout.daysFit);
  assert.ok(layout.dates.every(d=>d.bottom<=layout.trend.bottom-6));
  assert.ok(layout.trend.scroll<=layout.trend.client+1);
  assert.equal(await page.locator('.weather-icon svg').count(),7);
  await page.locator('[data-weather-day="2"]').click();
  await page.locator('[data-weather-select="5"]').click();
  assert.equal(await page.locator('[data-weather-select="5"]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('.weather-detail').innerText(),/最大风速/);
  assert.ok(await page.locator('.weather-dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.weather-dialog').isVisible(),false);
  if(width>=1366)await page.screenshot({path:`.artifacts/polish-${width}-${height}.png`});
 }
 await page.setViewportSize({width:1920,height:1080});
 await page.locator('[data-weather-day="3"]').click();
 await page.screenshot({path:'.artifacts/polish-weather-detail.png'});
 await page.keyboard.press('Escape');
 await page.route('**/tests/fixtures/dashboard-device-data.js',async r=>{
  const response=await r.fetch();
  await r.fulfill({response,body:await response.text()+`\napi.getPersonnelLocations = async()=>[
   {id:'100001',name:'张丽',department:'巡检一队',status:'1',latitude:39.0900,longitude:117.2010},
   {id:'100002',name:'李明',department:'巡检二队',status:'1',latitude:39.0903,longitude:117.2013},
   {id:'100003',name:'王才',department:'巡检三队',status:'0',latitude:39.9042,longitude:116.4074}];`});
 });
 await page.route('**/web/js/tencent-map.js',async r=>{
  const response=await r.fetch();let source=await response.text();
  source=source.replace('const hidePersonnelTooltip =','window.__polish = {map, get marker(){return personnelMarker}, get cluster(){return personnelCluster}};\n  const hidePersonnelTooltip =');
  await r.fulfill({response,body:source});
 });
 await page.goto('http://127.0.0.1:51745/map-preview');
 await page.waitForFunction(()=>window.__polish?.marker,{timeout:45000});
 await page.waitForTimeout(1800);
 console.log('REAL MAP',await page.evaluate(()=>({zoom:__polish.map.getZoom(),groups:__polish.cluster.getClusters().map(g=>g.geometries.length),markers:__polish.marker.getGeometries().map(g=>({id:g.id,properties:g.properties}))})));
 await page.screenshot({path:'.artifacts/polish-real-map.png'});
 await browser.close();
 console.log('Layout, complete chart dates, weather icons and weather dialog passed');
})().catch(e=>{console.error(e);process.exit(1)});
