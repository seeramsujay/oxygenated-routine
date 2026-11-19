/** Wires the form to the API: one-step quick start, optional personalising, safe rendering. */
import { applyProfile, clearProfile, loadProfile, readProfile, saveProfile } from './form.js';
import { renderResults } from './render.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#plan-form');
const details = $('#personalise');
const state = { coordinates: null, personalised: false };

function setBusy(busy, message = '') {
  for (const button of [$('#submit'), $('#locate')]) button.disabled = busy;
  $('#status').textContent = message;
}

function showError(error) {
  const box = $('#form-errors');
  box.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = error.message;
  box.append(heading);
  if (Array.isArray(error.details) && error.details.length > 0) {
    const items = document.createElement('ul');
    for (const { field, message } of error.details) {
      const item = document.createElement('li');
      item.textContent = `${field}: ${message}`;
      items.append(item);
    }
    box.append(items);
  }
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

async function requestPlan(profile) {
  const response = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error?.message ?? 'Something went wrong. Please try again.';
    throw Object.assign(new Error(message), { details: body.error?.details });
  }
  return body;
}

function friendlyError(error) {
  if (error.name === 'TimeoutError') return new Error('That took too long. Please try again.');
  if (error instanceof TypeError)
    return new Error('We could not reach the server. Check your connection and try again.');
  return error;
}

function openPersonalise() {
  details.open = true;
  details.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#adults').focus();
}

async function submitPlan() {
  $('#form-errors').hidden = true;
  if ($('#location').value.trim().length < 2) {
    showError(new Error('Please type your city or town, or tap “Use my location”.'));
    $('#location').focus();
    return;
  }
  setBusy(true, 'Checking the air where you are and building your plan…');
  try {
    const profile = readProfile(form, state);
    renderResults($('#results'), await requestPlan(profile), openPersonalise);
    saveProfile(profile, state.personalised);
    setBusy(false, 'Your plan is ready.');
  } catch (error) {
    setBusy(false);
    showError(friendlyError(error));
  }
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    return navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        // ~1 km precision is plenty for air quality and avoids sending an exact home position.
        resolve({
          latitude: Math.round(coords.latitude * 100) / 100,
          longitude: Math.round(coords.longitude * 100) / 100,
        }),
      reject,
      { timeout: 10_000, maximumAge: 600_000 },
    );
  });
}

async function useMyLocation() {
  setBusy(true, 'Finding your location…');
  try {
    state.coordinates = await currentPosition();
    $('#location').value = 'My location';
    await submitPlan();
  } catch {
    setBusy(false);
    showError(new Error('We could not get your location. Please type your city or town instead.'));
    $('#location').focus();
  }
}

function restoreSavedAnswers() {
  const saved = loadProfile();
  if (!saved?.profile) return;
  $('#location').value = saved.profile.location === 'My location' ? '' : (saved.profile.location ?? '');
  if (saved.personalised) {
    applyProfile(form, saved.profile);
    state.personalised = true;
    details.open = true;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitPlan();
});
$('#locate').addEventListener('click', useMyLocation);
$('#location').addEventListener('input', () => {
  state.coordinates = null;
});
for (const type of ['input', 'change']) {
  details.addEventListener(type, () => {
    state.personalised = true;
  });
}
$('#forget').addEventListener('click', () => {
  clearProfile();
  form.reset();
  state.personalised = false;
  state.coordinates = null;
  $('#status').textContent = 'Saved answers cleared from this device.';
});

restoreSavedAnswers();
