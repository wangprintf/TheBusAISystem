import test from 'node:test';
import assert from 'node:assert/strict';
import { parseForecast, weatherLabel, forecastUrl } from '../web/js/weather.js';

test('forecast preserves missing values instead of displaying false zero temperatures', () => {
  const daily = { time: Array.from({ length: 7 }, (_, i) => `2026-10-${15 + i}`), temperature_2m_max: [0, null, -3.6], temperature_2m_min: [-2, undefined, -8.2], precipitation_probability_max: [0, null, 100] };
  const days = parseForecast({ daily });
  assert.equal(days.length, 7);
  assert.equal(days[0].high, 0);
  assert.equal(days[0].rain, 0);
  assert.equal(days[1].high, null);
  assert.equal(days[1].low, null);
  assert.equal(days[1].rain, null);
  assert.equal(days[2].high, -4);
  assert.equal(days[2].rain, 100);
  assert.throws(() => parseForecast({ daily: { time: [] } }));
});
test('weather codes distinguish hazardous precipitation and unknown data', () => {
  assert.equal(weatherLabel(0)[0], '晴');
  assert.equal(weatherLabel(67)[0], '冻雨');
  assert.equal(weatherLabel(86)[0], '阵雪');
  assert.equal(weatherLabel(99)[0], '雷雨');
  assert.equal(weatherLabel(null)[0], '未知');
  const url = new URL(forecastUrl());
  assert.equal(url.searchParams.get('forecast_days'), '7');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Shanghai');
});

test('detail fields retain light rainfall and handle unavailable sunrise without injecting markup', () => {
  const daily = { time: Array.from({ length: 7 }, (_, i) => `2026-10-${18 + i}`), precipitation_sum: [0.4], wind_speed_10m_max: [12.3], uv_index_max: [3.2], sunrise: ['2026-10-18T06:23', '<img src=x>'], sunset: ['2026-10-18T17:28'] };
  const days = parseForecast({ daily });
  assert.equal(days[0].rainTotal, 0.4);
  assert.equal(days[0].wind, 12.3);
  assert.equal(days[0].uv, 3.2);
  assert.equal(days[0].sunrise, '06:23');
  assert.equal(days[0].sunset, '17:28');
  assert.equal(days[1].sunrise, '—');
  assert.equal(days[1].rainTotal, null);
  const query = new URL(forecastUrl()).searchParams;
  assert.equal(query.get('wind_speed_unit'), 'kmh');
  assert.ok(query.get('daily').includes('precipitation_sum'));
});
