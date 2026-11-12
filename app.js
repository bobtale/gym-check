/**
 * Gym Check user interface: import, local storage, settings, rendering, charts and service worker registration.
 * All imported data stays in the browser; foreign text is only written via textContent.
 * @module app
 */

import { parseHevyCsv } from './parse.js';
import { MUSCLE_GROUPS } from './muscles.js';
import { initEffects, updateNav, countUp, prefersReducedMotion } from './effects.js';
import { t, setLanguage, language, locale, LANGUAGES, DEFAULT_LANGUAGE } from './i18n.js';
import {
  overview, timeSeries, exerciseList, exerciseHistory, muscleVolume, funFacts, muscleGainEstimate, heatmap,
} from './stats.js';

const STORAGE = { csv: 'gymcheck.csv', meta: 'gymcheck.meta', settings: 'gymcheck.settings', lang: 'gymcheck.lang' };
const STORAGE_PREFIX = 'gymcheck.';
const DEFAULT_SETTINGS = { sex: 'm', bodyWeightKg: null, experience: 'beginner' };
const EXPERIENCES = ['beginner', 'some', 'advanced'];
const I18N_ATTRIBUTES = ['aria-label', 'placeholder', 'title'];

let nf0;
let nf1;
let nf2;
let nfSigned;

const state = {
  data: null,
  meta: null,
  settings: { ...DEFAULT_SETTINGS },
  period: 'week',
  exerciseKey: null,
  animateCounts: false,
};

const charts = new Map();

/**
 * Builds the number formatters for the locale of the current language.
 * @returns {void}
 */
function createNumberFormats() {
  nf0 = new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 });
  nf1 = new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  nf2 = new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  nfSigned = new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
}

/**
 * Shorthand for document.getElementById.
 * @param {string} id Element id.
 * @returns {HTMLElement} Element.
 */
function $(id) {
  return document.getElementById(id);
}

/**
 * Reads a value from localStorage.
 * @param {string} key Storage key.
 * @returns {string|null} Stored value or null if missing or storage is unavailable.
 */
function loadItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes a value to localStorage.
 * @param {string} key Storage key.
 * @param {string} value Value.
 * @returns {boolean} False if storage is full or unavailable.
 */
function saveItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes a value from localStorage.
 * @param {string} key Storage key.
 * @returns {void}
 */
function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    return;
  }
}

/**
 * Removes all Gym Check keys from localStorage.
 * @returns {void}
 */
function removeAllItems() {
  let keys = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(STORAGE_PREFIX));
  } catch {
    keys = Object.values(STORAGE);
  }
  keys.forEach(removeItem);
}

/**
 * Reads and parses a JSON value from localStorage.
 * @param {string} key Storage key.
 * @returns {*} Parsed value or null.
 */
function loadJson(key) {
  try {
    return JSON.parse(loadItem(key));
  } catch {
    return null;
  }
}

/**
 * Loads the user settings and falls back to defaults for invalid values.
 * @returns {{sex: 'm'|'w', bodyWeightKg: number|null, experience: string}} Settings.
 */
function loadSettings() {
  const stored = loadJson(STORAGE.settings) ?? {};
  return {
    sex: stored.sex === 'w' ? 'w' : 'm',
    bodyWeightKg: Number.isFinite(stored.bodyWeightKg) && stored.bodyWeightKg > 0 ? stored.bodyWeightKg : null,
    experience: EXPERIENCES.includes(stored.experience) ? stored.experience : DEFAULT_SETTINGS.experience,
  };
}

/**
 * Creates an element with optional class and text content.
 * @param {string} tag Tag name.
 * @param {string} [className] CSS class.
 * @param {string} [text] Text content.
 * @returns {HTMLElement} Element.
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * Formats a date in the locale of the current language.
 * @param {Date} date Date.
 * @returns {string} Date text.
 */
function formatDate(date) {
  return date.toLocaleDateString(locale());
}

/**
 * Formats a duration in seconds as minutes and seconds.
 * @param {number} seconds Duration.
 * @returns {string} Duration text.
 */
function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')} min` : `${rest} s`;
}

/**
 * Formats a number of weeks.
 * @param {number} n Weeks.
 * @returns {string} Text such as "3 Wochen".
 */
function formatWeeks(n) {
  return t('weeks', n, nf0.format(n));
}

/**
 * Creates a key figure card; with `count` the value counts up once visible, but only right after an import or start.
 * @param {string} label Label.
 * @param {string} value Value (final text).
 * @param {string} [sub] Additional line.
 * @param {{to: number, format: function(number): string}} [count] Target number and formatter for the count-up.
 * @returns {HTMLElement} Card element.
 */
function kpiCard(label, value, sub, count) {
  const card = el('div', 'kpi');
  const valueNode = el('span', 'kpi-value', value);
  card.append(el('span', 'kpi-label', label), valueNode);
  if (sub) {
    card.append(el('span', 'kpi-sub', sub));
  }
  if (count && state.animateCounts) {
    countUp(valueNode, count.to, count.format);
  }
  return card;
}

/**
 * Fills a definition list with label/value pairs.
 * @param {HTMLElement} dl Definition list.
 * @param {[string, string][]} entries Label/value pairs.
 * @returns {void}
 */
function fillDefinitions(dl, entries) {
  dl.replaceChildren(...entries.flatMap(([label, value]) => [el('dt', '', label), el('dd', '', value)]));
}

/**
 * Creates a table row from cell texts; cells after the first are right-aligned if `numeric` is set.
 * @param {(string|HTMLElement)[]} cells Cell texts or prepared cells.
 * @param {boolean} [numeric] Right-align all but the first cell.
 * @returns {HTMLTableRowElement} Row.
 */
function tableRow(cells, numeric = false) {
  const tr = document.createElement('tr');
  cells.forEach((cell, i) => {
    const td = cell instanceof HTMLElement ? cell : el('td', numeric && i > 0 ? 'num' : '', cell);
    tr.append(td);
  });
  return tr;
}

/**
 * Reads a CSS custom property of the root element.
 * @param {string} name Property name including "--".
 * @returns {string} Value.
 */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Returns the chart color of a muscle group.
 * @param {string} group Muscle group.
 * @returns {string} CSS color.
 */
function groupColor(group) {
  return cssVar(`--group-${MUSCLE_GROUPS.indexOf(group)}`);
}

/**
 * Returns the display name of a muscle group in the current language.
 * @param {string} group Muscle group id (German name from muscles.js).
 * @returns {string} Display name.
 */
function groupLabel(group) {
  return t('muscleGroups')[group] ?? group;
}

/**
 * Applies theme colors and locale to the Chart.js defaults.
 * @returns {void}
 */
function applyChartTheme() {
  if (!window.Chart) {
    return;
  }
  window.Chart.defaults.color = cssVar('--muted');
  window.Chart.defaults.borderColor = cssVar('--grid');
  window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  window.Chart.defaults.locale = locale();
  if (prefersReducedMotion()) {
    window.Chart.defaults.animation = false;
  }
}

/**
 * Destroys the chart on a canvas, if any.
 * @param {string} id Canvas id.
 * @returns {void}
 */
function destroyChart(id) {
  charts.get(id)?.destroy();
  charts.delete(id);
}

/**
 * Destroys all charts.
 * @returns {void}
 */
function destroyCharts() {
  [...charts.keys()].forEach(destroyChart);
}

/**
 * Draws a chart on a canvas, replacing an existing one; shows a notice if Chart.js is not loaded.
 * @param {string} id Canvas id.
 * @param {object} config Chart.js configuration.
 * @returns {void}
 */
function renderChart(id, config) {
  destroyChart(id);
  const canvas = $(id);
  const box = canvas.parentElement;
  if (!window.Chart) {
    canvas.hidden = true;
    box.classList.add('offline');
    const fallback = box.querySelector('.chart-fallback') ?? box.appendChild(el('p', 'chart-fallback'));
    fallback.textContent = t('chart.offline');
    return;
  }
  charts.set(id, new window.Chart(canvas, {
    ...config,
    options: { responsive: true, maintainAspectRatio: false, ...config.options },
  }));
}

/**
 * Builds a single-series bar chart configuration.
 * @param {string[]} labels Category labels.
 * @param {number[]} values Values.
 * @param {string} label Series label.
 * @returns {object} Chart.js configuration.
 */
function barConfig(labels, values, label) {
  return {
    type: 'bar',
    data: { labels, datasets: [{ label, data: values, backgroundColor: cssVar('--accent') }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  };
}

/**
 * Builds a line chart configuration over time with timestamps on a linear x axis.
 * @param {{x: Date, y: number}[]} points Data points.
 * @param {string} label Series label.
 * @returns {object} Chart.js configuration.
 */
function timeLineConfig(points, label) {
  return {
    type: 'line',
    data: {
      datasets: [{
        label,
        data: points.map((p) => ({ x: p.x.getTime(), y: p.y })),
        borderColor: cssVar('--accent'),
        backgroundColor: cssVar('--accent'),
        pointRadius: 3,
        tension: 0.2,
      }],
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (items) => formatDate(new Date(items[0].parsed.x)) } },
      },
      scales: {
        x: { type: 'linear', ticks: { callback: (v) => formatDate(new Date(v)), maxTicksLimit: 5 } },
        y: { beginAtZero: false },
      },
    },
  };
}

/**
 * Shows or hides the import error.
 * @param {string|null} message Error text or null to hide.
 * @returns {void}
 */
function showError(message) {
  const node = $('import-error');
  node.textContent = message ?? '';
  node.hidden = !message;
}

/**
 * Shows or hides the storage warning.
 * @param {boolean} visible True to show.
 * @returns {void}
 */
function showStorageWarning(visible) {
  const node = $('storage-warning');
  node.textContent = visible ? t('storageWarning') : '';
  node.hidden = !visible;
}

/**
 * Renders the import section (picker or summary).
 * @returns {void}
 */
function renderImport() {
  const { data, meta } = state;
  $('import-picker').hidden = !!data;
  $('import-summary').hidden = !data;
  if (!data) {
    return;
  }
  const first = data.workouts[0].start;
  const last = data.workouts[data.workouts.length - 1].start;
  $('sum-file').textContent = meta?.fileName ?? '–';
  $('sum-imported').textContent = meta?.importedAt ? new Date(meta.importedAt).toLocaleString(locale()) : '–';
  $('sum-workouts').textContent = nf0.format(data.workouts.length);
  $('sum-sets').textContent = nf0.format(data.setCount);
  $('sum-exercises').textContent = nf0.format(data.exercises.size);
  $('sum-range').textContent = `${formatDate(first)} – ${formatDate(last)}`;
  $('import-warnings').replaceChildren(...data.warnings.map((w) => el('li', '', t(w.key, ...w.args))));
}

/**
 * Renders the overview key figures.
 * @returns {void}
 */
function renderOverview() {
  const o = overview(state.data, state.settings, new Date());
  $('kpis').replaceChildren(
    kpiCard(t('kpi.workouts'), nf0.format(o.workouts), undefined, { to: o.workouts, format: (n) => nf0.format(n) }),
    kpiCard(t('kpi.time'), `${nf1.format(o.totalMinutes / 60)} h`, undefined,
      { to: o.totalMinutes / 60, format: (n) => `${nf1.format(n)} h` }),
    kpiCard(t('kpi.volume'), `${nf1.format(o.volumeKg / 1000)} t`, t('kpi.volumeSub'),
      { to: o.volumeKg / 1000, format: (n) => `${nf1.format(n)} t` }),
    kpiCard(t('kpi.workSets'), nf0.format(o.workSets), t('kpi.workSetsSub'), { to: o.workSets, format: (n) => nf0.format(n) }),
    kpiCard(t('kpi.reps'), nf0.format(o.reps), undefined, { to: o.reps, format: (n) => nf0.format(n) }),
    kpiCard(t('kpi.avgWorkouts'), nf1.format(o.avgWorkoutsPerWeek), t('kpi.overWeeks', formatWeeks(o.weeks)),
      { to: o.avgWorkoutsPerWeek, format: (n) => nf1.format(n) }),
    kpiCard(t('kpi.avgDuration'), o.avgDurationMin === null ? '–' : `${nf0.format(o.avgDurationMin)} min`, undefined,
      o.avgDurationMin === null ? undefined : { to: o.avgDurationMin, format: (n) => `${nf0.format(n)} min` }),
    kpiCard(t('kpi.avgSets'), nf1.format(o.avgSetsPerWorkout), undefined,
      { to: o.avgSetsPerWorkout, format: (n) => nf1.format(n) }),
    kpiCard(t('kpi.longestStreak'), formatWeeks(o.longestStreak), t('kpi.streakSub'),
      { to: o.longestStreak, format: (n) => formatWeeks(Math.round(n)) }),
    kpiCard(t('kpi.currentStreak'), formatWeeks(o.currentStreak), undefined,
      { to: o.currentStreak, format: (n) => formatWeeks(Math.round(n)) }),
    kpiCard(t('kpi.first'), formatDate(o.first)),
    kpiCard(t('kpi.last'), formatDate(o.last)),
    kpiCard(t('kpi.favorite'), o.favorite.name, t('kpi.inWorkouts', nf0.format(o.favorite.workouts))),
    kpiCard(t('kpi.weekday'), o.topWeekday.name, t('kpi.workoutsCount', nf0.format(o.topWeekday.count))),
    kpiCard(t('kpi.dayTime'), o.topDayTime.name, t('kpi.workoutsCount', nf0.format(o.topDayTime.count))),
  );
  $('overview-note').hidden = !o.assistedWithoutWeight;
}

/**
 * Renders the training heatmap.
 * @returns {void}
 */
function renderHeatmap() {
  const { cells } = heatmap(state.data);
  const node = $('heatmap');
  node.replaceChildren(...cells.map((c) => {
    const cell = el('i', `lvl-${c.level}`);
    cell.title = c.trained ? t('heatmap.sets', formatDate(c.date), nf0.format(c.sets)) : t('heatmap.none', formatDate(c.date));
    return cell;
  }));
  node.scrollLeft = node.scrollWidth;
}

/**
 * Renders the history section (workouts, volume, duration, heatmap).
 * @returns {void}
 */
function renderHistory() {
  const series = timeSeries(state.data, state.settings);
  const periods = state.period === 'month' ? series.months : series.weeks;
  document.querySelectorAll('[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === state.period)));
  renderChart('chart-workouts', barConfig(periods.map((p) => p.label), periods.map((p) => p.workouts), t('chart.workouts')));
  renderChart('chart-volume', barConfig(series.weeks.map((w) => w.label), series.weeks.map((w) => Math.round(w.volumeKg)), t('chart.volume')));
  renderChart('chart-duration', {
    type: 'line',
    data: {
      labels: series.weeks.map((w) => w.label),
      datasets: [{
        label: t('chart.duration'),
        data: series.weeks.map((w) => (w.avgDurationMin === null ? null : Math.round(w.avgDurationMin))),
        borderColor: cssVar('--accent'),
        backgroundColor: cssVar('--accent'),
        spanGaps: true,
        pointRadius: 2,
        tension: 0.2,
      }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
  renderHeatmap();
}

/**
 * Builds the record rows of an exercise history.
 * @param {object} h Exercise history.
 * @returns {[string, string, Date][]} Label, value text and date.
 */
function recordRows(h) {
  const { prs, info, assistOnly } = h;
  const rows = [];
  if (prs.heaviest) {
    const label = assistOnly ? t('pr.lowestAssist') : info.assisted ? t('pr.highestEffective') : t('pr.heaviest');
    rows.push([label, `${nf1.format(prs.heaviest.value)} kg`, prs.heaviest.date]);
  }
  if (prs.e1rm) {
    rows.push([t('pr.e1rm'), `${nf1.format(prs.e1rm.value)} kg`, prs.e1rm.date]);
  }
  if (prs.reps) {
    rows.push([t('pr.reps'), nf0.format(prs.reps.value), prs.reps.date]);
  }
  if (prs.volume) {
    rows.push([t('pr.volume'), `${nf0.format(prs.volume.value)} kg`, prs.volume.date]);
  }
  if (prs.duration) {
    rows.push([t('pr.duration'), formatDuration(prs.duration.value), prs.duration.date]);
  }
  if (prs.distance) {
    rows.push([t('pr.distance'), `${nf2.format(prs.distance.value)} km`, prs.distance.date]);
  }
  return rows;
}

/**
 * Renders the exercise section for the selected exercise.
 * @returns {void}
 */
function renderExercises() {
  const list = exerciseList(state.data);
  if (!list.some((e) => e.key === state.exerciseKey)) {
    state.exerciseKey = list[0]?.key ?? null;
  }
  const select = $('exercise-select');
  select.replaceChildren(...list.map((e) => {
    const option = el('option', '', `${e.name} (${e.sessions})`);
    option.value = e.key;
    return option;
  }));
  select.value = state.exerciseKey;

  const h = exerciseHistory(state.data, state.exerciseKey, state.settings);
  $('exercise-meta').textContent = t('ex.meta', groupLabel(h.info.group), nf0.format(h.sessions.length));

  const hints = [];
  if (h.metric === 'e1rm') {
    hints.push(`${t('ex.hintE1rm')}${h.repCapHit ? t('ex.hintRepCap') : ''}`);
  }
  if (h.assistOnly) {
    hints.push(t('ex.hintAssistOnly'));
  } else if (h.info.assisted) {
    hints.push(t('ex.hintAssisted'));
  }
  $('exercise-hints').replaceChildren(...hints.map((text) => el('li', '', text)));

  const imp = h.improvement;
  const metricName = h.info.assisted ? t('metricName.assist') : t(`metricName.${h.metric}`);
  $('exercise-improvement').textContent = !imp ? t('ex.tooLittle') : imp.percent === null ? '–' : t('pct', nfSigned.format(imp.percent));
  $('exercise-improvement-sub').textContent = imp
    ? `${metricName}, ${imp.method === 'avg3' ? t('ex.avg3') : t('ex.firstLast')}`
    : metricName;

  $('ex-main-title').textContent = t(`metricTitle.${h.metric}`);
  const mainPoints = h.metric === 'duration' ? h.series.map((p) => ({ x: p.x, y: Math.round((p.y / 60) * 10) / 10 })) : h.series;
  renderChart('chart-ex-main', timeLineConfig(mainPoints, t(`metricTitle.${h.metric}`)));

  const topPoints = h.sessions.filter((s) => s.topLoad !== null).map((s) => ({ x: s.date, y: s.topLoad }));
  const showTop = h.metric === 'e1rm' && topPoints.length > 0;
  $('ex-top-card').hidden = !showTop;
  if (showTop) {
    renderChart('chart-ex-top', timeLineConfig(topPoints, t('ex.topTitle')));
  } else {
    destroyChart('chart-ex-top');
  }

  const volumePoints = h.sessions.filter((s) => s.volumeKg > 0).map((s) => ({ x: s.date, y: Math.round(s.volumeKg) }));
  $('ex-volume-card').hidden = volumePoints.length === 0;
  if (volumePoints.length) {
    renderChart('chart-ex-volume', timeLineConfig(volumePoints, t('chart.volume')));
  } else {
    destroyChart('chart-ex-volume');
  }

  const rows = recordRows(h);
  $('pr-body').replaceChildren(...(rows.length
    ? rows.map(([label, value, date]) => tableRow([label, value, formatDate(date)]))
    : [tableRow([t('pr.none'), '–', '–'])]));
}

/**
 * Renders the muscle group section.
 * @returns {void}
 */
function renderMuscles() {
  const mv = muscleVolume(state.data);
  $('muscle-body').replaceChildren(...mv.groups.map((g) => {
    const name = el('td', '', groupLabel(g.group));
    if (g.underTrained) {
      name.append(el('span', 'badge', t('muscles.under')));
    }
    return tableRow([name, nf1.format(g.recentAvg), nf1.format(g.totalAvg)], true);
  }));

  const used = mv.groups.filter((g) => g.sets > 0);
  renderChart('chart-muscle-share', {
    type: 'doughnut',
    data: {
      labels: used.map((g) => groupLabel(g.group)),
      datasets: [{ data: used.map((g) => g.sets), backgroundColor: used.map((g) => groupColor(g.group)), borderColor: cssVar('--surface') }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: (item) => t('muscles.tooltip', item.label, nf0.format(item.raw),
          t('pct', nf1.format(used[item.dataIndex].share * 100))) } },
      },
    },
  });

  const weekGroups = MUSCLE_GROUPS.filter((group) => mv.weeks.some((w) => w.counts[group] > 0));
  renderChart('chart-muscle-weeks', {
    type: 'bar',
    data: {
      labels: mv.weeks.map((w) => w.label),
      datasets: weekGroups.map((group) => ({
        label: groupLabel(group), data: mv.weeks.map((w) => w.counts[group]), backgroundColor: groupColor(group),
      })),
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
    },
  });

  $('other-card').hidden = mv.otherExercises.length === 0;
  $('other-exercises').replaceChildren(...mv.otherExercises.map((name) => el('li', '', name)));
}

/**
 * Writes the settings into the muscle gain form.
 * @returns {void}
 */
function fillSettingsForm() {
  const form = $('gain-form');
  form.elements.sex.value = state.settings.sex;
  const weight = $('body-weight');
  if (document.activeElement !== weight) {
    weight.value = state.settings.bodyWeightKg ?? '';
  }
  $('experience').value = state.settings.experience;
}

/**
 * Renders the muscle gain estimate with intermediate values.
 * @returns {void}
 */
function renderGain() {
  fillSettingsForm();
  const g = muscleGainEstimate(state.data, state.settings);
  $('gain-result').textContent = t('gain.result', nf1.format(g.low), nf1.format(g.high));
  fillDefinitions($('gain-details'), [
    [t('gain.dPeriod'), t('gain.months', nf1.format(g.monthsCovered))],
    [t('gain.dPretraining'), t('gain.months', nf0.format(g.pretrainingMonths))],
    [t('gain.dAgeEnd'), t('gain.months', nf0.format(g.trainingAgeEnd))],
    [t('gain.dConsistency'), t('gain.consistencyValue', t('pct', nf0.format(g.avgConsistency * 100)))],
    [t('gain.dStrength'), nf2.format(g.p)],
    [t('gain.dMedian'), g.strengthFallback
      ? t('gain.fallback')
      : t('gain.medianValue', t('pct', nfSigned.format(g.medianPct)), nf0.format(g.strengthExercises))],
    [t('gain.dModel'), g.model === 'mcdonald' ? t('gain.modelMcDonald') : t('gain.modelBoth')],
    [t('gain.dSex'), nf1.format(g.sexFactor)],
  ]);
  $('gain-months').replaceChildren(...g.months.map((m) => tableRow([
    m.label,
    nf2.format(m.fraction),
    t('gain.monthShort', nf0.format(m.trainingAge)),
    `${nf2.format(m.potLow)}–${nf2.format(m.potHigh)}`,
    nf2.format(m.consistency),
    `${nf2.format(m.gainLow)}–${nf2.format(m.gainHigh)}`,
  ], true)));
}

/**
 * Renders the fun facts.
 * @returns {void}
 */
function renderFacts() {
  const f = funFacts(state.data, state.settings);
  const cards = [
    kpiCard(t('facts.totalVolume'), `${nf1.format(f.totalVolumeKg / 1000)} t`, t('facts.totalVolumeSub'),
      { to: f.totalVolumeKg / 1000, format: (n) => `${nf1.format(n)} t` }),
    kpiCard(t('facts.elephants'), nf1.format(f.elephants), t('facts.elephantsSub'),
      { to: f.elephants, format: (n) => nf1.format(n) }),
    kpiCard(t('facts.cars'), nf0.format(f.cars), t('facts.carsSub'), { to: f.cars, format: (n) => nf0.format(n) }),
    kpiCard(t('facts.whales'), nf1.format(f.blueWhales), t('facts.whalesSub'), { to: f.blueWhales, format: (n) => nf1.format(n) }),
    kpiCard(t('facts.reps'), nf0.format(f.totalReps), undefined, { to: f.totalReps, format: (n) => nf0.format(n) }),
  ];
  if (f.biggestSession) {
    cards.push(kpiCard(t('facts.biggest'), `${nf0.format(f.biggestSession.volumeKg)} kg`,
      `${f.biggestSession.title}, ${formatDate(f.biggestSession.date)}`,
      { to: f.biggestSession.volumeKg, format: (n) => `${nf0.format(n)} kg` }));
  }
  if (f.heaviestLift) {
    cards.push(kpiCard(t('facts.heaviest'), `${nf1.format(f.heaviestLift.loadKg)} kg`,
      `${f.heaviestLift.exercise}, ${formatDate(f.heaviestLift.date)}`,
      { to: f.heaviestLift.loadKg, format: (n) => `${nf1.format(n)} kg` }));
  }
  if (f.strongestMonth) {
    cards.push(kpiCard(t('facts.strongestMonth'), f.strongestMonth.start.toLocaleDateString(locale(), { month: 'long', year: 'numeric' }),
      t('facts.monthVolume', nf1.format(f.strongestMonth.volumeKg / 1000))));
  }
  $('facts').replaceChildren(...cards);
  renderChart('chart-prs', barConfig(f.prsPerMonth.map((m) => m.label), f.prsPerMonth.map((m) => m.count), t('chart.records')));
}

/**
 * Renders the whole page for the current state.
 * @returns {void}
 */
function renderAll() {
  const hasData = !!state.data;
  document.querySelectorAll('.needs-data').forEach((node) => {
    node.hidden = !hasData;
  });
  renderImport();
  if (!hasData) {
    destroyCharts();
    updateNav();
    return;
  }
  applyChartTheme();
  renderOverview();
  renderHistory();
  renderExercises();
  renderMuscles();
  renderGain();
  renderFacts();
  updateNav();
  state.animateCounts = false;
}

/**
 * Parses CSV text, stores it locally and renders the result; keeps the previous data on errors.
 * @param {string} text CSV text.
 * @param {string} fileName Name of the imported file.
 * @returns {void}
 */
function importText(text, fileName) {
  let data;
  try {
    data = parseHevyCsv(text);
  } catch (e) {
    showError(e.message);
    return;
  }
  if (!data.workouts.length) {
    showError(t('error.noWorkouts'));
    return;
  }
  showError(null);
  state.data = data;
  state.animateCounts = true;
  state.meta = { fileName, importedAt: new Date().toISOString() };
  state.exerciseKey = null;
  const stored = saveItem(STORAGE.csv, text) && saveItem(STORAGE.meta, JSON.stringify(state.meta));
  if (!stored) {
    removeItem(STORAGE.csv);
    removeItem(STORAGE.meta);
  }
  showStorageWarning(!stored);
  renderAll();
}

/**
 * Reads a selected or dropped file and imports it.
 * @param {File|undefined} file File.
 * @returns {Promise<void>}
 */
async function handleFile(file) {
  if (!file) {
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    showError(t('error.read', file.name));
    return;
  }
  importText(text, file.name);
}

/**
 * Restores the stored CSV and its metadata.
 * @returns {void}
 */
function restore() {
  const text = loadItem(STORAGE.csv);
  if (!text) {
    return;
  }
  try {
    state.data = parseHevyCsv(text);
    state.animateCounts = true;
    state.meta = loadJson(STORAGE.meta);
  } catch (e) {
    state.data = null;
    showError(t('error.restore', e.message));
  }
}

/**
 * Deletes all local data except the chosen language after confirmation and resets the page.
 * @returns {void}
 */
function clearData() {
  if (!confirm(t('confirm.clear'))) {
    return;
  }
  const lang = loadItem(STORAGE.lang);
  removeAllItems();
  if (lang) {
    saveItem(STORAGE.lang, lang);
  }
  state.data = null;
  state.meta = null;
  state.settings = { ...DEFAULT_SETTINGS };
  state.exerciseKey = null;
  showError(null);
  showStorageWarning(false);
  renderAll();
}

/**
 * Reads the muscle gain form, stores the settings and re-renders everything.
 * @returns {void}
 */
function updateSettings() {
  const form = $('gain-form');
  const weight = Number(String($('body-weight').value).replace(',', '.'));
  state.settings = {
    sex: form.elements.sex.value === 'w' ? 'w' : 'm',
    bodyWeightKg: Number.isFinite(weight) && weight >= 30 && weight <= 300 ? weight : null,
    experience: EXPERIENCES.includes($('experience').value) ? $('experience').value : DEFAULT_SETTINGS.experience,
  };
  saveItem(STORAGE.settings, JSON.stringify(state.settings));
  renderAll();
}

/**
 * Sets the language, the number formats and all static texts and attributes marked with data-i18n.
 * Does not store the choice and does not re-render the dynamic parts.
 * @param {string} lang Language code.
 * @returns {void}
 */
function applyLanguage(lang) {
  setLanguage(lang);
  document.documentElement.lang = language();
  createNumberFormats();
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  I18N_ATTRIBUTES.forEach((attr) => document.querySelectorAll(`[data-i18n-${attr}]`)
    .forEach((node) => node.setAttribute(attr, t(node.getAttribute(`data-i18n-${attr}`)))));
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === language())));
  if (!$('storage-warning').hidden) {
    showStorageWarning(true);
  }
}

/**
 * Switches to another language, stores the choice and re-renders the page from the already parsed data.
 * @param {string} lang Language code.
 * @returns {void}
 */
function switchLanguage(lang) {
  if (lang === language()) {
    return;
  }
  applyLanguage(lang);
  saveItem(STORAGE.lang, language());
  renderAll();
}

/**
 * Tells whether a drag event carries files.
 * @param {DragEvent} e Drag event.
 * @returns {boolean} True if files are dragged.
 */
function hasFiles(e) {
  return [...(e.dataTransfer?.types ?? [])].includes('Files');
}

/**
 * Binds all event handlers.
 * @returns {void}
 */
function bindEvents() {
  const input = $('file-input');
  const dropZone = $('drop-zone');
  input.addEventListener('change', async () => {
    await handleFile(input.files?.[0]);
    input.value = '';
  });
  $('btn-other').addEventListener('click', () => input.click());
  $('btn-clear').addEventListener('click', clearData);

  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) {
      return;
    }
    e.preventDefault();
    dropZone.classList.add('active');
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) {
      dropZone.classList.remove('active');
    }
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) {
      return;
    }
    e.preventDefault();
    dropZone.classList.remove('active');
    handleFile(e.dataTransfer.files[0]);
  });

  document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => {
    state.period = button.dataset.period;
    renderHistory();
  }));
  $('exercise-select').addEventListener('change', (e) => {
    state.exerciseKey = e.target.value;
    renderExercises();
  });
  $('gain-form').addEventListener('change', updateSettings);
  $('gain-form').addEventListener('submit', (e) => e.preventDefault());
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => switchLanguage(b.dataset.lang)));

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.data) {
      renderAll();
    }
  });
}

/**
 * Registers the service worker for offline use.
 * @returns {Promise<void>}
 */
async function registerServiceWorker() {
  try {
    await navigator.serviceWorker?.register('./sw.js');
  } catch (e) {
    console.warn('Service worker registration failed', e);
  }
}

/**
 * Starts the app.
 * @returns {void}
 */
function init() {
  $('start-error').hidden = true;
  initEffects();
  const storedLang = loadItem(STORAGE.lang);
  applyLanguage(LANGUAGES.includes(storedLang) ? storedLang : DEFAULT_LANGUAGE);
  state.settings = loadSettings();
  bindEvents();
  restore();
  renderAll();
  registerServiceWorker();
}

init();
