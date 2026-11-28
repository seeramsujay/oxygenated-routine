/**
 * @fileoverview Form state management and local storage persistence.
 *
 * Extracts form field values into API request payloads and saves non-sensitive answers
 * exclusively in local browser storage (`localStorage`). Private browsing mode exceptions
 * or blocked cookie storage access are safely handled without throwing uncaught exceptions.
 */

const STORAGE_KEY = 'oxygenated-routine:v1';

/**
 * Extracts normalized profile object from the plan form controls.
 *
 * @param {HTMLFormElement} form - Form element containing input controls.
 * @param {{
 *   coordinates: {latitude: number, longitude: number}|null,
 *   personalised: boolean
 * }} options - Location coordinates and personalisation toggle.
 * @returns {object} Profile object ready for API submission.
 */
export function readProfile(form, { coordinates, personalised }) {
  const field = form.elements;
  const profile = { location: field.location.value.trim() };
  if (coordinates) profile.coordinates = coordinates;
  if (!personalised) return profile;

  const num = (name) => Number(field[name].value);
  const manual = field.manualAqi.value.trim();
  Object.assign(profile, {
    household: {
      adults: num('adults'),
      children: num('children'),
      seniors: num('seniors'),
      conditions: [...form.querySelectorAll('input[name="conditions"]:checked')].map((box) => box.value),
    },
    commute: { mode: field.mode.value, oneWayKm: num('distance'), daysPerWeek: num('days') },
    home: { heating: field.heating.value, cooking: field.cooking.value, hasPurifier: field.purifier.checked },
    budget: field.budget.value,
    outdoorHours: num('outdoor'),
    notes: field.notes.value,
  });
  if (manual !== '') profile.manualAqi = Number(manual);
  return profile;
}

/** Form field name -> path in the saved profile. */
const FIELD_PATHS = {
  adults: ['household', 'adults'],
  children: ['household', 'children'],
  seniors: ['household', 'seniors'],
  mode: ['commute', 'mode'],
  distance: ['commute', 'oneWayKm'],
  days: ['commute', 'daysPerWeek'],
  heating: ['home', 'heating'],
  cooking: ['home', 'cooking'],
  budget: ['budget'],
  outdoor: ['outdoorHours'],
  notes: ['notes'],
};

const pick = (object, path) => path.reduce((value, key) => value?.[key], object);

/** Fill the personalise section from a saved profile. */
export function applyProfile(form, profile) {
  for (const [name, path] of Object.entries(FIELD_PATHS)) {
    const value = pick(profile, path);
    if (value !== undefined) form.elements[name].value = value;
  }
  for (const box of form.querySelectorAll('input[name="conditions"]')) {
    box.checked = profile.household?.conditions?.includes(box.value) ?? false;
  }
  form.elements.purifier.checked = profile.home?.hasPurifier ?? false;
}

const LAST_PLAN_KEY = 'oxygenatedRoutine.lastPlan.v1';

/** Safely reads and parses JSON from `localStorage` (returns `null` when unavailable or corrupt). */
function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** Safely serializes a value into `localStorage` (ignores private-mode or quota errors). */
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* remembering answers is a convenience only */
  }
}

/** Safely removes a key from `localStorage`. */
function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

/** Storage can throw (private mode, blocked cookies), so every access is guarded. */
export function saveProfile(profile, personalised) {
  // A manual AQI is a one-off reading; restoring it later would hide the live air quality.
  const { coordinates: _coordinates, manualAqi: _manualAqi, ...rest } = profile;
  writeStorage(STORAGE_KEY, { personalised, profile: rest });
}

/** Loads the saved household profile and personalisation flag from `localStorage`. */
export const loadProfile = () => readStorage(STORAGE_KEY);

/** Clears saved household answers from `localStorage`. */
export const clearProfile = () => removeStorage(STORAGE_KEY);

/** Caches the most recent plan response for instant offline restoration on reload. */
export const saveLastPlan = (data) => writeStorage(LAST_PLAN_KEY, { savedAt: Date.now(), data });

/** Loads the last cached plan response from `localStorage`, if present. */
export const loadLastPlan = () => readStorage(LAST_PLAN_KEY);

/** Clears the cached plan response from `localStorage`. */
export const clearLastPlan = () => removeStorage(LAST_PLAN_KEY);
