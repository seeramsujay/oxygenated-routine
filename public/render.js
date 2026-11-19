/** Turns an API response into accessible DOM. Pure rendering: no network, no storage. */
import { card, el, list, plainList } from './dom.js';

const GUIDANCE_TEXT = {
  avoid: 'Outdoor activity today: avoid',
  limit: 'Outdoor activity today: keep it short and light',
  normal: 'Outdoor activity today: fine',
};
const WHEN_LABEL = { morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
const MODE_LABEL = { wfh: 'Working from home', bus: 'Bus', metro: 'Metro or train', bike: 'Cycling', walk: 'Walking' };
const NAV_LABEL = {
  first: 'Do this first',
  impact: 'What it changes',
  timing: 'Best time out',
  routine: 'Your day',
  indoor: 'Indoor air',
  swaps: 'Greener swaps',
  care: 'Protect the vulnerable',
  community: 'Community',
  help: 'Get medical help',
};

const cigarettes = (n) => `${n} ${n === 1 ? 'cigarette' : 'cigarettes'}`;

function toneFor(categoryId) {
  if (categoryId === 'good') return 'tone-good';
  return categoryId === 'moderate' ? 'tone-warn' : 'tone-bad';
}

function heroCard({ air, plan, guidance, location }) {
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
    badge,
    el(
      'div',
      {},
      el('h2', { text: plan.headline, attrs: { id: 'results-title', tabindex: '-1' } }),
      el('p', { className: 'plain', text: air.category.meaning }),
      el('p', { className: 'hint', text: `${GUIDANCE_TEXT[guidance]}. Based on ${place}.` }),
    ),
  );
}

const firstCard = ({ plan }) =>
  card(
    'first',
    'Do these 3 things first',
    list(plan.top_actions, (action) => [document.createTextNode(action)], 'first-list'),
  );

function stat(label, value, unit, highlight) {
  return el(
    'div',
    { className: `stat${highlight ? ' highlight' : ''}` },
    el('dt', { text: label }),
    el('dd', {}, document.createTextNode(String(value)), el('small', { text: unit })),
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

function impactCard({ impact }) {
  const { exposure } = impact;
  const sentence =
    `Breathing today’s air on your current habits is roughly like smoking ${cigarettes(exposure.todayCurrentHabitsCigarettes)}. ` +
    `Following this plan could bring that down to about ${cigarettes(exposure.todayWithPlanCigarettes)}.`;
  const stats = el(
    'dl',
    { className: 'stats' },
    stat('A full day outside, unprotected', exposure.standingOutsideAllDayCigarettes, 'cigarettes’ worth'),
    stat('Your day on current habits', exposure.todayCurrentHabitsCigarettes, 'cigarettes’ worth'),
    stat(
      'Your day with this plan',
      exposure.todayWithPlanCigarettes,
      `cigarettes’ worth, ${exposure.reductionPercent}% lower`,
      true,
    ),
  );
  return card(
    'impact',
    'What your choices change',
    el('p', { className: 'plain', text: sentence }),
    stats,
    ...commuteBlock(impact),
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
        el('strong', { text: `Cleanest time to go out: ${window.start}–${window.end}` }),
        document.createTextNode(
          ` (forecast AQI about ${window.avgAqi}, against ${window.worstAqi} around ${window.worstHour}).`,
        ),
      ),
    );
  }
  if (forecast.length > 0) {
    children.push(el('details', {}, el('summary', { text: 'See the next 24 hours' }), forecastTable(forecast)));
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
  return card('indoor', 'Clean the air at home', items);
}

function swapsCard({ plan }) {
  const items = list(plan.sustainable_alternatives, (swap) => [
    el('span', { className: 'tag', text: `Effort: ${swap.effort}` }),
    el('strong', { text: swap.swap }),
    el('p', { className: 'impact', text: swap.benefit }),
  ]);
  return card('swaps', 'Greener swaps that also clean the air', items);
}

function nudgeCard({ meta }, onPersonalise) {
  if (meta.personalised) return null;
  const { household, commute, home } = meta.assumed;
  const assumption = `${household.adults} adults, a ${commute.oneWayKm} km ${commute.mode} commute, ${home.heating} heating and ${home.cooking} cooking`;
  const button = el('button', {
    className: 'button secondary',
    text: 'Personalise my plan',
    attrs: { type: 'button' },
  });
  button.addEventListener('click', onPersonalise);
  return el(
    'section',
    { className: 'card nudge' },
    el('h2', { text: 'Want advice that fits your home?' }),
    el('p', { text: `We assumed a typical household (${assumption}). Tell us about yours and every tip will fit.` }),
    button,
  );
}

function footerCard({ meta, impact }) {
  const poweredBy =
    meta.source === 'claude'
      ? 'Personalised by Claude using the verified figures above.'
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

function jumpNav(container) {
  const links = [...container.querySelectorAll('section.card[id]')]
    .filter((section) => NAV_LABEL[section.id])
    .map((section) => el('li', {}, el('a', { text: NAV_LABEL[section.id], attrs: { href: `#${section.id}` } })));
  return el('nav', { className: 'jump-nav', attrs: { 'aria-label': 'Jump to a section' } }, el('ul', {}, ...links));
}

/**
 * Replace the contents of `container` with the plan and move focus to its heading.
 * @param {HTMLElement} container
 * @param {object} data API response
 * @param {() => void} onPersonalise called when the user asks to personalise the plan
 */
export function renderResults(container, data, onPersonalise) {
  const sections = [
    heroCard(data),
    firstCard(data),
    impactCard(data),
    timingCard(data),
    routineCard(data),
    indoorCard(data),
    swapsCard(data),
    data.plan.protect_vulnerable_members.length > 0
      ? card('care', 'Looking after the vulnerable', plainList(data.plan.protect_vulnerable_members))
      : null,
    card('community', 'Community actions', plainList(data.plan.community_actions)),
    card('help', 'Get medical help if', plainList(data.plan.seek_medical_help_if)),
    nudgeCard(data, onPersonalise),
    footerCard(data),
  ].filter(Boolean);

  container.replaceChildren(...sections);
  container.insertBefore(jumpNav(container), sections[1]);
  container.hidden = false;
  container.querySelector('#results-title').focus();
}
