import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleChat } from '../src/chat.js';

test('handleChat validates empty or oversized messages', async () => {
  await assert.rejects(handleChat({ message: '   ' }), { status: 400 });
  await assert.rejects(handleChat({ message: 'x'.repeat(401) }), { status: 400 });
});

test('handleChat falls back to safe deterministic guidance when LLM is disabled', async () => {
  const res = await handleChat(
    {
      message: 'Can kids go out to play?',
      context: { place: 'Delhi, India', aqi: 240, guidance: 'avoid', respirator: 'N95 or KN95' },
    },
    { llmEnabled: false },
  );
  assert.equal(res.source, 'rules');
  assert.match(res.reply, /indoors/i);
});

test('handleChat uses Gemini when enabled and rejects unsafe Gemini replies', async () => {
  const okFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'Keep windows shut and run a HEPA purifier indoors.' }] } }],
    }),
  });
  const okRes = await handleChat(
    { message: 'Should I open windows?', context: { place: 'Delhi', aqi: 220, guidance: 'avoid' } },
    { fetchImpl: okFetch, llmEnabled: true, apiKey: 'test-key' },
  );
  assert.equal(okRes.source, 'gemini');
  assert.match(okRes.reply, /HEPA purifier/);

  const unsafeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'Go for a long cycle ride outside today.' }] } }],
    }),
  });
  const safeRes = await handleChat(
    { message: 'Can I commute?', context: { place: 'Delhi', aqi: 300, guidance: 'avoid' } },
    { fetchImpl: unsafeFetch, llmEnabled: true, apiKey: 'test-key' },
  );
  assert.equal(safeRes.source, 'rules');
  assert.ok(!/cycle ride/i.test(safeRes.reply));
});

test('handleChat applies nested context defaults when context is omitted', async () => {
  const res = await handleChat({ message: 'What should I do?' }, { llmEnabled: false });
  assert.equal(res.source, 'rules');
  assert.match(res.reply, /your area/);
});

test('handleChat rejects over-limit Gemini replies so history stays valid', async () => {
  const longFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'Keep windows shut. '.repeat(60).trim() }] } }],
    }),
  });
  const res = await handleChat(
    { message: 'Should I open windows?', context: { place: 'Delhi', aqi: 220, guidance: 'avoid' } },
    { fetchImpl: longFetch, llmEnabled: true, apiKey: 'test-key' },
  );
  assert.equal(res.source, 'rules');
  assert.ok(res.reply.length <= 1000);
});
