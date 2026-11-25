<p align="center">
  <img src="assets/logo.svg" alt="Oxygenated Routine logo" width="120" height="120" />
</p>

# Oxygenated Routine

**Live app:** [oxygenated-routine.vercel.app](https://oxygenated-routine.vercel.app)

A calm, zero-signup clean-air assistant that turns live air-quality readings into a concrete, personalised daily plan for families and communities — complete with interactive charts, a live exposure simulator, read-aloud audio, dark mode, country-specific medical helplines, and an offline rule engine.

Type your city, tap **Use my location**, or pick a preset city — and get a complete plan in seconds.

## Table of contents

- [Why it exists](#why-it-exists)
- [Effortless to use (1-step flow)](#effortless-to-use-1-step-flow)
- [What makes it stand out](#what-makes-it-stand-out)
- [Accessibility & inclusive design](#accessibility--inclusive-design)
- [Architecture: the model explains, code decides the numbers](#architecture-the-model-explains-code-decides-the-numbers)
- [Security & privacy](#security--privacy)
- [Code quality, linting, CI & 208-test suite](#code-quality-linting-ci--208-test-suite)
- [Running locally](#running-locally)
- [Project layout](#project-layout)
- [Assumptions & limits](#assumptions--limits)

## Why it exists

During severe winter smog or urban pollution spikes, raw AQI numbers leave families guessing: _Can the kids play outside? When should we air the house? Does a purifier or mask actually change anything?_

**Oxygenated Routine** answers those questions in plain language — showing **what to do first**, **when to go out**, **what is in the air**, and **how much each habit lowers your daily exposure**.

## Effortless to use (1-step flow)

1. **Zero sign-up, zero friction:** Open the app and type your city (with live autocomplete disambiguation), tap **Use my location**, or tap a quick-start chip (**Delhi**, **Lahore**, **Beijing**).
2. **Instant heuristic action plan (zero LLM wait):** Press **Get my plan**. Your initial plan—AQI, top 3 actions, exposure comparison, and cleanest window—is computed **instantly** by the deterministic rule engine, with no waiting for a generative model.
3. **Calm, explorable dropdowns (no information bombing):** Deeper details—pollutant breakdown vs. WHO limits, interactive **"What-if"** protection simulator, commute CO₂e savings, 24-hour forecast chart & table, indoor air hacks, and greener swaps—tuck neatly into accessible dropdowns you open only when you want them.
4. **Model-based follow-up chat (`Gemini 3.1 Flash-Lite`):** Scroll to **Ask a follow-up question** at the bottom to chat with Gemini 3.1 Flash-Lite about your specific home, kids, symptoms, or schedule—or tap a quick-question chip.
5. **Optional 30-second personalisation:** Expand **Personalise my plan** to tailor advice to your household (adults, children under 12, adults 65+, asthma/COPD/heart disease/allergies/pregnancy), commute mode & distance, winter heating, cooking fuel, budget, purifier ownership, and free-text notes.
6. **Offline & resilient:**
   - **Last-plan caching:** Your most recent plan is saved locally in your browser so reloading offline still shows your guidance.
   - **Manual AQI mode:** Enter your own `0–500` AQI reading to skip live network lookups completely.
   - **One-click recovery:** If a network or upstream error occurs, the alert offers **Try again** and **Enter AQI manually** buttons right away.

## What makes it stand out

### Interactive graphs & live "What-if" simulator

- **24-Hour AQI Forecast Chart (SVG):** Plots the next 24 hours of AQI with EPA threshold grid lines, highlights the **cleanest 2-hour waking window**, and updates a live readout as you hover, tap, or keyboard-focus any hour.
- **Pollutant vs. WHO Guideline Chart:** Compares live `PM2.5`, `PM10`, and `NO₂` against WHO 24-hour guidelines (`15`, `45`, and `25 µg/m³`) with `× WHO limit` badges and plain-language explanations.
- **Interactive "What-if" Protection Simulator:** Toggle _Keep windows closed_, _Run HEPA / box-fan purifier_, and _Wear local respirator outdoors_ to watch your daily cigarette-equivalent dose and percentage reduction recalculate live.
- **Commute CO₂e Comparison Chart:** Visualises weekly carbon savings across feasible greener commute swaps (working from home, metro, bus, cycling, walking).

### Location-specific & pollutant-aware intelligence

- **Regional Smog Profiles:** Automatically adapts to **South Asia**, **East Asia**, **Europe & UK**, **North America**, **Southeast Asia**, or **Global** urban profiles — adjusting respirator standards (`N95 / KN95`, `KF94`, `FFP2`), dominant local smog drivers, local monitoring feeds (e.g., CPCB/SAFAR, UK-AIR, AirNow.gov, NEA/AQICN), and region-specific tips.
- **Pollutant-Driven Advice:** Adapts recommendations based on whether the dominant pollutant is fine smoke/haze (`PM2.5`), coarse road/construction dust (`PM10`), or traffic/gas (`NO₂`).
- **Country-Specific Medical Helplines:** Beyond listing red-flag symptoms, the **Get medical help if** card displays verified emergency and medical helpline numbers for your country (resolved from country name or Open-Meteo timezone) as clickable `tel:` links.

### Read-aloud audio, dark mode & sharing

- **Built-in Read-Aloud Player (`Listen` / `Pause` / `Resume` / `Stop`):** Powered by the browser's Web Speech API (`public/tts.js`), reading a natural, plain-language summary of your AQI, top 3 actions, cleanest outdoor window, and exposure impact.
- **Automatic Light & Dark Mode:** Follows `prefers-color-scheme: light dark` with calibrated high-contrast palettes in `public/styles.css`.
- **Copy & Print Ready:** One-click **Copy summary** for family chat groups and a clean `@media print` layout that hides navigation and form chrome for a fridge-ready checklist.

## Accessibility & inclusive design

Accessibility is treated as a first-class engineering requirement, not an afterthought:

| Feature                              | Implementation                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Landmarks & Skip Navigation**      | Semantic `<header>`, `<main>`, `<nav>`, `<section>`, `<footer>`, and a keyboard **Skip to main content** link                                                                              |
| **Accessible Combobox Autocomplete** | `role="combobox"`, `aria-autocomplete="list"`, `aria-controls`, `aria-expanded`, and `aria-activedescendant` keyboard navigation (`ArrowUp`/`ArrowDown`/`Enter`/`Escape`)                  |
| **Interactive Chart Accessibility**  | `<figure role="group">` + `<figcaption>` wrapping keyboard-focusable hour buttons with `:focus-visible` focus rings and live text readouts                                                 |
| **Screen-Reader First**              | Decorative scales and bars use `aria-hidden="true"` while semantic lists, tables (`<caption>`, `scope="col"`), and `aria-live="polite"` / `aria-atomic="true"` regions convey every number |
| **WAI-ARIA Disclosure Cards**        | Long reference sections fold behind real heading buttons (`aria-expanded`, `aria-controls`) and expand automatically from the jump menu                                                    |
| **44 px Touch Targets**              | Interactive controls, chips, helpline links, suggestion items, and toggles enforce `min-height: 2.75rem`                                                                                   |
| **Motion & Contrast Preferences**    | Respects `prefers-reduced-motion: reduce` and supports Windows High Contrast via `@media (forced-colors: active)`                                                                          |
| **Colour Independence**              | Air-quality bands and pollutant levels always pair colour with explicit text labels and numeric values                                                                                     |

## Architecture: the model explains, code decides the numbers

```text
browser ──► POST /api/plan ──► validate (Zod) ──► resolve place + live AQI (Open-Meteo)
                                                        │
                       deterministic engines ◄──────────┘
                       • AQI category & guidance (stricter for sensitive households)
                       • cleanest 2-hour waking window (07:00–21:00)
                       • location & pollutant context + country helplines
                       • exposure (Berkeley Earth) & commute CO₂e (DEFRA/IEA)
                       • instant heuristic plan JSON (zero LLM latency)

browser ──► POST /api/chat ──► Gemini 3.1 Flash-Lite (with plan context + safety audit)
                                      └─ on error / refusal / safety violation ──► deterministic fallback
```

- **Instant first answer, conversational AI when you ask:** `POST /api/plan` always responds instantaneously from the deterministic rule engine (`src/rules.js`), while `POST /api/chat` uses **Gemini 3.1 Flash-Lite** (`src/chat.js`) for natural, context-aware follow-up Q&A.
- **Zero-trust safety guardrails (`src/safety.js`):** On _avoid_ days, walking and cycling are never recommended (including for school runs); unsafe forecast windows never suggest outdoor play; fireplace damper advice always requires no lit fire and cold ashes. Every Gemini response is audited clause-by-clause and automatically replaced by the deterministic rule engine (`src/rules.js`) if any check fails.
- **Always available:** Runs out of the box with no API key using the offline rule engine, or with Gemini when `GEMINI_API_KEY` is configured.

### How impact is estimated

| Quantity               | Method                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Cigarette-equivalents  | `22 µg/m³` of `PM2.5` over 24 h ≈ 1 cigarette (Berkeley Earth rule of thumb)          |
| Indoor `PM2.5`         | ≈ 90% of outdoor with windows open, ≈ 60% closed, and half again with a HEPA purifier |
| Respirator outdoors    | A well-fitted `N95 / FFP2 / KF94` cuts inhaled particles by ≈ 60% in everyday wear    |
| Commute `CO₂e` (kg/km) | Car `0.17`, motorbike `0.11`, bus `0.10`, metro `0.04`, walking and cycling `0`       |

## Security & privacy

- **Server-side secrets:** `GEMINI_API_KEY` never leaves the server.
- **Strict input validation:** All request payloads are validated with Zod (`src/profile.js`) with type, range, enum, and length limits plus control-character stripping.
- **Prompt-injection defence:** User notes travel in an isolated `<user_notes>` XML block with angle brackets neutralised (`src/llm.js`), and model outputs are validated against `PlanSchema` (`src/planSchema.js`).
- **Hardened HTTP headers (`src/server.js`):** Strict `Content-Security-Policy` (`default-src 'self'`, no inline scripts or styles), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`, and a narrow `Permissions-Policy`.
- **XSS-safe DOM rendering (`public/dom.js`):** Server and API strings are always bound via `textContent` / `createTextNode`, never parsed as HTML.
- **Abuse protection & privacy:** 16 KB JSON body limit, strict `application/json` content-type enforcement, per-client rate limiting with `Retry-After` (and proxy-safe `TRUST_PROXY` right-most `X-Forwarded-For` handling), zero server-side user storage, and ~1 km coordinate rounding for browser geolocation.

## Code quality, linting, CI & 208-test suite

```bash
npm test      # 208 tests across 15 test files (offline, no API key needed)
npm run lint  # ESLint + Stylelint + HTMLHint + Prettier + CSpell
```

- **208 Automated Tests (`node --test` + `jsdom`):** Covers AQI banding and EPA breakpoints, cleanest-window edge cases, Berkeley Earth & commute math, regional intelligence & country helplines, Zod 4 validation, rate-limit windowing, safety guardrail clause parsing, rule-engine invariants across all profiles, Gemini 3.1 Flash-Lite plan & follow-up chat handling, HTTP security headers & path-traversal rejection, DOM XSS safety, interactive SVG chart, dropdown & simulator rendering, and Web Speech TTS state transitions.
- **Multi-Layer Static Analysis:**
  - **ESLint** (enforcing cyclomatic complexity `<= 12`)
  - **Stylelint** (`stylelint-config-standard`)
  - **HTMLHint** (`.htmlhintrc`)
  - **Prettier** (`.prettierrc.json`)
  - **CSpell** (`.cspell.json`)
  - **MegaLinter** configuration (`.mega-linter.yml`)
- **Automated PR Review & Security:** Every pull request is reviewed by **CodeRabbit** and scanned by **GitGuardian Security Checks**, with production deployments hosted on **Vercel**.

## Running locally

Requires **Node.js `22.22.2+`, `24.15+`, or `26+`**.

```bash
npm install
npm start            # http://127.0.0.1:3000 (uses built-in rule engine)
```

To enable Gemini-written plans:

```bash
export GEMINI_API_KEY=your-key
npm start
```

| Variable         | Default                 | Purpose                                                                            |
| ---------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `GEMINI_API_KEY` | unset                   | Enables Gemini; without it the deterministic rule engine runs                      |
| `GEMINI_MODEL`   | `gemini-3.1-flash-lite` | Model used for plan generation                                                     |
| `DISABLE_LLM`    | unset                   | Set to `1` to force the offline rule engine                                        |
| `PORT`, `HOST`   | `3000`, `127.0.0.1`     | Server listen host and port                                                        |
| `TRUST_PROXY`    | unset                   | Set to `1` only behind a trusted proxy that appends client IP to `X-Forwarded-For` |

## Project layout

```text
api/
  index.js             Vercel serverless entrypoint
public/
  index.html           Accessible semantic HTML shell
  styles.css           Light/dark theme, print styles, forced-colors, responsive layout
  app.js               Controller: autocomplete, geolocation, caching, error recovery
  charts.js            Interactive SVG forecast chart, WHO pollutant bars, what-if simulator
  chat.js              Accessible follow-up chat UI powered by Gemini 3.1 Flash-Lite
  render.js            XSS-safe DOM renderer, explorable dropdowns, jump nav & helplines
  tts.js               Web Speech API read-aloud controller
  dom.js               Safe DOM & WAI-ARIA disclosure helpers
  form.js              Form serialization & localStorage persistence
src/
  server.js            Hardened HTTP server, routing, CSP & rate limiting
  planner.js           Instant heuristic plan orchestration pipeline
  chat.js              Follow-up chat handler (Gemini 3.1 Flash-Lite + safety guard + fallback)
  airData.js           Open-Meteo geocoding, air quality & cleanest-window finder
  locationContext.js   Regional smog profiles, WHO pollutant analysis & country helplines
  aqi.js               EPA AQI categorization & PM2.5 breakpoint math
  impact.js            Deterministic cigarette-equivalent & CO₂e engine
  rules.js             Offline deterministic plan builder
  safety.js            Zero-trust clause-level safety verifier
  llm.js               Gemini 3.1 Flash-Lite integration with XML boundary neutralisation
  profile.js           Zod request validation & defaults
  planSchema.js        Shared Zod schema for LLM and rule-engine plans
  rateLimit.js         Fixed-window per-client rate limiter
test/                  208 unit, integration, DOM, chat, TTS, and security tests
```

## Assumptions & limits

- Air-quality readings come from Open-Meteo's global model and can differ from a street-level monitor; the manual AQI field (`0–500`) lets users supply their own local reading offline.
- The US EPA AQI scale (`0–500`) is used consistently across the app.
- Requests without personalisation assume a default household (2 adults, 8 km car commute 5 days/week, electric heating, gas cooking, medium budget) and clearly surface a one-tap **Make it fit my home** link.
- Exposure figures are educational communication aids, not medical measurements; red-flag symptoms and local emergency helplines are always displayed.
- In-memory rate limiting is per-process; use a shared store if scaling horizontally across multiple Node instances.
