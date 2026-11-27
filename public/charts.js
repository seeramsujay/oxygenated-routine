/**
 * @fileoverview Interactive, zero-dependency SVG chart & simulator components.
 *
 * All SVG elements are constructed via `document.createElementNS` (no HTML parsing)
 * and styled with the project's existing CSS custom properties and system font.
 * Charts are paired with live text readouts and keyboard/pointer interactivity.
 */
import { el } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const EXPOSURE_FACTORS = Object.freeze({
  INDOOR_OPEN: 0.9,
  INDOOR_SEALED: 0.6,
  PURIFIER_KEEP: 0.5,
  RESPIRATOR_KEEP: 0.4,
  PM25_PER_CIGARETTE: 22,
});

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

function bandColor(aqi) {
  if (aqi <= 50) return 'var(--band-good)';
  if (aqi <= 100) return 'var(--band-moderate)';
  if (aqi <= 150) return 'var(--band-sensitive)';
  if (aqi <= 200) return 'var(--band-unhealthy)';
  if (aqi <= 300) return 'var(--band-very)';
  return 'var(--band-hazardous)';
}

function drawWindowBand(svg, forecast, window, xFor, pad, plotH) {
  if (!window) return;
  const startIdx = forecast.findIndex((h) => h.time.slice(11, 16) === window.start);
  if (startIdx < 0) return;
  const endIdx = Math.min(forecast.length - 1, startIdx + 2);
  const x1 = xFor(startIdx);
  const x2 = xFor(endIdx);
  svg.append(
    svgEl('rect', {
      x: x1,
      y: pad.top,
      width: Math.max(x2 - x1, 14),
      height: plotH,
      rx: 4,
      fill: 'var(--accent)',
      opacity: '0.14',
    }),
    svgEl(
      'text',
      {
        x: (x1 + x2) / 2,
        y: pad.top - 6,
        'text-anchor': 'middle',
        class: 'chart-highlight-label',
      },
      document.createTextNode(`Cleanest (${window.start}–${window.end})`),
    ),
  );
}

function drawGridLines(svg, { yMax, yFor, pad, width }) {
  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', { id: 'aqi-area-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.append(
    svgEl('stop', { offset: '0%', 'stop-color': 'var(--accent)', 'stop-opacity': '0.32' }),
    svgEl('stop', { offset: '100%', 'stop-color': 'var(--accent)', 'stop-opacity': '0.03' }),
  );
  defs.append(grad);
  svg.append(defs);

  const gridTicks = [0, 50, 100, 150, 200, 300, 400, 500].filter((t) => t <= yMax);
  for (const tick of gridTicks) {
    const y = yFor(tick);
    svg.append(
      svgEl('line', {
        x1: pad.left,
        y1: y,
        x2: width - pad.right,
        y2: y,
        stroke: 'var(--border)',
        'stroke-dasharray': tick === 100 || tick === 150 ? '4 3' : undefined,
        'stroke-width': '1',
      }),
      svgEl(
        'text',
        { x: pad.left - 6, y: y + 4, 'text-anchor': 'end', class: 'chart-axis-text' },
        document.createTextNode(String(tick)),
      ),
    );
  }
}

function drawLineAndArea(svg, points, baselineY) {
  const lineD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaD = `${lineD} L${points.at(-1)[0].toFixed(1)},${baselineY.toFixed(1)} L${points[0][0].toFixed(1)},${baselineY.toFixed(1)} Z`;
  svg.append(
    svgEl('path', { d: areaD, fill: 'url(#aqi-area-grad)' }),
    svgEl('path', {
      d: lineD,
      fill: 'none',
      stroke: 'var(--accent)',
      'stroke-width': '2.5',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }),
  );
}

function attachHourDots(svg, forecast, points, { pad, plotW, plotH, height }, readout) {
  const colW = forecast.length > 1 ? plotW / (forecast.length - 1) : plotW;
  forecast.forEach((h, i) => {
    const [cx, cy] = points[i];
    const dot = svgEl('circle', {
      cx: cx.toFixed(1),
      cy: cy.toFixed(1),
      r: '4',
      fill: bandColor(h.aqi),
      stroke: 'var(--surface)',
      'stroke-width': '1.5',
    });
    const hit = svgEl('rect', {
      x: (cx - colW / 2).toFixed(1),
      y: pad.top,
      width: colW.toFixed(1),
      height: plotH,
      fill: 'transparent',
      tabindex: '0',
      role: 'button',
      'aria-label': `${h.time.slice(11, 16)}: AQI ${h.aqi}, ${h.category}`,
    });
    const activate = () => {
      readout.textContent = `${h.time.slice(11, 16)} · AQI ${h.aqi} (${h.category})`;
      dot.setAttribute('r', '6.5');
    };
    const deactivate = () => dot.setAttribute('r', '4');
    hit.addEventListener('pointerenter', activate);
    hit.addEventListener('focus', activate);
    hit.addEventListener('click', activate);
    hit.addEventListener('pointerleave', deactivate);
    hit.addEventListener('blur', deactivate);
    svg.append(dot, hit);

    if (i % 4 === 0 || i === forecast.length - 1) {
      svg.append(
        svgEl(
          'text',
          { x: cx.toFixed(1), y: height - 8, 'text-anchor': 'middle', class: 'chart-axis-text' },
          document.createTextNode(h.time.slice(11, 16)),
        ),
      );
    }
  });
}

/**
 * Interactive 24-hour AQI forecast area/line SVG chart with highlighted cleanest window.
 *
 * @param {Array<{time: string, aqi: number, category: string}>} forecast
 * @param {{start: string, end: string, day: string, avgAqi: number, worstHour: string, worstAqi: number}|null} window
 * @returns {HTMLElement}
 */
export function forecastChart(forecast, window) {
  const width = 640;
  const height = 210;
  const pad = { top: 22, right: 16, bottom: 30, left: 38 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxAqi = Math.max(150, ...forecast.map((h) => h.aqi));
  const yMax = Math.ceil(maxAqi / 50) * 50;
  const xFor = (i) => pad.left + (forecast.length > 1 ? (i / (forecast.length - 1)) * plotW : plotW / 2);
  const yFor = (aqi) => pad.top + plotH - (Math.min(aqi, yMax) / yMax) * plotH;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart-svg' });
  drawGridLines(svg, { yMax, yFor, pad, width });
  drawWindowBand(svg, forecast, window, xFor, pad, plotH);

  const points = forecast.map((h, i) => [xFor(i), yFor(h.aqi)]);
  drawLineAndArea(svg, points, pad.top + plotH);

  const defaultMsg = window
    ? `Cleanest window: ${window.day === 'tomorrow' ? 'tomorrow ' : ''}${window.start}–${window.end} (avg AQI ${window.avgAqi}). Hover or tap any hour to inspect.`
    : 'Hover or tap any hour on the chart to inspect its forecast AQI.';
  const readout = el('p', { className: 'chart-readout', text: defaultMsg, attrs: { 'aria-live': 'polite' } });

  attachHourDots(svg, forecast, points, { pad, plotW, plotH, height }, readout);

  return el(
    'figure',
    {
      className: 'chart-box',
      attrs: {
        role: 'group',
        'aria-label': `24-hour AQI forecast from ${forecast[0]?.time.slice(11, 16) ?? ''} to ${forecast.at(-1)?.time.slice(11, 16) ?? ''}`,
      },
    },
    svg,
    el('figcaption', {}, readout),
  );
}

/**
 * Pollutant-vs-WHO-guideline horizontal bar chart.
 *
 * @param {Array<{id: string, label: string, value: number, unit: string, whoGuideline: number, ratioToWho: number, meaning: string}>} items
 * @returns {HTMLElement|null}
 */
export function pollutantChart(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const maxRatio = Math.max(2, ...items.map((p) => p.ratioToWho));

  const rows = items.map((p) => {
    const pct = Math.min(100, Math.max(4, Math.round((p.ratioToWho / maxRatio) * 100)));
    const whoPct = Math.round((1 / maxRatio) * 100);
    const bar = el(
      'div',
      { className: 'pollutant-track', attrs: { 'aria-hidden': 'true' } },
      el('div', {
        className: `pollutant-fill ${p.ratioToWho <= 1 ? 'tone-good' : p.ratioToWho <= 2.5 ? 'tone-warn' : 'tone-bad'}`,
      }),
      el('span', { className: 'who-marker', attrs: { title: `WHO 24h guideline: ${p.whoGuideline} ${p.unit}` } }),
    );
    bar.firstChild.style.inlineSize = `${pct}%`;
    bar.lastChild.style.insetInlineStart = `${whoPct}%`;

    const badge = p.ratioToWho > 1 ? `${p.ratioToWho}× WHO limit` : `Within WHO limit (${p.whoGuideline} ${p.unit})`;

    return el(
      'li',
      { className: 'pollutant-row' },
      el(
        'div',
        { className: 'pollutant-head' },
        el('strong', { text: p.label }),
        el('span', { className: 'pollutant-val', text: `${p.value} ${p.unit} · ${badge}` }),
      ),
      bar,
      el('p', { className: 'hint', text: p.meaning }),
    );
  });

  return el('ul', { className: 'pollutant-list' }, ...rows);
}

/**
 * Interactive "What-If" exposure simulator + visual comparison bars.
 * Mirrors the exact deterministic formulas from `src/impact.js`.
 *
 * @param {object} data Full API response
 * @returns {HTMLElement}
 */
export function exposureSimulator(data) {
  const { impact, air, guidance, locationContext } = data;
  const pm25 = impact.outdoorPm25;
  const outdoorHours = impact.outdoorHours ?? 2;
  const maskLabel = locationContext?.region?.respirator ?? 'N95 / FFP2';

  const computeSim = (closedWindows, purifier, respirator) => {
    const indoorRatio =
      (closedWindows ? EXPOSURE_FACTORS.INDOOR_SEALED : EXPOSURE_FACTORS.INDOOR_OPEN) *
      (purifier ? EXPOSURE_FACTORS.PURIFIER_KEEP : 1);
    const respFactor = respirator ? EXPOSURE_FACTORS.RESPIRATOR_KEEP : 1;
    const mean = (pm25 * outdoorHours * respFactor + pm25 * indoorRatio * (24 - outdoorHours)) / 24;
    return Math.round((mean / EXPOSURE_FACTORS.PM25_PER_CIGARETTE) * 10) / 10;
  };

  const unprotected = impact.exposure.standingOutsideAllDayCigarettes;
  const current = impact.exposure.todayCurrentHabitsCigarettes;
  const maxVal = Math.max(unprotected, current, 0.1);

  const mkToggle = (id, label, checked) => {
    const input = el('input', { attrs: { type: 'checkbox', id } });
    input.checked = checked;
    return { input, label: el('label', { className: 'sim-toggle' }, input, document.createTextNode(label)) };
  };

  const tWindows = mkToggle('sim-windows', 'Keep windows closed', true);
  const tPurifier = mkToggle('sim-purifier', 'Run HEPA / box-fan purifier', true);
  const tMask = mkToggle('sim-mask', `Wear ${maskLabel} outdoors`, guidance !== 'normal');

  const simFill = el('span', { className: 'sim-bar-fill' });
  const simBar = el('div', { className: 'sim-bar-track', attrs: { 'aria-hidden': 'true' } }, simFill);
  const simValue = el('strong', { className: 'sim-value' });
  const simDelta = el('span', { className: 'hint' });

  const update = () => {
    const cigs = computeSim(tWindows.input.checked, tPurifier.input.checked, tMask.input.checked);
    const pct = Math.min(100, Math.max(3, Math.round((cigs / maxVal) * 100)));
    simFill.style.inlineSize = `${pct}%`;
    simValue.textContent = `${cigs} cigarette-equivalents / day`;
    if (cigs < current) {
      const drop = current > 0 ? Math.round((1 - cigs / current) * 100) : 0;
      simDelta.textContent = ` (${drop}% lower than current habits at AQI ${air.aqi})`;
    } else if (cigs > current) {
      const rise = current > 0 ? Math.round((cigs / current - 1) * 100) : 0;
      simDelta.textContent = ` (${rise}% higher than current habits at AQI ${air.aqi})`;
    } else {
      simDelta.textContent = ` (same as current habits at AQI ${air.aqi})`;
    }
  };

  for (const t of [tWindows, tPurifier, tMask]) {
    t.input.addEventListener('change', update);
  }
  update();

  return el(
    'div',
    { className: 'sim-box' },
    el('h3', { text: 'Interactive “What-if” protection simulator' }),
    el('p', { className: 'hint', text: 'Toggle protections below to see how each step cuts your daily PM2.5 dose:' }),
    el('div', { className: 'sim-controls' }, tWindows.label, tPurifier.label, tMask.label),
    el(
      'div',
      { className: 'sim-result' },
      el(
        'div',
        { className: 'sim-readout', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' } },
        simValue,
        simDelta,
      ),
      simBar,
    ),
  );
}

/**
 * Commute weekly CO2e comparison bar chart.
 *
 * @param {{ currentKgCo2ePerWeek: number, alternatives: Array<{mode: string, savedKgPerWeek: number, savedKgPerWinter: number}> }} commute
 * @param {Record<string, string>} modeLabel
 * @returns {HTMLElement|null}
 */
export function commuteChart(commute, modeLabel) {
  if (!commute || commute.alternatives.length === 0 || commute.currentKgCo2ePerWeek <= 0) return null;
  const maxKg = commute.currentKgCo2ePerWeek;

  const row = (label, kg, highlight) => {
    const pct = Math.max(2, Math.round((kg / maxKg) * 100));
    const track = el(
      'div',
      { className: 'commute-track', attrs: { 'aria-hidden': 'true' } },
      el('span', { className: 'commute-fill' }),
    );
    track.firstChild.style.inlineSize = `${pct}%`;
    return el(
      'div',
      { className: `commute-row${highlight ? ' highlight' : ''}` },
      el('span', { className: 'commute-label', text: label }),
      track,
      el('span', { className: 'commute-kg', text: `${kg} kg CO₂/wk` }),
    );
  };

  const rows = [
    row('Current commute', maxKg, false),
    ...commute.alternatives.slice(0, 3).map((alt) => {
      const remaining = Math.max(0, Math.round((maxKg - alt.savedKgPerWeek) * 10) / 10);
      return row(modeLabel[alt.mode] ?? alt.mode, remaining, true);
    }),
  ];

  return el('div', { className: 'commute-chart' }, ...rows);
}
