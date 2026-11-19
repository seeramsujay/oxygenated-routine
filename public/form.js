/** Reads the form into an API request and remembers answers in this browser only (never on a server). */

const STORAGE_KEY = 'oxygenated-routine:v1';

/**
 * @param {HTMLFormElement} form
 * @param {{coordinates: ?{latitude:number, longitude:number}, personalised: boolean}} options
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
  manualAqi: ['manualAqi'],
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

/** Storage can throw (private mode, blocked cookies), so every access is guarded. */
export function saveProfile(profile, personalised) {
  try {
    const { coordinates: _coordinates, ...rest } = profile;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ personalised, profile: rest }));
  } catch {
    /* remembering answers is a convenience only */
  }
}

export function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function clearProfile() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}
