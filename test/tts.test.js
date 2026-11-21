import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { buildResponse } from './helpers.js';
import {
  buildPlanSpeechText,
  createSpeechController,
  isSpeechSupported,
  stopCurrentSpeech,
  ttsControls,
} from '../public/tts.js';

describe('Text-to-Speech (TTS) module', () => {
  let dom;
  let mockSynthesis;
  let mockUtteranceConstructor;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>');
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;

    // Mock Web Speech API
    mockSynthesis = {
      speaking: false,
      paused: false,
      speak: (utterance) => {
        mockSynthesis.speaking = true;
        mockSynthesis.paused = false;
        setTimeout(() => {
          if (utterance.onstart) utterance.onstart();
        }, 0);
      },
      pause: () => {
        mockSynthesis.speaking = false;
        mockSynthesis.paused = true;
      },
      resume: () => {
        mockSynthesis.speaking = true;
        mockSynthesis.paused = false;
      },
      cancel: () => {
        mockSynthesis.speaking = false;
        mockSynthesis.paused = false;
      },
      getVoices: () => [{ lang: 'en-US', name: 'English Natural', localService: false }],
    };

    mockUtteranceConstructor = class MockUtterance {
      constructor(text) {
        this.text = text;
        this.voice = null;
        this.rate = 1;
        this.pitch = 1;
        this.onstart = null;
        this.onpause = null;
        this.onresume = null;
        this.onend = null;
        this.onerror = null;
      }
    };

    globalThis.window.speechSynthesis = mockSynthesis;
    globalThis.window.SpeechSynthesisUtterance = mockUtteranceConstructor;
  });

  it('detects browser Web Speech API availability', () => {
    assert.equal(isSpeechSupported(), true);

    delete globalThis.window.speechSynthesis;
    assert.equal(isSpeechSupported(), false);
  });

  it('builds a natural, plain-language spoken script summarizing the plan', async () => {
    const data = await buildResponse();
    const text = buildPlanSpeechText(data);

    assert.ok(text.includes('Delhi'));
    assert.ok(text.includes('Air Quality Index is 170'));
    assert.ok(text.includes('Unhealthy'));
    assert.ok(text.includes('Do these three things first'));
    assert.ok(text.includes('Number 1:'));
    assert.ok(text.includes('Number 2:'));
    assert.ok(text.includes('Number 3:'));
    assert.ok(text.includes('cleanest time to be outdoors is'));
    assert.ok(text.includes('cigarettes'));
  });

  it('handles empty or incomplete plan data gracefully', () => {
    assert.equal(buildPlanSpeechText(null), '');
    assert.equal(buildPlanSpeechText({}), '');
    assert.equal(buildPlanSpeechText({ plan: {} }), 'Oxygenated Routine air quality plan for your area.');
  });

  it('manages speech controller state transitions (play, pause, resume, stop)', async () => {
    const stateHistory = [];
    const controller = createSpeechController({
      onStateChange: (state) => stateHistory.push(state),
    });

    assert.equal(controller.getState(), 'idle');

    controller.speak('Test speech content');
    assert.equal(controller.getState(), 'speaking');

    controller.pause();
    assert.equal(controller.getState(), 'paused');

    controller.resume();
    assert.equal(controller.getState(), 'speaking');

    controller.stop();
    assert.equal(controller.getState(), 'idle');

    assert.deepEqual(stateHistory, ['idle', 'speaking', 'paused', 'speaking', 'idle']);
  });

  it('handles empty speech gracefully without speaking', () => {
    let called = false;
    mockSynthesis.speak = () => {
      called = true;
    };

    const controller = createSpeechController();
    controller.speak('');
    controller.speak('   ');
    assert.equal(called, false);
    assert.equal(controller.getState(), 'idle');
  });

  it('renders accessible TTS controls with proper ARIA attributes', async () => {
    const data = await buildResponse();
    const component = ttsControls(data);

    assert.equal(component.getAttribute('role'), 'region');
    assert.equal(component.getAttribute('aria-label'), 'Audio narration of your plan');

    const toggleBtn = component.querySelector('.tts-btn-toggle');
    const stopBtn = component.querySelector('.tts-btn-stop');
    const statusMsg = component.querySelector('.tts-status');

    assert.ok(toggleBtn);
    assert.ok(stopBtn);
    assert.ok(statusMsg);

    assert.equal(toggleBtn.getAttribute('type'), 'button');
    assert.equal(toggleBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(stopBtn.getAttribute('type'), 'button');
    assert.equal(stopBtn.hidden, true);
    assert.equal(statusMsg.getAttribute('role'), 'status');
    assert.equal(statusMsg.getAttribute('aria-live'), 'polite');
  });

  it('updates buttons and status when playing, pausing and stopping', async () => {
    const data = await buildResponse();
    const component = ttsControls(data);

    const toggleBtn = component.querySelector('.tts-btn-toggle');
    const stopBtn = component.querySelector('.tts-btn-stop');
    const statusMsg = component.querySelector('.tts-status');

    // Click to listen
    toggleBtn.click();
    assert.equal(toggleBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(toggleBtn.querySelector('.tts-label').textContent, 'Pause');
    assert.equal(stopBtn.hidden, false);
    assert.equal(statusMsg.textContent, 'Reading plan aloud…');

    // Click to pause
    toggleBtn.click();
    assert.equal(toggleBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(toggleBtn.querySelector('.tts-label').textContent, 'Resume');
    assert.equal(statusMsg.textContent, 'Audio paused.');

    // Click to resume
    toggleBtn.click();
    assert.equal(toggleBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(toggleBtn.querySelector('.tts-label').textContent, 'Pause');

    // Click stop
    stopBtn.click();
    assert.equal(toggleBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(toggleBtn.querySelector('.tts-label').textContent, 'Listen to plan');
    assert.equal(stopBtn.hidden, true);
    assert.equal(statusMsg.textContent, '');
  });

  it('stopCurrentSpeech cancels any active utterance', () => {
    let canceled = false;
    mockSynthesis.cancel = () => {
      canceled = true;
    };

    const controller = createSpeechController();
    controller.speak('Some audio plan');
    stopCurrentSpeech();

    assert.equal(canceled, true);
    assert.equal(controller.getState(), 'idle');
  });
});
