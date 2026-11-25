/**
 * @fileoverview Accessible follow-up chat UI component for the results page.
 *
 * Allows users to continue chatting with Gemini 3.8 Flash (with automatic rule-engine fallback)
 * about their specific air-quality plan. All messages are rendered via `textContent`.
 */
import { card, el } from './dom.js';

const QUICK_QUESTIONS = ['Can kids go out later today?', 'How do I seal my windows best?', 'Which mask should I wear?'];

function buildContext(data) {
  const { location = {}, air = {}, guidance, sensitive, locationContext = {}, window: win = null, plan = {} } = data;
  const place = [location.name, location.country].filter(Boolean).join(', ') || 'your area';
  return {
    place,
    aqi: air.aqi,
    category: air.category?.label,
    guidance,
    sensitive: Boolean(sensitive),
    respirator: locationContext.region?.respirator ?? 'N95 or FFP2',
    window: win,
    topActions: (plan.top_actions ?? []).slice(0, 3),
  };
}

function appendMessage(log, role, text) {
  const bubble = el(
    'div',
    { className: `chat-msg chat-${role}` },
    el('span', { className: 'chat-role', text: role === 'user' ? 'You' : 'Assistant' }),
    el('p', { className: 'chat-text', text }),
  );
  log.append(bubble);
  log.scrollTop = log.scrollHeight;
}

/**
 * Renders the follow-up chat card at the bottom of the results.
 *
 * @param {object} data Complete plan API response
 * @returns {HTMLElement}
 */
export function chatCard(data) {
  const history = [];
  const context = buildContext(data);

  const log = el('div', {
    className: 'chat-log',
    attrs: { role: 'log', 'aria-live': 'polite', 'aria-label': 'Follow-up conversation' },
  });

  const input = el('input', {
    attrs: {
      id: 'chat-input',
      type: 'text',
      maxlength: '400',
      placeholder: 'Ask anything about today’s air or your plan…',
      autocomplete: 'off',
    },
  });

  const sendBtn = el('button', {
    className: 'button',
    text: 'Send',
    attrs: { type: 'button' },
  });

  const status = el('p', { className: 'hint chat-status', attrs: { 'aria-live': 'polite' } });

  const sendMessage = async (rawText) => {
    const message = String(rawText ?? input.value).trim();
    if (!message || sendBtn.disabled) return;
    input.value = '';
    appendMessage(log, 'user', message);
    sendBtn.disabled = true;
    input.disabled = true;
    status.textContent = 'Thinking…';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: history.slice(-10), context }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json().catch(() => ({}));
      const reply = res.ok && body.reply ? body.reply : (body.error?.message ?? 'Could not get a reply right now.');
      appendMessage(log, 'assistant', reply);
      if (res.ok && body.reply) {
        history.push({ role: 'user', text: message }, { role: 'assistant', text: reply });
      }
      status.textContent = '';
    } catch {
      appendMessage(log, 'assistant', 'Network error while reaching the assistant. Please try again.');
      status.textContent = '';
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  };

  const quickChips = el(
    'div',
    { className: 'chat-suggestions' },
    ...QUICK_QUESTIONS.map((q) => {
      const chip = el('button', { className: 'chip', text: q, attrs: { type: 'button' } });
      chip.addEventListener('click', () => sendMessage(q));
      return chip;
    }),
  );

  const form = el(
    'form',
    { className: 'chat-form' },
    el('label', { className: 'sr-only', text: 'Ask a follow-up question', attrs: { for: 'chat-input' } }),
    input,
    sendBtn,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage();
  });
  sendBtn.addEventListener('click', () => sendMessage());

  return card(
    'chat',
    'Ask a follow-up question',
    el('p', {
      className: 'hint',
      text: 'Continue chatting with Gemini 3.8 Flash about your home, timing, or symptoms.',
    }),
    quickChips,
    log,
    form,
    status,
  );
}
