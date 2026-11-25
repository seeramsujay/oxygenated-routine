/**
 * @fileoverview Accessible DOM rendering engine for clean-air action plans.
 *
 * Implements pure, side-effect-free DOM rendering: consumes validated JSON plan responses
 * and constructs accessible, semantic HTML trees.
 *
 * Accessibility & UX Principles:
 * - Text-first representation: Graphical bars and scales use `aria-hidden="true"` while
 *   explicit semantic text and badges supply the full content to assistive technology.
 * - Progressive disclosure: Deep sections (e.g. hacks, sustainable swaps, medical red flags)
 *   use WAI-ARIA collapsible disclosure cards to keep initial viewport scan times low.
 * - In-page jump navigation: Top-level jump pills enable immediate navigation to any section.
 * - Pure rendering: Performs no network I/O or storage modifications.
 */
import { chatCard } from './chat.js';
import { commuteChart, exposureSimulator, forecastChart, pollutantChart } from './charts.js';
import { card, el, foldCard, list, plainList, setFold } from './dom.js';
import { stopCurrentSpeech, ttsControls } from './tts.js';

const GUIDANCE_TEXT = {
  avoid: 'Outdoor activity today: avoid',
  limit: 'Outdoor activity today: keep it short and light',
  normal: 'Outdoor activity today: fine',
};
const WHEN_LABEL = { morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
const MODE_LABEL = { wfh: 'Working from home', bus: 'Bus', metro: 'Metro or train', bike: 'Cycling', walk: 'Walking' };
const NAV_LABEL = {
  first: 'Do this first',
  air: 'In your air',
  impact: 'What it changes',
  timing: 'Best time out',
  routine: 'Your day',
  indoor: 'Indoor air',
  swaps: 'Greener swaps',
  care: 'Protect the vulnerable',
  community: 'Community',
  help: 'Get medical help',
  chat: 'Ask AI',
};

/** US EPA AQI bands, drawn as equal-width segments so every category is visible on the scale. */
const AQI_BANDS = [
  { max: 50, tone: 'good', label: 'Good' },
  { max: 100, tone: 'moderate', label: 'Moderate' },
  { max: 150, tone: 'sensitive', label: 'Sensitive' },
  { max: 200, tone: 'unhealthy', label: 'Unhealthy' },
  { max: 300, tone: 'very', label: 'Very unhealthy' },
  { max: 500, tone: 'hazardous', label: 'Hazardous' },
];

/** Position of an AQI value along the equal-width scale, as a percentage. */
export function aqiScalePosition(aqi) {
  const value = Math.min(Math.max(aqi, 0), 500);
  const index = AQI_BANDS.findIndex((band) => value <= band.max);
  const min = index === 0 ? 0 : AQI_BANDS[index - 1].max;
  const within = (value - min) / (AQI_BANDS[index].max - min);
  return Math.round(((index + within) / AQI_BANDS.length) * 1000) / 10;
}

/** Decorative scale; the badge already states the number and category in text. */
function aqiScale(aqi) {
  const marker = el('span', { className: 'scale-marker' });
  marker.style.insetInlineStart = `${aqiScalePosition(aqi)}%`;
  return el(
    'div',
    { className: 'scale', attrs: { 'aria-hidden': 'true' } },
    el(
      'div',
      { className: 'scale-bar' },
      ...AQI_BANDS.map((band) => el('span', { className: `band band-${band.tone}` })),
      marker,
    ),
    el('div', { className: 'scale-labels' }, el('span', { text: 'Clean' }), el('span', { text: 'Hazardous' })),
  );
}

const cigarettes = (n) => `${n} ${n === 1 ? 'cigarette' : 'cigarettes'}`;

function toneFor(categoryId) {
  if (categoryId === 'good') return 'tone-good';
  return categoryId === 'moderate' ? 'tone-warn' : 'tone-bad';
}

function nudge({ meta }, onPersonalise) {
  if (meta.personalised) return null;
  const { household, commute, home } = meta.assumed;
  const assumption = `${household.adults} adults, a ${commute.oneWayKm} km ${commute.mode} commute, ${home.heating} heating and ${home.cooking} cooking`;
  const button = el('button', {
    className: 'link-button',
    text: 'Make it fit my home',
    attrs: { type: 'button' },
  });
  button.addEventListener('click', onPersonalise);
  return el(
    'p',
    { className: 'nudge hint' },
    document.createTextNode(`We assumed a typical household (${assumption}). `),
    button,
  );
}

function planShareControls(data) {
  const copyBtn = el('button', {
    className: 'button secondary share-btn',
    text: 'Copy summary',
    attrs: { type: 'button' },
  });
  copyBtn.addEventListener('click', async () => {
    const place = [data.location?.name, data.location?.country].filter(Boolean).join(', ');
    const lines = [
      `${place} — AQI ${data.air.aqi} (${data.air.category.label})`,
      data.plan.headline,
      '',
      'Top 3 actions:',
      ...data.plan.top_actions.map((a, i) => `${i + 1}. ${a}`),
    ];
    if (data.window) {
      lines.push(
        '',
        `Cleanest window: ${data.window.day === 'tomorrow' ? 'tomorrow ' : ''}${data.window.start}–${data.window.end} (avg AQI ${data.window.avgAqi})`,
      );
    }
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      copyBtn.textContent = 'Copy unavailable';
      return;
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy summary';
      }, 2000);
    } catch {
      copyBtn.textContent = 'Copy failed';
    }
  });

  const printBtn = el('button', {
    className: 'button secondary share-btn',
    text: 'Print plan',
    attrs: { type: 'button' },
  });
  printBtn.addEventListener('click', () => window.print?.());

  return el(
    'div',
    { className: 'hero-actions' },
    ttsControls(data),
    el('div', { className: 'share-controls' }, copyBtn, printBtn),
  );
}

function heroCard(data, onPersonalise) {
  const { air, plan, guidance, location } = data;
  const badge = el(
    'div',
    {
      className: `aqi-badge ${toneFor(air.category.id)}`,
      attrs: { role: 'img', 'aria-label': `Air quality index ${air.aqi}, ${air.category.label}` },
    },
    el('strong', { text: String(air.aqi) }),
    el('span', { text: air.category.label }),
  );
  const place =
    air.source === 'manual' ? 'the AQI you entered' : [location.name, location.country].filter(Boolean).join(', ');
  return el(
    'div',
    { className: 'card hero' },
    el('div', { className: 'hero-side' }, badge),
    el(
      'div',
      {},
      el('h2', { text: plan.headline, attrs: { id: 'results-title', tabindex: '-1' } }),
      el('p', { className: 'plain', text: air.category.meaning }),
      el('p', { className: 'hint', text: `${GUIDANCE_TEXT[guidance]}. Based on ${place}.` }),
      nudge(data, onPersonalise),
      planShareControls(data),
    ),
    aqiScale(air.aqi),
  );
}

const firstCard = ({ plan }) =>
  card(
    'first',
    'Do these 3 things first',
    list(plan.top_actions, (action) => [document.createTextNode(action)], 'first-list'),
  );

function stat(label, value, unit, highlight, scaleMax) {
  const bar = el('span', { className: 'stat-bar', attrs: { 'aria-hidden': 'true' } }, el('span'));
  bar.firstChild.style.inlineSize = `${scaleMax > 0 ? Math.max((value / scaleMax) * 100, 2) : 0}%`;
  return el(
    'div',
    { className: `stat${highlight ? ' highlight' : ''}` },
    el('dt', { text: label }),
    el('dd', {}, document.createTextNode(String(value)), el('small', { text: unit }), bar),
  );
}

function commuteBlock({ commute }) {
  if (commute.alternatives.length === 0) return [];
  return [
    el('h3', { text: 'Greener ways to travel' }),
    list(commute.alternatives, (alt) => [
      el('strong', { text: `${MODE_LABEL[alt.mode] ?? alt.mode}: ` }),
      document.createTextNode(
        `saves about ${alt.savedKgPerWeek} kg of CO₂ a week (${alt.savedKgPerWinter} kg over a 13-week winter).`,
      ),
    ]),
  ];
}

function pollutantFold(items, region) {
  const chart = pollutantChart(items);
  const monitorHint = region?.monitorHint ?? '';
  if (!chart && !monitorHint) return null;
  const label = items.map((i) => i.id.toUpperCase()).join(', ') || 'WHO limits';
  return el(
    'details',
    { className: 'explore-fold' },
    el('summary', { text: `Explore pollutant breakdown (${label})` }),
    chart,
    monitorHint ? el('p', { className: 'hint', text: monitorHint }) : null,
  );
}

function airDetailsCard({ locationContext }) {
  const items = locationContext?.pollutants?.items ?? [];
  const region = locationContext?.region ?? null;
  if (items.length === 0 && !region) return null;
  const regionLine = region
    ? el(
        'p',
        { className: 'plain' },
        el('strong', { text: `${region.label} profile: ` }),
        document.createTextNode(
          `Typical local drivers include ${region.sources}. Recommended mask standard: ${region.respirator}.`,
        ),
      )
    : null;
  return card('air', 'What’s in your air', regionLine, pollutantFold(items, region));
}

function impactCard(data) {
  const { impact } = data;
  const { exposure } = impact;
  const sentence =
    `Breathing today’s air on your current habits is roughly like smoking ${cigarettes(exposure.todayCurrentHabitsCigarettes)}. ` +
    `Following this plan could bring that down to about ${cigarettes(exposure.todayWithPlanCigarettes)}.`;
  const top = Math.max(
    exposure.standingOutsideAllDayCigarettes,
    exposure.todayCurrentHabitsCigarettes,
    exposure.todayWithPlanCigarettes,
  );
  const stats = el(
    'dl',
    { className: 'stats' },
    stat('A full day outside, unprotected', exposure.standingOutsideAllDayCigarettes, 'cigarettes’ worth', false, top),
    stat('Your day on current habits', exposure.todayCurrentHabitsCigarettes, 'cigarettes’ worth', false, top),
    stat(
      'Your day with this plan',
      exposure.todayWithPlanCigarettes,
      `cigarettes’ worth, ${exposure.reductionPercent}% lower`,
      true,
      top,
    ),
  );
  const commuteItems = commuteBlock(impact);
  const commuteSvg = commuteChart(impact.commute, MODE_LABEL);
  const commuteFold =
    commuteItems.length > 0
      ? el(
          'details',
          { className: 'explore-fold' },
          el('summary', { text: `Explore greener commute savings (${impact.commute.alternatives.length} options)` }),
          ...commuteItems,
          commuteSvg,
        )
      : null;

  return card(
    'impact',
    'What your choices change',
    el('p', { className: 'plain', text: sentence }),
    stats,
    el(
      'details',
      { className: 'explore-fold' },
      el('summary', { text: 'Explore interactive “What-if” protection simulator' }),
      exposureSimulator(data),
    ),
    commuteFold,
  );
}

function forecastTable(forecast) {
  const head = el('tr', {}, ...['Time', 'AQI', 'Category'].map((t) => el('th', { text: t, attrs: { scope: 'col' } })));
  const rows = forecast.map((h) =>
    el(
      'tr',
      {},
      el('td', { text: h.time.slice(11, 16) }),
      el('td', { text: String(h.aqi) }),
      el('td', { text: h.category }),
    ),
  );
  return el(
    'table',
    {},
    el('caption', { className: 'hint', text: 'Hourly forecast, local time' }),
    el('thead', {}, head),
    el('tbody', {}, ...rows),
  );
}

function timingCard({ window, forecast }) {
  if (!window && forecast.length === 0) return null;
  const children = [];
  if (window) {
    children.push(
      el(
        'p',
        { className: 'plain' },
        el('strong', {
          text: `Cleanest time to go out: ${window.day === 'tomorrow' ? 'tomorrow, ' : ''}${window.start}–${window.end}`,
        }),
        document.createTextNode(
          ` (forecast AQI about ${window.avgAqi}, against ${window.worstAqi} around ${window.worstHour}).`,
        ),
      ),
    );
  }
  if (forecast.length > 0) {
    children.push(
      el(
        'details',
        { className: 'explore-fold' },
        el('summary', { text: 'Explore 24-hour AQI forecast chart & table' }),
        forecastChart(forecast, window),
        el('details', {}, el('summary', { text: 'See hourly data table' }), forecastTable(forecast)),
      ),
    );
  }
  return card('timing', 'Best time to be outdoors', ...children);
}

function routineCard({ plan }) {
  const items = list(plan.daily_routine, (item) => [
    el('span', { className: 'tag', text: WHEN_LABEL[item.when] }),
    el('strong', { text: item.action }),
    el('p', { className: 'why', text: item.why }),
    el('p', { className: 'impact', text: item.impact }),
  ]);
  return card('routine', 'Your low-emission day', items);
}

function indoorCard({ plan }) {
  const items = list(plan.indoor_air_hacks, (hack) => [
    el('span', { className: 'tag', text: `Cost: ${hack.cost}` }),
    el('strong', { text: hack.title }),
    el('ul', {}, ...hack.steps.map((step) => el('li', { text: step }))),
    el('p', { className: 'why', text: hack.why }),
  ]);
  const free = plan.indoor_air_hacks.filter((hack) => hack.cost === 'free').length;
  const teaser = `${plan.indoor_air_hacks.length} ideas${free > 0 ? `, ${free} free` : ''}`;
  return foldCard('indoor', 'Clean the air at home', teaser, items);
}

function swapsCard({ plan }) {
  const items = list(plan.sustainable_alternatives, (swap) => [
    el('span', { className: 'tag', text: `Effort: ${swap.effort}` }),
    el('strong', { text: swap.swap }),
    el('p', { className: 'impact', text: swap.benefit }),
  ]);
  return foldCard(
    'swaps',
    'Greener swaps that also clean the air',
    `${plan.sustainable_alternatives.length} swaps`,
    items,
  );
}

function helpCard({ plan, locationContext }) {
  const helplines = locationContext?.helplines ?? [];
  const helplineBlock =
    helplines.length > 0
      ? [
          el('h3', { text: 'Emergency & medical helplines' }),
          el(
            'ul',
            { className: 'helpline-list' },
            ...helplines.map((h) => {
              const safeTel = String(h.number).replace(/[^\d+-]/g, '');
              return el(
                'li',
                { className: 'helpline-item' },
                el('span', { text: `${h.label}: ` }),
                el('a', {
                  className: 'helpline-link',
                  text: h.number,
                  attrs: { href: `tel:${safeTel}`, 'aria-label': `Call ${h.label} at ${h.number}` },
                }),
              );
            }),
          ),
        ]
      : [];
  return card('help', 'Get medical help if', plainList(plan.seek_medical_help_if), ...helplineBlock);
}

function footerCard({ meta, impact }) {
  const poweredBy =
    meta.source === 'gemini'
      ? 'Personalised by Gemini using the verified figures above.'
      : 'Generated by our built-in guidance engine.';
  return el(
    'section',
    { className: 'card' },
    meta.notice ? el('p', { className: 'notice', text: meta.notice }) : null,
    el('p', { className: 'hint', text: `${poweredBy} ${meta.disclaimer}` }),
    el(
      'details',
      {},
      el('summary', { text: 'How these numbers are estimated' }),
      el('ul', {}, ...impact.assumptions.map((a) => el('li', { text: a }))),
    ),
  );
}

function jumpLink(section) {
  const link = el('a', { text: NAV_LABEL[section.id], attrs: { href: `#${section.id}` } });
  const toggle = section.querySelector('.fold-toggle');
  if (toggle) link.addEventListener('click', () => setFold(toggle, true));
  return el('li', {}, link);
}

function jumpNav(container) {
  const links = [...container.querySelectorAll('section.card[id]')]
    .filter((section) => NAV_LABEL[section.id])
    .map(jumpLink);
  return el('nav', { className: 'jump-nav', attrs: { 'aria-label': 'Jump to a section' } }, el('ul', {}, ...links));
}

/**
 * Replace the contents of `container` with the plan and move focus to its heading.
 * @param {HTMLElement} container
 * @param {object} data API response
 * @param {() => void} onPersonalise called when the user asks to personalise the plan
 */
export function renderResults(container, data, onPersonalise, { focus = true } = {}) {
  stopCurrentSpeech();
  const sections = [
    heroCard(data, onPersonalise),
    firstCard(data),
    airDetailsCard(data),
    impactCard(data),
    timingCard(data),
    routineCard(data),
    indoorCard(data),
    swapsCard(data),
    data.plan.protect_vulnerable_members.length > 0
      ? card('care', 'Looking after the vulnerable', plainList(data.plan.protect_vulnerable_members))
      : null,
    foldCard(
      'community',
      'Community actions',
      `${data.plan.community_actions.length} ideas`,
      plainList(data.plan.community_actions),
    ),
    helpCard(data),
    footerCard(data),
    chatCard(data),
  ].filter(Boolean);

  container.replaceChildren(...sections);
  container.insertBefore(jumpNav(container), sections[1]);
  container.hidden = false;
  if (focus) container.querySelector('#results-title').focus();
}
