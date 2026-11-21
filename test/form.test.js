import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { afterEach, before, beforeEach, describe, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { applyProfile, clearProfile, loadProfile, readProfile, saveProfile } from '../public/form.js';
import { parseProfile } from '../src/profile.js';

describe('form input and storage regressions', () => {
  let html;
  before(async () => {
    html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  });
  afterEach(() => {
    delete globalThis.localStorage;
  });

  function setup(t) {
    const dom = new JSDOM(html, { url: 'https://example.test' });
    t.after(() => dom.window.close());
    globalThis.localStorage = dom.window.localStorage;
    const form = dom.window.document.querySelector('#plan-form');
    form.elements.location.value = '  Delhi  ';
    return form;
  }

  const answers = {
    household: { adults: 0, children: 1, seniors: 2, conditions: ['asthma', 'pregnancy'] },
    commute: { mode: 'metro', oneWayKm: 2.5, daysPerWeek: 0 },
    home: { heating: 'heat_pump', cooking: 'induction', hasPurifier: true },
    budget: 'low',
    outdoorHours: 0.5,
    notes: 'Keep this <text> literal.',
  };

  test('quick start sends only the trimmed location and optional coordinates', (t) => {
    const form = setup(t);
    applyProfile(form, answers);
    form.elements.manualAqi.value = '400';
    assert.deepEqual(readProfile(form, { personalised: false, coordinates: null }), { location: 'Delhi' });
    const coordinates = { latitude: 0, longitude: 0 };
    assert.deepEqual(readProfile(form, { personalised: false, coordinates }), { location: 'Delhi', coordinates });
  });

  test('personalised answers round-trip numbers, selected conditions and the purifier', (t) => {
    const form = setup(t);
    applyProfile(form, answers);
    assert.deepEqual(readProfile(form, { personalised: true, coordinates: null }), { location: 'Delhi', ...answers });
  });

  test('manual AQI preserves zero and omits an empty reading', (t) => {
    const form = setup(t);
    form.elements.manualAqi.value = '0';
    assert.equal(readProfile(form, { personalised: true }).manualAqi, 0);
    form.elements.manualAqi.value = '';
    assert.equal(Object.hasOwn(readProfile(form, { personalised: true }), 'manualAqi'), false);
  });

  test('applying a partial profile preserves unspecified fields and clears stale checkboxes', (t) => {
    const form = setup(t);
    applyProfile(form, answers);
    applyProfile(form, { household: { adults: 3 }, notes: '' });
    assert.equal(form.elements.adults.value, '3');
    assert.equal(form.elements.distance.value, '2.5');
    assert.equal(form.elements.notes.value, '');
    assert.equal(form.elements.purifier.checked, false);
    assert.equal(form.querySelectorAll('input[name="conditions"]:checked').length, 0);
    assert.equal(form.elements.location.value, '  Delhi  ');
  });

  test('saving strips coordinates and one-off AQI without mutating the request', (t) => {
    setup(t);
    const profile = { location: 'Delhi', ...answers, coordinates: { latitude: 1, longitude: 2 }, manualAqi: 0 };
    const original = structuredClone(profile);
    saveProfile(profile, true);
    assert.deepEqual(loadProfile(), { personalised: true, profile: { location: 'Delhi', ...answers } });
    assert.deepEqual(profile, original);
    saveProfile({ location: 'Lahore' }, false);
    assert.deepEqual(loadProfile(), { personalised: false, profile: { location: 'Lahore' } });
  });

  test('missing or malformed saved JSON loads as null', (t) => {
    setup(t);
    assert.equal(loadProfile(), null);
    globalThis.localStorage.setItem('oxygenated-routine:v1', '{broken');
    assert.equal(loadProfile(), null);
  });

  test('forget removes saved answers while retaining unrelated storage', (t) => {
    setup(t);
    globalThis.localStorage.setItem('other-app', 'keep');
    saveProfile({ location: 'Delhi' }, true);
    clearProfile();
    assert.equal(loadProfile(), null);
    assert.equal(globalThis.localStorage.getItem('other-app'), 'keep');
  });

  test('storage failures never prevent using the form helpers', () => {
    globalThis.localStorage = {
      getItem() {
        throw new Error('Storage blocked');
      },
      setItem() {
        throw new Error('Storage full');
      },
      removeItem() {
        throw new Error('Storage blocked');
      },
    };
    assert.equal(loadProfile(), null);
    assert.doesNotThrow(() => saveProfile({ location: 'Delhi' }, true));
    assert.doesNotThrow(() => clearProfile());
  });
});

describe('form validation and browser storage compatibility', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  let dom;
  let form;
  let storageDescriptor;

  beforeEach(() => {
    dom = new JSDOM(html, { url: 'https://example.test' });
    form = dom.window.document.querySelector('#plan-form');
    storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
    form.elements.location.value = '  Delhi  ';
  });

  afterEach(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
    dom.window.close();
  });

  test('quick start sends only the trimmed location, ignoring untouched personalisation fields', () => {
    form.elements.manualAqi.value = '400';
    form.elements.notes.value = 'Not submitted yet';
    assert.deepEqual(readProfile(form, { coordinates: null, personalised: false }), { location: 'Delhi' });
  });

  test('coordinates accompany both quick and personalised requests', () => {
    const coordinates = { latitude: 28.65, longitude: 77.23 };
    for (const personalised of [false, true]) {
      assert.deepEqual(readProfile(form, { coordinates, personalised }).coordinates, coordinates);
    }
  });

  test('personalised requests read numeric fields, selected conditions and purifier state', () => {
    form.elements.adults.value = '1';
    form.elements.children.value = '2';
    form.elements.seniors.value = '1';
    form.elements.mode.value = 'bus';
    form.elements.distance.value = '3.5';
    form.elements.days.value = '0';
    form.elements.heating.value = 'wood';
    form.elements.cooking.value = 'induction';
    form.elements.purifier.checked = true;
    form.elements.budget.value = 'low';
    form.elements.outdoor.value = '0.5';
    form.elements.notes.value = 'School nearby';
    for (const value of ['asthma', 'pregnancy']) {
      form.querySelector(`input[name="conditions"][value="${value}"]`).checked = true;
    }
    const profile = readProfile(form, { coordinates: null, personalised: true });
    assert.deepEqual(profile, {
      location: 'Delhi',
      household: { adults: 1, children: 2, seniors: 1, conditions: ['asthma', 'pregnancy'] },
      commute: { mode: 'bus', oneWayKm: 3.5, daysPerWeek: 0 },
      home: { heating: 'wood', cooking: 'induction', hasPurifier: true },
      budget: 'low',
      outdoorHours: 0.5,
      notes: 'School nearby',
    });
    assert.deepEqual(parseProfile(profile), profile);
  });

  test('blank manual AQI is omitted, while zero and the maximum are preserved', () => {
    for (const value of ['', '0', '500']) {
      form.elements.manualAqi.value = value;
      const profile = readProfile(form, { coordinates: null, personalised: true });
      assert.equal(Object.hasOwn(profile, 'manualAqi'), value !== '');
      if (value !== '') assert.equal(profile.manualAqi, Number(value));
    }
  });

  test('applying a profile restores personalisation without overwriting location or manual AQI', () => {
    const profile = parseProfile({
      location: 'Lahore',
      manualAqi: 200,
      household: { adults: 3, children: 1, seniors: 2, conditions: ['asthma'] },
      commute: { mode: 'metro', oneWayKm: 7.5, daysPerWeek: 0 },
      home: { heating: 'heat_pump', cooking: 'electric', hasPurifier: true },
      budget: 'high',
      outdoorHours: 0,
      notes: 'Near the station',
    });
    applyProfile(form, profile);
    const { location: _location, manualAqi: _manualAqi, ...expected } = profile;
    assert.deepEqual(readProfile(form, { coordinates: null, personalised: true }), { location: 'Delhi', ...expected });
  });

  test('applying a sparse profile preserves unspecified fields and clears stale checkboxes', () => {
    form.elements.notes.value = 'Keep this';
    form.elements.purifier.checked = true;
    form.querySelector('input[name="conditions"]').checked = true;
    applyProfile(form, { outdoorHours: 0 });
    assert.equal(form.elements.notes.value, 'Keep this');
    assert.equal(form.elements.outdoor.value, '0');
    assert.equal(form.elements.purifier.checked, false);
    assert.equal(form.querySelectorAll('input[name="conditions"]:checked').length, 0);
  });

  test('saved answers round-trip without coordinates or a stale manual AQI, leaving the input intact', () => {
    const profile = parseProfile({ location: 'Delhi', coordinates: { latitude: 28, longitude: 77 }, manualAqi: 0 });
    const original = structuredClone(profile);
    saveProfile(profile, true);
    const { coordinates: _coordinates, manualAqi: _manualAqi, ...expected } = profile;
    assert.deepEqual(loadProfile(), { personalised: true, profile: expected });
    assert.deepEqual(profile, original);
  });

  test('saving replaces earlier answers and preserves the quick-start flag', () => {
    saveProfile({ location: 'Delhi', notes: 'old' }, true);
    saveProfile({ location: 'Lahore' }, false);
    assert.deepEqual(loadProfile(), { personalised: false, profile: { location: 'Lahore' } });
  });

  test('missing or corrupt stored answers return null', () => {
    assert.equal(loadProfile(), null);
    saveProfile({ location: 'Delhi' }, false);
    const key = localStorage.key(0);
    localStorage.setItem(key, '{invalid JSON');
    assert.equal(loadProfile(), null);
  });

  test('forgetting answers is idempotent and preserves unrelated browser storage', () => {
    localStorage.setItem('other-app', 'keep');
    saveProfile({ location: 'Delhi' }, true);
    clearProfile();
    clearProfile();
    assert.equal(loadProfile(), null);
    assert.equal(localStorage.getItem('other-app'), 'keep');
  });

  test('storage method failures do not prevent using the form', (t) => {
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      t.mock.method(dom.window.Storage.prototype, method, () => {
        throw new Error('Storage unavailable');
      });
    }
    assert.doesNotThrow(() => saveProfile({ location: 'Delhi' }, true));
    assert.equal(loadProfile(), null);
    assert.doesNotThrow(() => clearProfile());
  });

  test('storage access failures are guarded even when the localStorage getter throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('Storage blocked');
      },
    });
    assert.doesNotThrow(() => saveProfile({ location: 'Delhi' }, false));
    assert.equal(loadProfile(), null);
    assert.doesNotThrow(() => clearProfile());
  });
});
