import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlanSchema } from '../src/planSchema.js';
import { buildResponse, fakeOpenMeteo } from './helpers.js';

const plan = async (input, deps) => (await buildResponse(input, deps)).plan;
const household = (extra) => ({ adults: 2, children: 0, seniors: 0, conditions: [], ...extra });

test('every scenario produces a plan that satisfies the shared schema', async () => {
  for (const aqi of [20, 80, 130, 170, 250, 400]) {
    for (const budget of ['low', 'medium', 'high']) {
      const result = await plan({
        manualAqi: aqi,
        budget,
        household: household({ children: 2, conditions: ['asthma'] }),
      });
      PlanSchema.parse(result);
    }
  }
});

test('always leads with exactly three concrete top actions', async () => {
  const { top_actions: top } = await plan({ manualAqi: 180 });
  assert.equal(top.length, 3);
  assert.ok(top.every((action) => action.length > 20));
});

test('advice scales with the air: good air does not alarm, hazardous air says stay in', async () => {
  const good = await plan({ manualAqi: 25 });
  const hazardous = await plan({ manualAqi: 400 });
  assert.match(good.headline, /fine for normal routines/i);
  assert.match(hazardous.headline, /indoors/i);
  assert.ok(!good.daily_routine.some((item) => /respirator/i.test(item.action)));
  assert.ok(hazardous.daily_routine.some((item) => /respirator/i.test(item.action)));
});

test('a low budget never gets medium or high cost hacks', async () => {
  const { indoor_air_hacks: hacks } = await plan({ manualAqi: 180, budget: 'low' });
  assert.ok(hacks.length > 0);
  assert.ok(hacks.every((hack) => ['free', 'low'].includes(hack.cost)));
});

test('purifier owners are told how to use it, others get a DIY option', async () => {
  const home = (hasPurifier) => ({ heating: 'electric', cooking: 'induction', hasPurifier });
  const owns = await plan({ manualAqi: 180, home: home(true) });
  const lacks = await plan({ manualAqi: 180, home: home(false) });
  assert.ok(owns.indoor_air_hacks.some((hack) => /Use your purifier/.test(hack.title)));
  assert.ok(lacks.indoor_air_hacks.some((hack) => /box-fan/i.test(hack.title)));
});

test('combustion heating adds a CO alarm and a cleaner-heating swap', async () => {
  const result = await plan({ manualAqi: 180, home: { heating: 'wood', cooking: 'gas', hasPurifier: false } });
  assert.ok(result.indoor_air_hacks.some((hack) => /carbon monoxide/i.test(hack.title)));
  assert.ok(result.sustainable_alternatives.some((swap) => /wood/i.test(swap.swap)));
});

test('commute tips quantify CO2e, and disappear when nothing is greener', async () => {
  const driver = await plan({ manualAqi: 180, commute: { mode: 'car', oneWayKm: 10, daysPerWeek: 5 } });
  assert.ok(driver.daily_routine.some((item) => /kg CO₂e saved per week/.test(item.impact)));
  const walker = await plan({ manualAqi: 180, commute: { mode: 'walk', oneWayKm: 1, daysPerWeek: 5 } });
  assert.ok(!walker.daily_routine.some((item) => /kg CO₂e/.test(item.impact)));
});

test('vulnerable members get specific guidance only when present', async () => {
  const none = await plan({ manualAqi: 180 });
  assert.deepEqual(none.protect_vulnerable_members, []);
  const some = await plan({
    manualAqi: 180,
    household: household({ children: 1, seniors: 1, conditions: ['asthma', 'pregnancy'] }),
  });
  assert.ok(some.protect_vulnerable_members.length >= 4);
});

test('a time window is recommended only when it is clearly cleaner', async () => {
  const withWindow = await plan({});
  assert.ok(withWindow.daily_routine.some((item) => /between 14:00 and 16:00/.test(item.action)));
  const flat = await plan({ manualAqi: 180 }); // manual AQI has no forecast at all
  assert.ok(!flat.daily_routine.some((item) => /between \d\d:\d\d and/.test(item.action)));
});

const hazardousForecast = (base) => ({ fetchImpl: fakeOpenMeteo({ aqi: base, pm25: 300 }) });

test('a relatively cleaner window that is still hazardous never suggests outdoor play', async () => {
  const result = await plan({}, hazardousForecast(400));
  const windowAction = result.daily_routine.find((item) => /between \d\d:\d\d and/.test(item.action));
  assert.ok(windowAction, 'the cleaner window is still useful for essential trips');
  assert.doesNotMatch(windowAction.action, /outdoor play/);
  assert.match(windowAction.action, /respirator/);
});

test('on avoid days nobody is told to walk or cycle, including the school run', async () => {
  const result = await plan({
    manualAqi: 400,
    household: household({ children: 2 }),
    commute: { mode: 'car', oneWayKm: 2, daysPerWeek: 5 },
  });
  const text = JSON.stringify([result.daily_routine, result.sustainable_alternatives]).replace(
    'instead of walking or cycling',
    '',
  );
  assert.doesNotMatch(text, /\b(walk|walking|cycle|cycling)\b/i);
  assert.ok(result.sustainable_alternatives.some((alt) => /carpool/i.test(alt.swap)));

  const mild = await plan({ manualAqi: 60, household: household({ children: 2 }) });
  assert.ok(mild.sustainable_alternatives.some((alt) => /Walk, cycle or carpool/.test(alt.swap)));
});

test('fireplace advice never says to close the damper on a lit fire', async () => {
  const result = await plan({ manualAqi: 180, home: { heating: 'wood', cooking: 'gas', hasPurifier: false } });
  const steps = result.indoor_air_hacks.flatMap((hack) => hack.steps).join(' ');
  assert.match(steps, /damper only when no fire is lit and the ashes are completely cold/);
});
