/**
 * Offline rule engine. It builds the same plan shape Claude does, so the app
 * stays useful with no API key, no model access or when the model declines.
 */
import { outdoorGuidance } from './aqi.js';

const MODE_NAME = {
  car: 'driving',
  motorbike: 'riding a motorbike',
  bus: 'taking the bus',
  metro: 'taking the metro or train',
  bike: 'cycling',
  walk: 'walking',
  wfh: 'working from home',
};

/** Walking and cycling mean heavy breathing outdoors, so they are never suggested on "avoid" days. */
const ACTIVE_MODES = new Set(['bike', 'walk']);
const suitableAlternatives = ({ impact, guidance }) =>
  impact.commute.alternatives.filter((alt) => guidance !== 'avoid' || !ACTIVE_MODES.has(alt.mode));

/** `bestWindow` only returns windows that are clearly cleaner; this names the day when it is tomorrow. */
const dayLabel = (window) => (window.day === 'tomorrow' ? ' tomorrow' : '');

const COST_RANK = { free: 0, low: 1, medium: 2, high: 3 };
const BUDGET_MAX_COST = { low: 1, medium: 2, high: 3 };

const TAGLINE = {
  avoid: 'Make today a mostly-indoors day.',
  limit: 'Keep outdoor time short and plan around the cleaner hours.',
  normal: 'Air is fine for normal routines.',
};

const HEATING_SWAP = {
  wood: {
    swap: 'Replace open wood fires with an electric heat pump, or at least burn only dry, seasoned wood in a sealed modern stove.',
    benefit:
      'Residential wood smoke is a major winter source of fine particles (PM2.5), indoors and across the neighbourhood.',
    effort: 'hard',
  },
  coal: {
    swap: 'Move from coal to electric, heat-pump or district heating when you can.',
    benefit: 'Burning coal releases PM2.5, sulphur dioxide and carbon monoxide at home and into the shared air.',
    effort: 'hard',
  },
  gas: {
    swap: 'Add draught-proofing and insulation now; plan a heat-pump upgrade at your next boiler replacement.',
    benefit: 'Lower heating demand means fewer combustion emissions (NO2, CO2) and lower bills.',
    effort: 'moderate',
  },
  electric: {
    swap: 'Draught-proof windows and doors and use timers or smart thermostats.',
    benefit: 'Less electricity demand, which lowers emissions wherever the grid still burns fossil fuels.',
    effort: 'easy',
  },
};

const hourOf = (time) => Number(time.slice(0, 2));

function windowSlot(window) {
  const hour = hourOf(window.start);
  if (hour < 11) return 'morning';
  if (hour < 14) return 'midday';
  return hour < 18 ? 'afternoon' : 'evening';
}

function outdoorItem({ air, guidance, sensitive, impact }) {
  const reason = sensitive
    ? 'Your household includes people who are more vulnerable to fine particles.'
    : 'This level is high enough that everyone benefits from cutting back.';
  const respirator = 'A well-fitted N95/FFP2 respirator cuts what you inhale outdoors by about 60%.';
  const items = {
    avoid: {
      action:
        'Keep exercise, sport and playground time indoors today. If you must go out, wear a well-fitted N95/FFP2 respirator.',
      why: `AQI is ${air.aqi} (${air.category.label}). ${reason}`,
      impact: respirator,
    },
    limit: {
      action: 'Keep outdoor time short and light, and skip heavy exercise outside.',
      why: `AQI is ${air.aqi} (${air.category.label}). ${reason}`,
      impact: respirator,
    },
    normal: {
      action: 'Enjoy normal outdoor activity, and still ventilate the home regularly.',
      why: `AQI is ${air.aqi} (${air.category.label}), which is low risk.`,
      impact: `Your estimated exposure today is only about ${impact.exposure.todayCurrentHabitsCigarettes} cigarette-equivalents.`,
    },
  };
  return { when: 'morning', ...items[guidance] };
}

function windowItem({ window, sensitive }) {
  if (!window) return null;
  const range = `between ${window.start} and ${window.end}${dayLabel(window)}`;
  // A relatively cleaner window can still be unhealthy in absolute terms, so play is only suggested when it is not.
  const stillUnsafe = outdoorGuidance(window.avgAqi, { sensitive }) === 'avoid';
  return {
    when: windowSlot(window),
    action: stillUnsafe
      ? `If you have to go out for errands or the school run, go ${range} and wear a well-fitted N95/FFP2 respirator. Keep play and exercise indoors.`
      : `Do errands, the school run or outdoor play ${range}.`,
    why: `Forecast AQI averages about ${window.avgAqi} then, against ${window.worstAqi} around ${window.worstHour}.`,
    impact: 'Choosing the cleaner hours avoids the day’s worst peak without giving anything up.',
  };
}

function ventilationItem({ air, window }) {
  if (air.aqi <= 100) return null;
  const when = window ? `${window.start}–${window.end}${dayLabel(window)}` : 'the cleanest part of the day';
  return {
    when: 'afternoon',
    action: `Keep windows shut. If the house feels stuffy, air it for about 10 minutes during ${when}, then close up.`,
    why: 'Closed windows keep indoor PM2.5 near 60% of outdoor levels, against about 90% with windows open.',
    impact: 'Short, well-timed airing keeps CO2 and moisture in check without letting much smog in.',
  };
}

function commuteItem(ctx) {
  const { profile } = ctx;
  const [best] = suitableAlternatives(ctx);
  if (profile.commute.mode === 'wfh' || !best) return null;
  return {
    when: 'morning',
    action: `Swap some commutes to ${MODE_NAME[best.mode]}${best.mode === 'wfh' ? ' on the days you can' : ''}.`,
    why: 'Fewer car trips mean less tailpipe pollution in the same streets your family breathes.',
    impact: `About ${best.savedKgPerWeek} kg CO₂e saved per week (${best.savedKgPerWinter} kg over a 13-week winter).`,
  };
}

function cookingItem({ profile }) {
  if (!['gas', 'biomass'].includes(profile.home.cooking)) return null;
  return {
    when: 'evening',
    action: 'Cook with the extractor fan on (vented outside) and lids on pots; avoid frying at very high heat.',
    why: `Cooking on ${profile.home.cooking === 'gas' ? 'gas' : 'biomass'} adds fine particles and NO2 indoors, on top of outdoor smog.`,
    impact: 'Venting at the source removes pollution before it spreads through the home.',
  };
}

function nightItem({ profile, impact }) {
  return {
    when: 'night',
    action: profile.home.hasPurifier
      ? 'Run the purifier in the bedroom with the door and windows closed.'
      : 'Sleep with windows shut and the door closed, ideally in the room with a purifier or box-fan filter.',
    why: 'You spend about a third of the day asleep, so clean bedroom air matters most.',
    impact: `With the full plan, today’s estimated dose drops from ${impact.exposure.todayCurrentHabitsCigarettes} to ${impact.exposure.todayWithPlanCigarettes} cigarette-equivalents (${impact.exposure.reductionPercent}% lower).`,
  };
}

const buildRoutine = (ctx) =>
  [outdoorItem, windowItem, ventilationItem, commuteItem, cookingItem, nightItem]
    .map((make) => make(ctx))
    .filter(Boolean);

function hackCatalog({ profile }) {
  const combustion = ['wood', 'coal', 'gas'].includes(profile.home.heating);
  const purifier = profile.home.hasPurifier
    ? {
        title: 'Use your purifier well',
        steps: [
          'Put it in the room you use most and keep doors closed.',
          'Run it on high for 30 minutes, then on auto.',
          'Replace filters on schedule: a clogged filter cleans very little.',
        ],
        cost: 'free',
        why: 'A right-sized HEPA purifier removes roughly half of the PM2.5 that gets indoors.',
      }
    : {
        title: 'Build a box-fan air cleaner',
        steps: [
          'Tape four MERV-13 filters into a cube and fix a box fan on top (a Corsi–Rosenthal box).',
          'Run it in the room where the family spends the evening.',
          'Swap the filters every few months.',
        ],
        cost: 'low',
        why: 'Studies show these cubes clean air about as well as small commercial HEPA units for a fraction of the cost.',
      };
  return [
    {
      title: 'Seal the leaks',
      steps: [
        'Close windows whenever AQI is above 100.',
        'Add draught strips or a rolled towel at door gaps.',
        'Close unused vents, and close the fireplace damper only when no fire is lit and the ashes are completely cold.',
      ],
      cost: 'free',
      why: 'Fewer leaks keep indoor PM2.5 lower and make a purifier work less.',
    },
    purifier,
    {
      title: 'Remove indoor smoke sources',
      steps: [
        'Skip incense, candles and indoor burning on smoggy days.',
        'Never use outdoor grills or unvented heaters inside.',
      ],
      cost: 'free',
      why: 'Indoor smoke adds to what is already seeping in from outside.',
    },
    {
      title: 'Capture dust the smart way',
      steps: [
        'Damp-wipe surfaces and wet-mop instead of dry sweeping.',
        'Vacuum with a HEPA filter, and leave shoes at the door.',
      ],
      cost: 'free',
      why: 'Settled particles are stirred back into the air by dry sweeping.',
    },
    combustion && {
      title: 'Add a carbon monoxide alarm',
      steps: ['Fit a CO alarm near bedrooms and test it monthly.', 'Keep flues clear and service heaters yearly.'],
      cost: 'low',
      why: 'Sealing the home against smog also traps combustion gases, so a CO alarm is essential safety.',
    },
  ].filter(Boolean);
}

const buildHacks = (ctx) => {
  const maxRank = BUDGET_MAX_COST[ctx.profile.budget];
  return hackCatalog(ctx).filter((hack) => COST_RANK[hack.cost] <= maxRank);
};

function buildAlternatives(ctx) {
  const { profile, guidance } = ctx;
  const items = suitableAlternatives(ctx)
    .slice(0, 2)
    .map((alt) => ({
      swap: `Commute by ${alt.mode === 'wfh' ? 'working from home' : MODE_NAME[alt.mode]} when you can.`,
      benefit: `Saves about ${alt.savedKgPerWeek} kg CO₂e per week and removes those trips from the traffic fumes.`,
      effort: alt.mode === 'wfh' || alt.mode === 'metro' || alt.mode === 'bus' ? 'easy' : 'moderate',
    }));
  const heating = HEATING_SWAP[profile.home.heating];
  if (heating) items.push(heating);
  if (['gas', 'biomass'].includes(profile.home.cooking)) {
    items.push({
      swap: 'Move to an induction hob (a single portable plate is a cheap start).',
      benefit: 'No combustion indoors: less NO2 and fewer particles, and it is quicker too.',
      effort: 'moderate',
    });
  }
  if (profile.household.children > 0) {
    items.push({
      swap:
        guidance === 'avoid'
          ? 'Carpool the school run today instead of walking or cycling, and join a no-idling pledge at the gate.'
          : 'Walk, cycle or carpool the school run, and join a no-idling pledge at the gate.',
      benefit: 'Idling engines at school gates concentrate exhaust right where children stand.',
      effort: 'easy',
    });
  }
  return items;
}

function buildCommunity({ profile }) {
  const items = [
    'Ask your school or housing society to display a live AQI reading and adopt a "no idling" rule.',
    'Report open waste or crop burning to your local authority, with the place, time and a photo.',
    'Set up a neighbour group to share a car on smoggy days and lend out spare masks or air cleaners.',
  ];
  if (profile.household.seniors > 0) {
    items.push('Check in on elderly neighbours on high-AQI days and offer to run errands for them.');
  }
  return items;
}

function buildVulnerable({ profile, guidance }) {
  const { children, seniors, conditions } = profile.household;
  const items = [];
  if (children > 0) {
    items.push(
      guidance === 'normal'
        ? 'Children can play outside as usual, but keep an eye on the AQI.'
        : 'Move children’s play and PE indoors, and avoid outdoor sports until the AQI drops.',
    );
  }
  if (seniors > 0) {
    items.push('Older adults should stay in cleaner indoor air and rest more on high-AQI days.');
  }
  if (conditions.some((c) => ['asthma', 'copd', 'allergies'].includes(c))) {
    items.push('Keep reliever medication within reach and follow your doctor’s action plan.');
  }
  if (conditions.includes('heart_disease')) {
    items.push('Avoid exertion outdoors on smoggy days and report chest symptoms promptly.');
  }
  if (conditions.includes('pregnancy')) {
    items.push('Limit time outdoors on poor-air days and ask your midwife or doctor for advice.');
  }
  return items;
}

const MEDICAL_RED_FLAGS = [
  'Breathing is difficult or very fast, especially in a baby or small child.',
  'Chest pain or tightness, a racing heartbeat, or fainting.',
  'Wheezing or coughing that does not ease with the usual medication.',
  'Lips or face look blue or grey. Call emergency services immediately.',
];

function describeRisk({ air, impact }) {
  const { exposure } = impact;
  return (
    `At ${impact.outdoorPm25} µg/m³ of PM2.5, a full day outside with no protection is roughly ` +
    `${exposure.standingOutsideAllDayCigarettes} cigarettes’ worth. On your current habits you are on track for about ` +
    `${exposure.todayCurrentHabitsCigarettes}; the plan below brings that to about ${exposure.todayWithPlanCigarettes} ` +
    `(${exposure.reductionPercent}% lower). AQI ${air.aqi} is ${air.category.label.toLowerCase()}.`
  );
}

/**
 * @param {object} ctx {profile, location, air, impact, window, guidance, sensitive}
 * @returns {import('./planSchema.js').PlanSchema['_output']}
 */
export function buildRulePlan(ctx) {
  const routine = buildRoutine(ctx);
  return {
    headline: `${ctx.location.name}: AQI ${ctx.air.aqi}, ${ctx.air.category.label}. ${TAGLINE[ctx.guidance]}`,
    risk_summary: describeRisk(ctx),
    top_actions: routine.slice(0, 3).map((item) => item.action),
    daily_routine: routine,
    indoor_air_hacks: buildHacks(ctx),
    sustainable_alternatives: buildAlternatives(ctx),
    community_actions: buildCommunity(ctx),
    protect_vulnerable_members: buildVulnerable(ctx),
    seek_medical_help_if: MEDICAL_RED_FLAGS,
  };
}
