/**
 * Browser-based Text-to-Speech (TTS) for the plan summary.
 * Uses the Web Speech API (window.speechSynthesis) with zero external dependencies.
 */
import { el } from './dom.js';

/**
 * Feature detection for the browser's Web Speech API.
 * @returns {boolean}
 */
export function isSpeechSupported() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  );
}

function speechLocation(data) {
  const name = data.location?.name
    ? [data.location.name, data.location.country].filter(Boolean).join(', ')
    : 'your area';
  return `Oxygenated Routine air quality plan for ${name}.`;
}

function speechAqi(air) {
  if (!air || air.aqi === undefined || !air.category?.label) return null;
  const meaning = air.category.meaning ? ` ${air.category.meaning}` : '';
  return `Air Quality Index is ${air.aqi}, categorized as ${air.category.label}.${meaning}`;
}

function speechActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const list = actions.map((action, index) => `Number ${index + 1}: ${action}`).join(' ');
  return `Do these three things first. ${list}`;
}

function speechWindow(window) {
  if (!window) return null;
  const dayPrefix = window.day === 'tomorrow' ? 'tomorrow, ' : '';
  return `The cleanest time to be outdoors is ${dayPrefix}${window.start} to ${window.end}, with forecast AQI around ${window.avgAqi}.`;
}

function speechExposure(exposure) {
  if (
    !exposure ||
    exposure.todayCurrentHabitsCigarettes === undefined ||
    exposure.todayWithPlanCigarettes === undefined
  ) {
    return null;
  }
  const reductionText = exposure.reductionPercent !== undefined ? `, a ${exposure.reductionPercent}% reduction` : '';
  return `Estimated exposure on current habits is roughly like smoking ${exposure.todayCurrentHabitsCigarettes} cigarettes. Following this plan brings that down to about ${exposure.todayWithPlanCigarettes} cigarettes${reductionText}.`;
}

/**
 * Builds a natural, plain-language spoken script summarizing the user's plan.
 * @param {object} data The API plan response
 * @returns {string} The text to be read aloud
 */
export function buildPlanSpeechText(data) {
  if (!data || !data.plan) return '';
  return [
    speechLocation(data),
    data.plan.headline,
    speechAqi(data.air),
    speechActions(data.plan.top_actions),
    speechWindow(data.window),
    speechExposure(data.impact?.exposure),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Holds the current global speech controller instance so any new request can cleanly cancel active audio.
 */
let globalController = null;

export function stopCurrentSpeech() {
  if (globalController) {
    globalController.stop();
  }
}

/**
 * Creates an accessible speech synthesizer controller.
 * @param {{ onStateChange?: (state: string) => void, onError?: (err: Error) => void }} [options]
 */
export function createSpeechController({ onStateChange, onError } = {}) {
  let state = 'idle'; // 'idle' | 'speaking' | 'paused'
  let currentUtterance = null;

  function updateState(next) {
    state = next;
    if (typeof onStateChange === 'function') onStateChange(state);
  }

  function stop() {
    if (isSpeechSupported()) {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }
    currentUtterance = null;
    updateState('idle');
  }

  function pause() {
    if (!isSpeechSupported() || state !== 'speaking') return;
    window.speechSynthesis.pause();
    updateState('paused');
  }

  function resume() {
    if (!isSpeechSupported() || state !== 'paused') return;
    window.speechSynthesis.resume();
    updateState('speaking');
  }

  function speak(text) {
    if (!isSpeechSupported()) {
      if (typeof onError === 'function') onError(new Error('Speech synthesis is not supported in this browser.'));
      return;
    }

    stop();
    const cleanText = String(text ?? '').trim();
    if (!cleanText) return;

    const utterance = new window.SpeechSynthesisUtterance(cleanText);
    currentUtterance = utterance;

    // Prefer an on-device local English voice for privacy and offline speed
    try {
      const voices = window.speechSynthesis.getVoices?.() || [];
      const englishVoice =
        voices.find((v) => v.lang?.startsWith('en') && v.localService) ||
        voices.find((v) => v.lang?.startsWith('en')) ||
        null;
      if (englishVoice) utterance.voice = englishVoice;
    } catch {
      // Ignore voice selection failures and let the browser default handle it
    }

    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      if (currentUtterance === utterance) updateState('speaking');
    };

    utterance.onpause = () => {
      if (currentUtterance === utterance) updateState('paused');
    };

    utterance.onresume = () => {
      if (currentUtterance === utterance) updateState('speaking');
    };

    utterance.onend = () => {
      if (currentUtterance === utterance) {
        currentUtterance = null;
        updateState('idle');
      }
    };

    utterance.onerror = (event) => {
      if (currentUtterance === utterance) {
        currentUtterance = null;
        updateState('idle');
        if (event.error && event.error !== 'canceled' && event.error !== 'interrupted') {
          if (typeof onError === 'function') onError(new Error(`Speech error: ${event.error}`));
        }
      }
    };

    window.speechSynthesis.speak(utterance);
    updateState('speaking');
  }

  const controller = {
    speak,
    pause,
    resume,
    stop,
    getState: () => state,
  };

  globalController = controller;
  return controller;
}

/**
 * Builds the accessible TTS player component DOM element.
 * @param {object} data The API plan response
 * @returns {HTMLElement}
 */
export function ttsControls(data) {
  if (!isSpeechSupported()) {
    return el('div', { className: 'tts-unsupported hint' }, document.createTextNode(''));
  }

  const speechText = buildPlanSpeechText(data);

  const toggleBtn = el(
    'button',
    {
      className: 'button secondary tts-btn tts-btn-toggle',
      attrs: {
        type: 'button',
        'aria-label': 'Listen to plan summary',
        'aria-pressed': 'false',
      },
    },
    el('span', { className: 'tts-icon', attrs: { 'aria-hidden': 'true' }, text: '🔊' }),
    el('span', { className: 'tts-label', text: 'Listen to plan' }),
  );

  const stopBtn = el(
    'button',
    {
      className: 'button secondary tts-btn tts-btn-stop',
      attrs: {
        type: 'button',
        'aria-label': 'Stop reading plan aloud',
      },
    },
    el('span', { className: 'tts-icon', attrs: { 'aria-hidden': 'true' }, text: '⏹' }),
    el('span', { className: 'tts-label', text: 'Stop' }),
  );
  stopBtn.hidden = true;

  const statusMsg = el('span', {
    className: 'tts-status hint',
    attrs: {
      role: 'status',
      'aria-live': 'polite',
    },
  });

  const controller = createSpeechController({
    onStateChange: (state) => {
      if (state === 'speaking') {
        toggleBtn.setAttribute('aria-pressed', 'true');
        toggleBtn.querySelector('.tts-label').textContent = 'Pause';
        toggleBtn.querySelector('.tts-icon').textContent = '⏸';
        toggleBtn.setAttribute('aria-label', 'Pause audio readout');
        stopBtn.hidden = false;
        statusMsg.textContent = 'Reading plan aloud…';
      } else if (state === 'paused') {
        toggleBtn.setAttribute('aria-pressed', 'false');
        toggleBtn.querySelector('.tts-label').textContent = 'Resume';
        toggleBtn.querySelector('.tts-icon').textContent = '▶';
        toggleBtn.setAttribute('aria-label', 'Resume audio readout');
        stopBtn.hidden = false;
        statusMsg.textContent = 'Audio paused.';
      } else {
        toggleBtn.setAttribute('aria-pressed', 'false');
        toggleBtn.querySelector('.tts-label').textContent = 'Listen to plan';
        toggleBtn.querySelector('.tts-icon').textContent = '🔊';
        toggleBtn.setAttribute('aria-label', 'Listen to plan summary');
        stopBtn.hidden = true;
        statusMsg.textContent = '';
      }
    },
    onError: (err) => {
      statusMsg.textContent = err.message || 'Speech failed.';
    },
  });

  toggleBtn.addEventListener('click', () => {
    const current = controller.getState();
    if (current === 'idle') {
      controller.speak(speechText);
    } else if (current === 'speaking') {
      controller.pause();
    } else if (current === 'paused') {
      controller.resume();
    }
  });

  stopBtn.addEventListener('click', () => {
    controller.stop();
  });

  return el(
    'div',
    {
      className: 'tts-player',
      attrs: {
        role: 'region',
        'aria-label': 'Audio narration of your plan',
      },
    },
    toggleBtn,
    stopBtn,
    statusMsg,
  );
}
