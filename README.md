# Oxygenated Routine

A GenAI-powered assistant that helps families and communities get through severe winter smog. Type your city (or tap **Use my location**) and it checks the live air quality, then tells you in plain language:

- **what to do today**: three clear actions first, then a full low-emission daily routine,
- **when to go out**: the cleanest hours in the next 24 hours,
- **how to clean the air at home**: indoor air hacks that fit your budget,
- **which greener swaps help**: commute, heating and cooking changes that cut emissions too,
- **what each choice changes**: for example, "roughly like smoking 3.8 cigarettes today, 1.3 with this plan".

## Chosen vertical

**Urban air-pollution and winter-smog assistant for families and communities.** The persona is a busy parent, or a neighbourhood group, in a smog-hit city who wants to know _what do I actually do today, and does it make a difference?_ without reading AQI charts.

## Using it

1. Open the app and type your city, tap **Use my location**, or tap an example city (Delhi, Lahore, Beijing).
2. Press **Get my plan**. That is the whole flow: one step, no sign-up.
3. Optionally open **Personalise my plan** (household, health conditions, commute, heating, cooking, budget, your own notes) and press **Update my plan** at the bottom. The advice then fits your home. Without it, a typical household is assumed, and the summary says so with a one-tap **Make it fit my home** link.

The results page opens with the answer and is built to be read in seconds:

- the AQI as a number, a plain-language meaning and a colour scale showing where today sits between clean and hazardous,
- **Do these 3 things first**,
- bars comparing today's exposure on current habits with the plan,
- the cleanest time to go out and a low-emission day plan,
- longer reference sections (indoor air hacks, greener swaps, community actions) folded behind a tap, each with a teaser such as "4 ideas, 3 free". The jump menu opens them. Safety sections (looking after vulnerable people, when to get medical help) are never folded.

## Approach and logic

The design rule is **the model explains; code decides the numbers.**

```text
browser ──► POST /api/plan ──► validate (zod) ──► resolve place + live AQI (Open-Meteo)
                                                        │
                       deterministic engines ◄──────────┘
                       • AQI category + outdoor guidance (stricter for sensitive households)
                       • cleanest 2-hour window from the hourly forecast
                       • impact engine (exposure, CO₂e) from documented factors
                                  │
                 verified facts ──┴──► Claude (structured output, schema-checked)
                                  │            └─ on error / refusal / bad output ─┐
                                  ▼                                                ▼
                               plan JSON ◄────────────── offline rule engine (same schema)
```

- **Logical decisions from context.** The same AQI is judged more cautiously when the household has children, seniors or a heart or lung condition. Advice changes with the air (good air does not alarm; hazardous air says stay in), with budget (a low budget never sees medium or high-cost hacks), with heating and cooking fuel (a wood fire gets a CO alarm and a cleaner-heating swap), and with commute (nobody is told to switch to something dirtier, and walking or cycling is only suggested for short trips).
- **A time window is only suggested when it is clearly cleaner**: two consecutive waking hours in the next 24, at least 10 AQI points better than the worst waking hour, and labelled "tomorrow" when it is. If any hour of that window is still at an "avoid" level, the plan only suggests essential trips with a respirator, never outdoor play. On an "avoid" day, even a safe window is for short essential trips only, so the plan never contradicts its own "keep play indoors" advice.
- **Safety beats emissions.** On "avoid" days the plan never suggests walking or cycling, and the school-run swap becomes carpooling. Fireplace advice only closes the damper once the fire is out and the ashes are cold. These rules live in `src/safety.js` and apply to both paths: the rule engine follows them by construction, Claude is given them in its prompt (and is never handed walking or cycling options on avoid days), and every Claude plan is checked against them. The check reads every text field clause by clause, so "indoors" or "avoid" only counts for the clause it is in, and it recognises times written as 14:00 or 2 pm. A plan that breaks a rule is replaced by the rule engine's plan, with a notice. The check is deliberately strict, so an ambiguous sentence also triggers the fallback.
- **Numbers come from code, not the model.** Every figure on the page (AQI, exposure, CO₂e, the time window) is computed in code and rendered from those values. Claude receives the same figures as `<facts>` and is told to quote only them. Its output is checked against the plan schema, which enforces structure (for example, medical red flags can never be empty) but cannot prove that every number in its sentences was copied correctly. That residual risk is why the headline figures are always rendered from code.
- **Always useful.** With no API key, or if Claude errors or refuses, the rule engine returns the same plan shape and the UI says which one you got.

### How impact is estimated

| Quantity                 | Method                                                                      |
| ------------------------ | --------------------------------------------------------------------------- |
| Cigarette-equivalents    | 22 µg/m³ of PM2.5 over 24 h ≈ 1 cigarette (Berkeley Earth rule of thumb)    |
| Indoor PM2.5             | ≈ 90% of outdoor with windows open, ≈ 60% closed, about half that with HEPA |
| Respirator outdoors      | A well-fitted N95/FFP2 cuts what you inhale by about 60% in everyday wear   |
| Commute CO₂e (kg per km) | car 0.17, motorbike 0.11, bus 0.10, metro 0.04, walking and cycling 0       |

These are communication aids built from stated assumptions, not medical measurements. The app lists them under **How these numbers are estimated**.

## Running it

Requires Node 22.22.2+, 24.15+ or 26+ (the versions the lint tooling supports).

```bash
npm install
npm start            # http://127.0.0.1:3000, uses the built-in rule engine
```

To enable Claude-written plans:

```bash
export ANTHROPIC_API_KEY=your-key
npm start
```

| Variable            | Default             | Purpose                                                                             |
| ------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | unset               | Enables Claude; without it the rule engine runs                                     |
| `ANTHROPIC_MODEL`   | `claude-opus-5-5`   | Model used for plans                                                                |
| `DISABLE_LLM`       | unset               | Set to `1` to force the rule engine                                                 |
| `PORT`, `HOST`      | `3000`, `127.0.0.1` | Where the server listens                                                            |
| `TRUST_PROXY`       | unset               | Set to `1` only behind a proxy that appends the client address to `X-Forwarded-For` |

## Project layout

```text
src/
  server.js      HTTP server, routing, security headers, static files
  planner.js     orchestrates one request
  airData.js     Open-Meteo geocoding + air quality, cleanest-window search
  aqi.js         AQI categories (with plain-language meanings), PM2.5 conversion
  impact.js      deterministic exposure and CO₂e engine
  rules.js       offline plan builder (same schema as Claude)
  safety.js      safety rules shared by both paths, and the check every Claude plan must pass
  llm.js         Claude call: prompt, structured output, refusal handling
  profile.js     request validation and defaults
  planSchema.js  plan shape shared by Claude and the rule engine
  rateLimit.js   fixed-window limiter
public/          accessible, framework-free front end (ES modules)
test/            node:test suite
```

## Security

- API key stays server-side; the browser never sees it.
- All input is validated with Zod (types, ranges, enums, length limits) and control characters are stripped.
- User free text is passed to Claude in a separate `<user_notes>` block, treated as data, with angle brackets neutralised so it cannot close its own tag. The model's output is schema-validated before use.
- Strict Content-Security-Policy (no inline scripts or styles), `nosniff`, `no-referrer`, frame blocking and a narrow Permissions-Policy.
- Server text is inserted into the page only via `textContent`, never as HTML.
- Body-size limit (16 KB), JSON-only content type, per-client rate limits (plan requests are limited most tightly because they can call a paid API), and path-traversal-safe static serving.
- Errors returned to clients are generic; logs never contain profiles or model output.
- Nothing is stored on the server. Answers are remembered only in the user's own browser (`localStorage`) and can be cleared from the footer. Browser location is rounded to about 1 km before it is sent.

## Accessibility

Semantic landmarks and a skip link; collapsible sections use the WAI-ARIA disclosure pattern (a button inside a real heading, with `aria-expanded` and `aria-controls`); the AQI scale and impact bars are decorative (`aria-hidden`) because the same facts are given in text; busy buttons say what is happening and the form is marked `aria-busy`; every control has a visible label and hint; fieldsets and legends group questions; live regions announce progress and errors; focus moves to the results heading; air quality is conveyed by text and number, never colour alone; 44 px touch targets; visible focus rings; light and dark themes; reduced-motion support; layouts work from small phones upwards; the forecast is a real table with a caption and column headers.

## Testing

```bash
npm test      # 92 tests, offline, no API key needed
npm run lint  # ESLint, Stylelint, HTMLHint, Prettier, cspell
```

The suite uses Node's built-in runner, a fake Open-Meteo and a fake Claude client, and jsdom for the UI. It covers AQI banding, the impact maths, validation and sanitising, upstream failures, the rule engine across AQI levels and household types, Claude request shape and prompt-injection handling, fallbacks on error, refusal and invalid output, every HTTP security behaviour (headers, 400, 404, 405, 413, 415, 429, traversal), safe rendering, collapsible sections and the jump menu, and AQI scale positioning.

## Assumptions and limits

- AQI and PM2.5 come from Open-Meteo's global model, so values near a city can differ from a local monitor. A manual AQI field lets people enter their own reading, which also makes the app work offline.
- The US EPA AQI scale is used everywhere.
- When the user doesn't personalise, a typical household is assumed: two adults, no children, an 8 km car commute five days a week, electric heating, gas cooking and a medium budget.
- Impact figures are rule-of-thumb estimates; guidance is general wellbeing information, not medical advice. Red-flag symptoms and "get medical help" guidance are always shown.
- Behind a proxy (`TRUST_PROXY=1`) the right-most `X-Forwarded-For` entry is used, because left-hand entries can be forged by the client. Only enable it when the proxy **appends** the connecting client's address to `X-Forwarded-For`. A proxy that passes a client-supplied header through unchanged would let clients choose their own rate-limit key.
- A manual AQI is used once and never remembered, so a later visit always checks the live air.
- Rate limiting is in-memory and per process; run behind a shared limiter if you scale to several instances.
- The Claude path is exercised in tests with a fake client. Set `ANTHROPIC_API_KEY` to use it for real.
