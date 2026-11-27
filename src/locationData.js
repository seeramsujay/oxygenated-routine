/**
 * @fileoverview Static regional smog profiles, WHO guideline constants, and country helplines.
 *
 * Separated from `locationContext.js` so reference data stays cleanly decoupled from
 * resolution and pollutant-analysis logic.
 */

/** WHO 2021 short-term (24-hour) Air Quality Guideline levels in µg/m³. */
export const WHO_GUIDELINES = Object.freeze({
  pm25: 15,
  pm10: 45,
  no2: 25,
});

export const REGIONAL_PROFILES = Object.freeze({
  south_asia: {
    id: 'south_asia',
    label: 'South Asia',
    respirator: 'N95 or KN95',
    sources: 'winter temperature inversions, vehicle exhaust, biomass or crop burning, and construction dust',
    monitorHint: 'Check national stations (CPCB / SAFAR in India, Pak-EPA in Pakistan) for street-level spikes.',
    tips: {
      indoor: {
        title: 'Block dust and inversion smoke at door gaps',
        steps: [
          'Press a rolled damp towel along the bottom gap of exterior doors during severe smog spikes.',
          'Wet-mop hard floors daily rather than dry sweeping, which kicks settled dust back into the air.',
        ],
        cost: 'free',
        why: 'Overnight inversions and fine dust seep under door thresholds and resettle on floors.',
      },
      routineAvoid:
        'Wait until mid-afternoon for essential trips — overnight inversions trap smoke near ground level until the sun warms the air.',
      routineNormal:
        'Prefer quieter side streets over main junctions when outdoors, and keep shoes at the door to leave road dust outside.',
      community:
        'Encourage your housing society or school to ban leaf and waste burning and to sprinkle water on dusty unpaved areas.',
    },
  },
  east_asia: {
    id: 'east_asia',
    label: 'East Asia',
    respirator: 'KF94, KN95, or N95',
    sources: 'regional winter haze, dense urban traffic, and seasonal dust events',
    monitorHint: 'Check your city environmental bureau feed or local district station for hourly PM2.5 alerts.',
    tips: {
      indoor: {
        title: 'Run indoor recirculation and seal window frames',
        steps: [
          'Set split AC or fresh-air units to indoor recirculation mode when outdoor AQI exceeds 100.',
          'Check window rubber seals and apply foam weather-stripping on older sliding frames.',
        ],
        cost: 'free',
        why: 'Sliding window tracks are a common leak path for regional haze and fine yellow dust.',
      },
      routineAvoid:
        'Wear a snug KF94 or KN95 with the nose wire pinched flat during metro transfers and outdoor errands.',
      routineNormal:
        'Take advantage of metro and rail connections for longer commutes to keep street-level emissions low.',
      community:
        'Share real-time district AQI alerts in neighbourhood chat groups so older residents know when to close windows.',
    },
  },
  europe_uk: {
    id: 'europe_uk',
    label: 'Europe & UK',
    respirator: 'FFP2',
    sources: 'residential wood-burning stoves, diesel traffic NO2, and calm winter inversions',
    monitorHint: 'Check UK-AIR (DEFRA), EEA Air Quality Index, or municipal sensor maps for street-level NO2.',
    tips: {
      indoor: {
        title: 'Balance smog sealing with 10-minute airing against damp',
        steps: [
          'Keep windows shut during evening wood-stove peaks, then cross-ventilate for 10 minutes in the cleanest afternoon window.',
          'Use trickle vents only on the side facing away from busy roads.',
        ],
        cost: 'free',
        why: 'Sealing a damp winter home indefinitely raises indoor humidity and mould risk; brief timed airing prevents both.',
      },
      routineAvoid:
        'Use quieter residential streets rather than busy bus/diesel corridors for essential trips to cut NO2 exposure.',
      routineNormal:
        'Choose side streets one block back from main arterial roads — traffic NO2 drops sharply just 50 metres from kerbs.',
      community:
        'Ask neighbours and local councils to support smoke-control rules and avoid burning wet wood in domestic stoves.',
    },
  },
  north_america: {
    id: 'north_america',
    label: 'North America',
    respirator: 'N95',
    sources: 'winter valley inversions, wood stoves, highway traffic, and seasonal wildfire smoke',
    monitorHint: 'Check AirNow.gov (or Fire.AirNow.gov / PurpleAir) for neighbourhood-level sensor readings.',
    tips: {
      indoor: {
        title: 'Upgrade central HVAC filtration to MERV 13',
        steps: [
          'Fit a MERV-13 filter in your central furnace/HVAC return if compatible, and set the fan to "On" during smog peaks.',
          'Keep attached-garage doors closed and never idle vehicles inside or right outside.',
        ],
        cost: 'low',
        why: 'Standard MERV-8 furnace filters let fine PM2.5 pass straight through; MERV 13 captures fine smoke particles.',
      },
      routineAvoid:
        'Follow local Spare-the-Air or wood-burn ban days and switch HVAC to recirculate rather than drawing outdoor air.',
      routineNormal:
        'Check AirNow before outdoor workouts, especially in valley towns where afternoon sun can shift inversion layers.',
      community:
        'Support local clean-air shelter access (libraries and community centres) for neighbours without indoor filtration.',
    },
  },
  southeast_asia: {
    id: 'southeast_asia',
    label: 'Southeast Asia',
    respirator: 'N95 or KF94',
    sources: 'seasonal agricultural haze, two-wheeler traffic exhaust, and humid urban smog',
    monitorHint:
      'Follow your national environment agency haze index (e.g. NEA, PCD, or AQICN) for 1-hour PM2.5 trends.',
    tips: {
      indoor: {
        title: 'Use AC recirculation mode and clean mesh pre-filters',
        steps: [
          'Run split-unit air conditioners on indoor recirculation with the fresh-air flap closed.',
          'Rinse AC dust screens every two weeks during haze season so airflow stays strong.',
        ],
        cost: 'free',
        why: 'High humidity clogs damp filters quickly; clean pre-filters help indoor cooling and purifiers work efficiently.',
      },
      routineAvoid:
        'If riding a motorbike for essential trips, wear a snug N95/KF94 under your helmet and wash your face on arrival.',
      routineNormal:
        'Prefer shaded, off-road paths or air-conditioned transit during peak rush hour to avoid exhaust fumes.',
      community: 'Coordinate with local schools to move outdoor assemblies indoors whenever 1-hour PM2.5 spikes.',
    },
  },
  global: {
    id: 'global',
    label: 'Local Area',
    respirator: 'N95 or FFP2',
    sources: 'urban traffic exhaust, local heating, and stagnant winter air',
    monitorHint: 'Check local municipal air-quality stations alongside Open-Meteo forecasts.',
    tips: {
      indoor: {
        title: 'Create one clean-air refuge room',
        steps: [
          'Pick the bedroom or main living room, keep its exterior windows sealed, and concentrate filtration there.',
          'Leave shoes and dusty outer coats near the entrance.',
        ],
        cost: 'free',
        why: 'Focusing filtration on one closed room lowers PM2.5 faster and uses less energy than treating the whole home.',
      },
      routineAvoid:
        'Stay on quieter side streets for essential errands and wear a well-fitted N95/FFP2 respirator outdoors.',
      routineNormal: 'Choose quieter side streets over main roads when outdoors to cut traffic-exhaust exposure.',
      community: 'Share local AQI readings with neighbours and support no-idling zones outside nearby schools.',
    },
  },
});

export const COUNTRY_TO_REGION = new Map([
  ['india', 'south_asia'],
  ['pakistan', 'south_asia'],
  ['bangladesh', 'south_asia'],
  ['nepal', 'south_asia'],
  ['sri lanka', 'south_asia'],
  ['china', 'east_asia'],
  ['south korea', 'east_asia'],
  ['republic of korea', 'east_asia'],
  ['korea', 'east_asia'],
  ['japan', 'east_asia'],
  ['taiwan', 'east_asia'],
  ['united kingdom', 'europe_uk'],
  ['uk', 'europe_uk'],
  ['ireland', 'europe_uk'],
  ['france', 'europe_uk'],
  ['germany', 'europe_uk'],
  ['poland', 'europe_uk'],
  ['italy', 'europe_uk'],
  ['spain', 'europe_uk'],
  ['netherlands', 'europe_uk'],
  ['belgium', 'europe_uk'],
  ['switzerland', 'europe_uk'],
  ['austria', 'europe_uk'],
  ['czechia', 'europe_uk'],
  ['czech republic', 'europe_uk'],
  ['sweden', 'europe_uk'],
  ['norway', 'europe_uk'],
  ['denmark', 'europe_uk'],
  ['portugal', 'europe_uk'],
  ['greece', 'europe_uk'],
  ['united states', 'north_america'],
  ['usa', 'north_america'],
  ['canada', 'north_america'],
  ['mexico', 'north_america'],
  ['thailand', 'southeast_asia'],
  ['vietnam', 'southeast_asia'],
  ['indonesia', 'southeast_asia'],
  ['malaysia', 'southeast_asia'],
  ['singapore', 'southeast_asia'],
  ['philippines', 'southeast_asia'],
]);

export const TIMEZONE_PREFIX_TO_REGION = [
  ['Asia/Kolkata', 'south_asia'],
  ['Asia/Calcutta', 'south_asia'],
  ['Asia/Karachi', 'south_asia'],
  ['Asia/Dhaka', 'south_asia'],
  ['Asia/Kathmandu', 'south_asia'],
  ['Asia/Colombo', 'south_asia'],
  ['Asia/Shanghai', 'east_asia'],
  ['Asia/Beijing', 'east_asia'],
  ['Asia/Seoul', 'east_asia'],
  ['Asia/Tokyo', 'east_asia'],
  ['Asia/Taipei', 'east_asia'],
  ['Asia/Bangkok', 'southeast_asia'],
  ['Asia/Ho_Chi_Minh', 'southeast_asia'],
  ['Asia/Jakarta', 'southeast_asia'],
  ['Asia/Kuala_Lumpur', 'southeast_asia'],
  ['Asia/Singapore', 'southeast_asia'],
  ['Asia/Manila', 'southeast_asia'],
  ['Europe/', 'europe_uk'],
  ['America/New_York', 'north_america'],
  ['America/Chicago', 'north_america'],
  ['America/Denver', 'north_america'],
  ['America/Los_Angeles', 'north_america'],
  ['America/Phoenix', 'north_america'],
  ['America/Anchorage', 'north_america'],
  ['America/Toronto', 'north_america'],
  ['America/Vancouver', 'north_america'],
  ['America/Montreal', 'north_america'],
  ['America/Edmonton', 'north_america'],
  ['America/Winnipeg', 'north_america'],
  ['America/Halifax', 'north_america'],
  ['America/Mexico_City', 'north_america'],
  ['America/Monterrey', 'north_america'],
  ['America/Tijuana', 'north_america'],
];

export const COUNTRY_HELPLINES = new Map([
  [
    'india',
    [
      { label: 'National Emergency', number: '112' },
      { label: 'Medical Ambulance', number: '108' },
    ],
  ],
  [
    'pakistan',
    [
      { label: 'Rescue & Ambulance', number: '1122' },
      { label: 'Edhi Ambulance', number: '115' },
    ],
  ],
  ['bangladesh', [{ label: 'National Emergency & Ambulance', number: '999' }]],
  [
    'nepal',
    [
      { label: 'Ambulance', number: '102' },
      { label: 'Emergency', number: '100' },
    ],
  ],
  [
    'sri lanka',
    [
      { label: 'Suwa Seriya Ambulance', number: '1990' },
      { label: 'Emergency', number: '119' },
    ],
  ],
  [
    'united states',
    [
      { label: 'Emergency Medical Services', number: '911' },
      { label: 'Poison Control', number: '1-800-222-1222' },
    ],
  ],
  [
    'usa',
    [
      { label: 'Emergency Medical Services', number: '911' },
      { label: 'Poison Control', number: '1-800-222-1222' },
    ],
  ],
  [
    'canada',
    [
      { label: 'Emergency Medical Services', number: '911' },
      { label: 'HealthLink (non-emergency nurse advice)', number: '811' },
    ],
  ],
  ['mexico', [{ label: 'Emergency Medical Services', number: '911' }]],
  [
    'united kingdom',
    [
      { label: 'Emergency Medical Services', number: '999' },
      { label: 'NHS Urgent Medical Advice (England, Scotland & Wales)', number: '111' },
    ],
  ],
  [
    'uk',
    [
      { label: 'Emergency Medical Services', number: '999' },
      { label: 'NHS Urgent Medical Advice (England, Scotland & Wales)', number: '111' },
    ],
  ],
  [
    'ireland',
    [
      { label: 'Emergency Services', number: '112' },
      { label: 'Emergency (alternative)', number: '999' },
    ],
  ],
  [
    'china',
    [
      { label: 'Medical Ambulance', number: '120' },
      { label: 'Emergency', number: '110' },
    ],
  ],
  [
    'south korea',
    [
      { label: 'Medical Emergency & Fire', number: '119' },
      { label: 'Korea Disease Control Helpline', number: '1339' },
    ],
  ],
  [
    'republic of korea',
    [
      { label: 'Medical Emergency & Fire', number: '119' },
      { label: 'Korea Disease Control Helpline', number: '1339' },
    ],
  ],
  ['korea', [{ label: 'Medical Emergency & Fire', number: '119' }]],
  ['japan', [{ label: 'Ambulance & Fire', number: '119' }]],
  ['taiwan', [{ label: 'Ambulance & Fire', number: '119' }]],
  [
    'thailand',
    [
      { label: 'Medical Emergency', number: '1669' },
      { label: 'Emergency', number: '191' },
    ],
  ],
  ['vietnam', [{ label: 'Medical Ambulance', number: '115' }]],
  [
    'indonesia',
    [
      { label: 'Medical Ambulance', number: '118' },
      { label: 'National Emergency', number: '112' },
    ],
  ],
  ['malaysia', [{ label: 'Emergency & Ambulance', number: '999' }]],
  ['singapore', [{ label: 'SCDF Emergency Ambulance', number: '995' }]],
  ['philippines', [{ label: 'National Emergency', number: '911' }]],
  [
    'australia',
    [
      { label: 'Emergency Medical Services', number: '000' },
      { label: 'Healthdirect Medical Advice', number: '1800-022-222' },
    ],
  ],
]);

export const TIMEZONE_TO_COUNTRY = new Map([
  ['Asia/Kolkata', 'india'],
  ['Asia/Calcutta', 'india'],
  ['Asia/Karachi', 'pakistan'],
  ['Asia/Dhaka', 'bangladesh'],
  ['Asia/Kathmandu', 'nepal'],
  ['Asia/Colombo', 'sri lanka'],
  ['Asia/Shanghai', 'china'],
  ['Asia/Beijing', 'china'],
  ['Asia/Seoul', 'south korea'],
  ['Asia/Tokyo', 'japan'],
  ['Asia/Taipei', 'taiwan'],
  ['Asia/Bangkok', 'thailand'],
  ['Asia/Ho_Chi_Minh', 'vietnam'],
  ['Asia/Jakarta', 'indonesia'],
  ['Asia/Kuala_Lumpur', 'malaysia'],
  ['Asia/Singapore', 'singapore'],
  ['Asia/Manila', 'philippines'],
  ['Europe/London', 'united kingdom'],
]);

export const REGION_FALLBACK_HELPLINES = Object.freeze({
  europe_uk: [{ label: 'European Emergency Number', number: '112' }],
  north_america: [{ label: 'Emergency Medical Services', number: '911' }],
  south_asia: [{ label: 'Emergency Services', number: '112' }],
  east_asia: [{ label: 'International Mobile Emergency (GSM)', number: '112' }],
  southeast_asia: [{ label: 'International Mobile Emergency (GSM)', number: '112' }],
  global: [{ label: 'International Emergency Number (GSM)', number: '112' }],
});
