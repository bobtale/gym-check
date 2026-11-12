/**
 * Gym Check user interface: import, local storage, settings, rendering, charts and service worker registration.
 * All imported data stays in the browser; foreign text is only written via textContent.
 * @module app
 */

import { parseHevyCsv } from './parse.js';
import { MUSCLE_GROUPS } from './muscles.js';
import {
  overview, timeSeries, exerciseList, exerciseHistory, muscleVolume, funFacts, muscleGainEstimate, heatmap,
} from './stats.js';

const STORAGE = { csv: 'gymcheck.csv', meta: 'gymcheck.meta', settings: 'gymcheck.settings' };
const STORAGE_PREFIX = 'gymcheck.';
const DEFAULT_SETTINGS = { sex: 'm', bodyWeightKg: null, experience: 'beginner' };
const EXPERIENCES = ['beginner', 'some', 'advanced'];
const STORAGE_WARNING = 'Daten konnten nicht lokal gespeichert werden, Import gilt nur für diese Sitzung.';
const OFFLINE_CHARTS = 'Diagramme offline nicht verfügbar';

const METRIC_TITLES = {
  e1rm: 'e1RM-Verlauf (kg)',
  assist: 'Unterstützung (kg) – weniger ist besser',
  topLoad: 'Top-Satz-Gewicht (kg)',
  reps: 'Max. Wiederholungen je Session',
  duration: 'Längste Dauer je Session (min)',
};
const METRIC_NAMES = {
  e1rm: 'e1RM', assist: 'geringste Unterstützung', topLoad: 'Top-Satz-Gewicht', reps: 'max. Wiederholungen', duration: 'Dauer',
};

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfSigned = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });

const state = {
  data: null,
  meta: null,
  settings: { ...DEFAULT_SETTINGS },
  period: 'week',
  exerciseKey: null,
};

const charts = new Map();

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
 * Formats a date as German date.
 * @param {Date} date Date.
 * @returns {string} Date text.
 */
function formatDate(date) {
  return date.toLocaleDateString('de-DE');
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
  return n === 1 ? '1 Woche' : `${nf0.format(n)} Wochen`;
}

/**
 * Creates a key figure card.
 * @param {string} label Label.
 * @param {string} value Value.
 * @param {string} [sub] Additional line.
 * @returns {HTMLElement} Card element.
 */
function kpiCard(label, value, sub) {
  const card = el('div', 'kpi');
  card.append(el('span', 'kpi-label', label), el('span', 'kpi-value', value));
  if (sub) {
    card.append(el('span', 'kpi-sub', sub));
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
  window.Chart.defaults.locale = 'de-DE';
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
    if (!box.querySelector('.chart-fallback')) {
      box.append(el('p', 'chart-fallback', OFFLINE_CHARTS));
    }
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
  node.textContent = visible ? STORAGE_WARNING : '';
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
  $('sum-imported').textContent = meta?.importedAt ? new Date(meta.importedAt).toLocaleString('de-DE') : '–';
  $('sum-workouts').textContent = nf0.format(data.workouts.length);
  $('sum-sets').textContent = nf0.format(data.setCount);
  $('sum-exercises').textContent = nf0.format(data.exercises.size);
  $('sum-range').textContent = `${formatDate(first)} – ${formatDate(last)}`;
  $('import-warnings').replaceChildren(...data.warnings.map((w) => el('li', '', w)));
}

/**
 * Renders the overview key figures.
 * @returns {void}
 */
function renderOverview() {
  const o = overview(state.data, state.settings, new Date());
  $('kpis').replaceChildren(
    kpiCard('Workouts', nf0.format(o.workouts)),
    kpiCard('Trainingszeit', `${nf1.format(o.totalMinutes / 60)} h`),
    kpiCard('Volumen', `${nf1.format(o.volumeKg / 1000)} t`, 'Last × Wdh. der Arbeitssätze'),
    kpiCard('Arbeitssätze', nf0.format(o.workSets), 'ohne Aufwärmsätze'),
    kpiCard('Wiederholungen', nf0.format(o.reps)),
    kpiCard('Ø Workouts/Woche', nf1.format(o.avgWorkoutsPerWeek), `über ${formatWeeks(o.weeks)}`),
    kpiCard('Ø Dauer', o.avgDurationMin === null ? '–' : `${nf0.format(o.avgDurationMin)} min`),
    kpiCard('Ø Sätze/Workout', nf1.format(o.avgSetsPerWorkout)),
    kpiCard('Längste Serie', formatWeeks(o.longestStreak), 'in Folge mit Training'),
    kpiCard('Aktuelle Serie', formatWeeks(o.currentStreak)),
    kpiCard('Erstes Workout', formatDate(o.first)),
    kpiCard('Letztes Workout', formatDate(o.last)),
    kpiCard('Lieblingsübung', o.favorite.name, `in ${nf0.format(o.favorite.workouts)} Workouts`),
    kpiCard('Häufigster Wochentag', o.topWeekday.name, `${nf0.format(o.topWeekday.count)} Workouts`),
    kpiCard('Häufigste Tageszeit', o.topDayTime.name, `${nf0.format(o.topDayTime.count)} Workouts`),
  );
  $('overview-note').hidden = !o.assistedWithoutWeight;
}

/**
 * Renders the training heatmap.
 * @returns {void}
 */
function renderHeatmap() {
  const { cells } = heatmap(state.data);
  $('heatmap').replaceChildren(...cells.map((c) => {
    const cell = el('i', `lvl-${c.level}`);
    cell.title = `${formatDate(c.date)}: ${c.trained ? `${nf0.format(c.sets)} Sätze` : 'kein Training'}`;
    return cell;
  }));
}

/**
 * Renders the history section (workouts, volume, duration, heatmap).
 * @returns {void}
 */
function renderHistory() {
  const series = timeSeries(state.data, state.settings);
  const periods = state.period === 'month' ? series.months : series.weeks;
  document.querySelectorAll('[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === state.period)));
  renderChart('chart-workouts', barConfig(periods.map((p) => p.label), periods.map((p) => p.workouts), 'Workouts'));
  renderChart('chart-volume', barConfig(series.weeks.map((w) => w.label), series.weeks.map((w) => Math.round(w.volumeKg)), 'Volumen (kg)'));
  renderChart('chart-duration', {
    type: 'line',
    data: {
      labels: series.weeks.map((w) => w.label),
      datasets: [{
        label: 'Ø Dauer (min)',
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
    const label = assistOnly ? 'Geringste Unterstützung' : info.assisted ? 'Höchste effektive Last' : 'Schwerstes Gewicht';
    rows.push([label, `${nf1.format(prs.heaviest.value)} kg`, prs.heaviest.date]);
  }
  if (prs.e1rm) {
    rows.push(['Bestes e1RM', `${nf1.format(prs.e1rm.value)} kg`, prs.e1rm.date]);
  }
  if (prs.reps) {
    rows.push(['Meiste Wdh. in einem Satz', nf0.format(prs.reps.value), prs.reps.date]);
  }
  if (prs.volume) {
    rows.push(['Bestes Session-Volumen', `${nf0.format(prs.volume.value)} kg`, prs.volume.date]);
  }
  if (prs.duration) {
    rows.push(['Längste Dauer', formatDuration(prs.duration.value), prs.duration.date]);
  }
  if (prs.distance) {
    rows.push(['Größte Distanz', `${nf2.format(prs.distance.value)} km`, prs.distance.date]);
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
  $('exercise-meta').textContent = `${h.info.group} · ${nf0.format(h.sessions.length)} Sessions`;

  const hints = [];
  if (h.metric === 'e1rm') {
    hints.push(`e1RM (Epley) nur aus Sätzen mit ≤ 12 Wdh.${h.repCapHit ? ' Sätze mit mehr Wdh. fließen nicht ein.' : ''}`);
  }
  if (h.assistOnly) {
    hints.push('Unterstützte Übung ohne Körpergewicht: Es zählt die geringste Unterstützung (weniger ist besser), ohne e1RM '
      + 'und Volumen. Mit Körpergewicht unter „Muskelaufbau“ wird die effektive Last berechnet.');
  } else if (h.info.assisted) {
    hints.push('Unterstützte Übung: effektive Last = Körpergewicht − Unterstützung.');
  }
  $('exercise-hints').replaceChildren(...hints.map((t) => el('li', '', t)));

  const imp = h.improvement;
  const metricName = h.info.assisted ? METRIC_NAMES.assist : METRIC_NAMES[h.metric];
  $('exercise-improvement').textContent = !imp ? 'zu wenig Daten' : imp.percent === null ? '–' : `${nfSigned.format(imp.percent)} %`;
  $('exercise-improvement-sub').textContent = imp
    ? `${metricName}, ${imp.method === 'avg3' ? 'Ø erste 3 vs. letzte 3 Sessions' : 'erste vs. letzte Session'}`
    : metricName;

  $('ex-main-title').textContent = METRIC_TITLES[h.metric];
  const mainPoints = h.metric === 'duration' ? h.series.map((p) => ({ x: p.x, y: Math.round((p.y / 60) * 10) / 10 })) : h.series;
  renderChart('chart-ex-main', timeLineConfig(mainPoints, METRIC_TITLES[h.metric]));

  const topPoints = h.sessions.filter((s) => s.topLoad !== null).map((s) => ({ x: s.date, y: s.topLoad }));
  const showTop = h.metric === 'e1rm' && topPoints.length > 0;
  $('ex-top-card').hidden = !showTop;
  if (showTop) {
    renderChart('chart-ex-top', timeLineConfig(topPoints, 'Top-Satz-Gewicht (kg)'));
  } else {
    destroyChart('chart-ex-top');
  }

  const volumePoints = h.sessions.filter((s) => s.volumeKg > 0).map((s) => ({ x: s.date, y: Math.round(s.volumeKg) }));
  $('ex-volume-card').hidden = volumePoints.length === 0;
  if (volumePoints.length) {
    renderChart('chart-ex-volume', timeLineConfig(volumePoints, 'Volumen (kg)'));
  } else {
    destroyChart('chart-ex-volume');
  }

  const rows = recordRows(h);
  $('pr-body').replaceChildren(...(rows.length
    ? rows.map(([label, value, date]) => tableRow([label, value, formatDate(date)]))
    : [tableRow(['Keine Rekorde', '–', '–'])]));
}

/**
 * Renders the muscle group section.
 * @returns {void}
 */
function renderMuscles() {
  const mv = muscleVolume(state.data);
  $('muscle-body').replaceChildren(...mv.groups.map((g) => {
    const name = el('td', '', g.group);
    if (g.underTrained) {
      name.append(el('span', 'badge', 'unter 10'));
    }
    return tableRow([name, nf1.format(g.recentAvg), nf1.format(g.totalAvg)], true);
  }));

  const used = mv.groups.filter((g) => g.sets > 0);
  renderChart('chart-muscle-share', {
    type: 'doughnut',
    data: {
      labels: used.map((g) => g.group),
      datasets: [{ data: used.map((g) => g.sets), backgroundColor: used.map((g) => groupColor(g.group)), borderColor: cssVar('--surface') }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: (item) => `${item.label}: ${nf0.format(item.raw)} Sätze (${nf1.format(used[item.dataIndex].share * 100)} %)` } },
      },
    },
  });

  const weekGroups = MUSCLE_GROUPS.filter((group) => mv.weeks.some((w) => w.counts[group] > 0));
  renderChart('chart-muscle-weeks', {
    type: 'bar',
    data: {
      labels: mv.weeks.map((w) => w.label),
      datasets: weekGroups.map((group) => ({
        label: group, data: mv.weeks.map((w) => w.counts[group]), backgroundColor: groupColor(group),
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
  $('gain-result').textContent = `ca. ${nf1.format(g.low)}–${nf1.format(g.high)} kg Muskelmasse (Schätzung)`;
  fillDefinitions($('gain-details'), [
    ['Zeitraum', `${nf1.format(g.monthsCovered)} Monate`],
    ['Vorerfahrung', `${nf0.format(g.pretrainingMonths)} Monate`],
    ['Trainingsalter am Ende', `${nf0.format(g.trainingAgeEnd)} Monate`],
    ['Ø Konsistenz', `${nf0.format(g.avgConsistency * 100)} % von 3 Workouts/Woche`],
    ['Kraftfaktor', nf2.format(g.p)],
    ['Median e1RM-Verbesserung', g.strengthFallback
      ? 'keine Übung mit ≥ 6 e1RM-Sessions, Kraftfaktor 0,75 angenommen'
      : `${nfSigned.format(g.medianPct)} % (${nf0.format(g.strengthExercises)} Übungen)`],
    ['Modell', g.model === 'mcdonald' ? 'McDonald (ohne Körpergewicht)' : 'McDonald + Aragon'],
    ['Faktor Geschlecht', nf1.format(g.sexFactor)],
  ]);
  $('gain-months').replaceChildren(...g.months.map((m) => tableRow([
    m.label,
    nf2.format(m.fraction),
    `${nf0.format(m.trainingAge)} Mon.`,
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
    kpiCard('Gesamtvolumen', `${nf1.format(f.totalVolumeKg / 1000)} t`, 'Last × Wdh. aller Arbeitssätze'),
    kpiCard('Gewichtheben in Elefanten', nf1.format(f.elephants), 'Afrikanische Elefanten à 6 t'),
    kpiCard('In Kleinwagen', nf0.format(f.cars), 'Kleinwagen à 1,3 t'),
    kpiCard('In Blauwalen', nf1.format(f.blueWhales), 'Blauwale à 150 t'),
    kpiCard('Wiederholungen gesamt', nf0.format(f.totalReps)),
  ];
  if (f.biggestSession) {
    cards.push(kpiCard('Größte Session', `${nf0.format(f.biggestSession.volumeKg)} kg`,
      `${f.biggestSession.title}, ${formatDate(f.biggestSession.date)}`));
  }
  if (f.heaviestLift) {
    cards.push(kpiCard('Schwerste Einzellast', `${nf1.format(f.heaviestLift.loadKg)} kg`,
      `${f.heaviestLift.exercise}, ${formatDate(f.heaviestLift.date)}`));
  }
  if (f.strongestMonth) {
    cards.push(kpiCard('Stärkster Monat', f.strongestMonth.start.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
      `${nf1.format(f.strongestMonth.volumeKg / 1000)} t Volumen`));
  }
  $('facts').replaceChildren(...cards);
  renderChart('chart-prs', barConfig(f.prsPerMonth.map((m) => m.label), f.prsPerMonth.map((m) => m.count), 'Rekorde'));
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
    return;
  }
  applyChartTheme();
  renderOverview();
  renderHistory();
  renderExercises();
  renderMuscles();
  renderGain();
  renderFacts();
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
    showError('Die Datei enthält keine Workouts.');
    return;
  }
  showError(null);
  state.data = data;
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
    showError(`Datei "${file.name}" konnte nicht gelesen werden.`);
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
    state.meta = loadJson(STORAGE.meta);
  } catch (e) {
    state.data = null;
    showError(`Gespeicherte Daten konnten nicht gelesen werden: ${e.message}`);
  }
}

/**
 * Deletes all local data after confirmation and resets the page.
 * @returns {void}
 */
function clearData() {
  if (!confirm('Alle importierten Daten und Einstellungen von diesem Gerät löschen?')) {
    return;
  }
  removeAllItems();
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
  state.settings = loadSettings();
  bindEvents();
  restore();
  renderAll();
  registerServiceWorker();
}

init();
