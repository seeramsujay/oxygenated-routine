/**
 * @fileoverview Main client-side application controller.
 *
 * Orchestrates user interactions:
 * - Live city autocomplete / disambiguation via `/api/geocode` with request cancellation.
 * - Geolocation quick-start ("Use my location").
 * - Optional progressive disclosure of household personalization fields.
 * - Form submission, busy state management with `aria-busy` and button updates.
 * - Network plan generation requests with AbortSignal timeout protection & retry/offline recovery.
 * - Result rendering, local state persistence, and error notification.
 */
import {
  applyProfile,
  clearLastPlan,
  clearProfile,
  loadLastPlan,
  loadProfile,
  readProfile,
  saveLastPlan,
  saveProfile,
} from './form.js';
import { renderResults } from './render.js';
import { stopCurrentSpeech } from './tts.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#plan-form');
const details = $('#personalise');
const locationInput = $('#location');
const suggestionsList = $('#location-suggestions');

/** `generation` changes when the user clicks Forget, so a request still in flight will not save the old answers. */
const state = { coordinates: null, personalised: false, generation: 0 };

let geocodeTimer = null;
let geocodeController = null;
let geocodeSeq = 0;
let activeSuggestionIndex = -1;

const actionButtons = () => [$('#submit'), $('#submit-bottom'), $('#locate'), ...document.querySelectorAll('.chip')];

/** Disable every way of starting a request, and show progress on the submit buttons themselves. */
function setBusy(busy, message = '') {
  if (busy) stopCurrentSpeech();
  for (const button of actionButtons()) {
    button.disabled = busy;
    if (!button.dataset.busyText) continue;
    if (busy) {
      // setBusy(true) can run twice (location, then submit); keep the original label, not the busy one.
      if (button.textContent.trim() !== button.dataset.busyText) button.dataset.idleText = button.textContent.trim();
      button.textContent = button.dataset.busyText;
    } else if (button.dataset.idleText) {
      button.textContent = button.dataset.idleText;
    }
  }
  form.setAttribute('aria-busy', String(busy));
  $('#status').textContent = message;
}

/** Opens the personalisation panel and focuses the manual AQI field for offline recovery. */
function openManualAqi() {
  details.open = true;
  const manual = $('#manual-aqi');
  manual.scrollIntoView({ block: 'center' });
  manual.focus();
}

function showError(error, { allowRecovery = false } = {}) {
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
  if (allowRecovery) {
    const recovery = document.createElement('div');
    recovery.className = 'error-actions';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'button secondary';
    retryBtn.textContent = 'Try again';
    retryBtn.addEventListener('click', () => submitPlan());
    const manualBtn = document.createElement('button');
    manualBtn.type = 'button';
    manualBtn.className = 'button secondary';
    manualBtn.textContent = 'Enter AQI manually';
    manualBtn.addEventListener('click', openManualAqi);
    recovery.append(retryBtn, manualBtn);
    box.append(recovery);
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
    throw Object.assign(new Error(message), { details: body.error?.details, status: response.status });
  }
  return body;
}

function friendlyError(error) {
  if (error.name === 'TimeoutError') return new Error('That took too long. Please try again or enter AQI manually.');
  if (error instanceof TypeError)
    return new Error('We could not reach the server. Check your connection or enter AQI manually.');
  return error;
}

function openPersonalise() {
  details.open = true;
  const prefersReduced =
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  details.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
  $('#adults').focus();
}

function hideSuggestions() {
  clearTimeout(geocodeTimer);
  geocodeSeq += 1;
  if (geocodeController) {
    geocodeController.abort();
    geocodeController = null;
  }
  if (!suggestionsList) return;
  suggestionsList.hidden = true;
  suggestionsList.replaceChildren();
  locationInput.setAttribute('aria-expanded', 'false');
  locationInput.removeAttribute('aria-activedescendant');
  activeSuggestionIndex = -1;
}

function selectSuggestion(place) {
  const label = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
  locationInput.value = label;
  state.coordinates = { latitude: place.latitude, longitude: place.longitude };
  hideSuggestions();
}

function renderSuggestions(results) {
  if (!suggestionsList) return;
  suggestionsList.replaceChildren();
  activeSuggestionIndex = -1;
  if (!Array.isArray(results) || results.length === 0) {
    hideSuggestions();
    return;
  }
  results.forEach((place, index) => {
    const li = document.createElement('li');
    li.id = `location-suggestion-${index}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.tabIndex = -1;
    const primary = document.createElement('strong');
    primary.textContent = place.name;
    const secondary = document.createElement('span');
    secondary.className = 'hint';
    secondary.textContent = [place.admin1, place.country].filter(Boolean).join(', ');
    li.append(primary, document.createTextNode(' '), secondary);
    li.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectSuggestion(place);
    });
    suggestionsList.append(li);
  });
  suggestionsList.hidden = false;
  locationInput.setAttribute('aria-expanded', 'true');
}

async function fetchSuggestions(query) {
  const seq = ++geocodeSeq;
  if (geocodeController) geocodeController.abort();
  geocodeController = new AbortController();
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
      signal: geocodeController.signal,
    });
    if (seq !== geocodeSeq) return;
    if (!res.ok) return hideSuggestions();
    const data = await res.json();
    if (seq !== geocodeSeq) return;
    renderSuggestions(data.results);
  } catch {
    if (seq === geocodeSeq) hideSuggestions();
  }
}

async function submitPlan() {
  hideSuggestions();
  $('#form-errors').hidden = true;
  if (locationInput.value.trim().length < 2) {
    showError(new Error('Please type your city or town, or tap “Use my location”.'));
    locationInput.focus();
    return;
  }
  setBusy(true, 'Checking the air where you are and building your plan…');
  const { generation } = state;
  try {
    const profile = readProfile(form, state);
    const data = await requestPlan(profile);
    if (generation !== state.generation) return;
    renderResults($('#results'), data, openPersonalise);
    saveProfile(profile, state.personalised);
    saveLastPlan(data);
    setBusy(false, 'Your plan is ready.');
    $('#submit').textContent = 'Update my plan';
  } catch (error) {
    if (generation !== state.generation) return;
    setBusy(false);
    const isNetworkOrUpstream = error.name === 'TimeoutError' || error instanceof TypeError || error.status >= 500;
    showError(friendlyError(error), { allowRecovery: isNetworkOrUpstream });
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
    locationInput.value = 'My location';
    await submitPlan();
  } catch {
    setBusy(false);
    showError(new Error('We could not get your location. Please type your city or town instead.'));
    locationInput.focus();
  }
}

/** Restores the most recent cached plan without stealing keyboard focus on initial load. */
function restoreLastPlan() {
  const cached = loadLastPlan();
  if (!cached?.data?.plan || !cached?.data?.air) return;
  renderResults($('#results'), cached.data, openPersonalise, { focus: false });
  const mins = Math.max(1, Math.round((Date.now() - cached.savedAt) / 60_000));
  const age = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  $('#status').textContent = `Showing your last saved plan (${age} ago). Click “Update my plan” for live air.`;
  $('#submit').textContent = 'Update my plan';
}

function restoreSavedAnswers() {
  const saved = loadProfile();
  if (saved?.profile) {
    locationInput.value = saved.profile.location === 'My location' ? '' : (saved.profile.location ?? '');
    if (saved.personalised) {
      applyProfile(form, saved.profile);
      state.personalised = true;
      details.open = true;
    }
  }
  restoreLastPlan();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitPlan();
});
$('#locate').addEventListener('click', useMyLocation);
$('#examples').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  locationInput.value = chip.dataset.city;
  state.coordinates = null;
  submitPlan();
});

locationInput.addEventListener('input', () => {
  state.coordinates = null;
  clearTimeout(geocodeTimer);
  const query = locationInput.value.trim();
  if (query.length < 2) {
    hideSuggestions();
    return;
  }
  geocodeTimer = setTimeout(() => fetchSuggestions(query), 250);
});

locationInput.addEventListener('keydown', (event) => {
  if (!suggestionsList || suggestionsList.hidden) return;
  const items = [...suggestionsList.querySelectorAll('li')];
  if (items.length === 0) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
  } else if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
    event.preventDefault();
    items[activeSuggestionIndex].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return;
  } else if (event.key === 'Escape') {
    hideSuggestions();
    return;
  } else {
    return;
  }
  items.forEach((li, i) => li.setAttribute('aria-selected', String(i === activeSuggestionIndex)));
  if (activeSuggestionIndex >= 0 && items[activeSuggestionIndex]?.id) {
    locationInput.setAttribute('aria-activedescendant', items[activeSuggestionIndex].id);
  } else {
    locationInput.removeAttribute('aria-activedescendant');
  }
});

locationInput.addEventListener('blur', () => {
  setTimeout(hideSuggestions, 150);
});

for (const type of ['input', 'change']) {
  details.addEventListener(type, () => {
    state.personalised = true;
  });
}

$('#forget').addEventListener('click', () => {
  stopCurrentSpeech();
  state.generation += 1;
  clearProfile();
  clearLastPlan();
  form.reset();
  state.personalised = false;
  state.coordinates = null;
  $('#results').hidden = true;
  $('#results').replaceChildren();
  $('#submit').textContent = 'Get my plan';
  $('#status').textContent = 'Saved answers cleared from this device.';
});

restoreSavedAnswers();
