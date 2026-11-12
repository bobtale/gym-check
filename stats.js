/**
 * Computes key figures, time series, exercise histories, muscle group volume, fun facts,
 * a muscle gain estimate and heatmap data from parsed Hevy data.
 * Pure module without DOM access; `settings` and `now` are always passed in.
 * Labels (weekdays, times of day, week and month labels) follow the current language of i18n.js.
 * @module stats
 */

import { MUSCLE_GROUPS } from './muscles.js';
import { t } from './i18n.js';

/** Constants of the muscle gain model (McDonald and Aragon, see muscleGainEstimate). */
export const GAIN_MODEL = {
  pretrainingMonths: { beginner: 0, some: 12, advanced: 36 },
  rates: [
    { fromMonth: 0, mcdonaldKg: [0.76, 0.94], aragonPct: [1.0, 1.5] },
    { fromMonth: 12, mcdonaldKg: [0.38, 0.45], aragonPct: [0.5, 1.0] },
    { fromMonth: 24, mcdonaldKg: [0.19, 0.23], aragonPct: [0.5, 1.0] },
    { fromMonth: 36, mcdonaldKg: [0.08, 0.11], aragonPct: [0.25, 0.5] },
  ],
  femaleFactor: 0.5,
  targetWorkoutsPerWeek: 3,
  strengthMinSessions: 6,
  strengthBase: 0.5,
  strengthDivisor: 40,
  strengthMin: 0.5,
  strengthMax: 1.0,
  strengthFallback: 0.75,
};

/** Weight comparison objects for the fun facts, in kg. */
export const COMPARISONS = { car: 1300, elephant: 6000, blueWhale: 150000 };

/** Recommended minimum of weekly work sets per muscle group (Schoenfeld et al. 2017). */
export const MIN_WEEKLY_SETS = 10;

const UNMARKED_GROUPS = ['Cardio', 'Sonstiges'];
const DAY_MS = 86400000;

/**
 * Tells whether a set counts as work set (everything except warm-up sets).
 * @param {{type: string}} set Set row.
 * @returns {boolean} True for work sets.
 */
export function isWorkSet(set) {
  return set.type !== 'warmup';
}

/**
 * Formats a date as local YYYY-MM-DD.
 * @param {Date} date Date.
 * @returns {string} Day key.
 */
export function dayKey(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * Formats a date as local YYYY-MM.
 * @param {Date} date Date.
 * @returns {string} Month key.
 */
export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Builds a short month label such as "Jan 26"; the label follows the current language of i18n.js.
 * @param {Date} date Any date in the month.
 * @returns {string} Month label.
 */
export function monthLabel(date) {
  return `${t('monthsShort')[date.getMonth()]} ${String(date.getFullYear()).slice(-2)}`;
}

/**
 * Returns local midnight of the date's day.
 * @param {Date} date Date.
 * @returns {Date} Start of day.
 */
export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Returns Monday 00:00 local time of the ISO week containing the date.
 * @param {Date} date Date.
 * @returns {Date} Week start.
 */
export function weekStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
}

/**
 * Adds whole days in local time (DST-safe).
 * @param {Date} date Date.
 * @param {number} days Number of days, may be negative.
 * @returns {Date} Shifted date.
 */
export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Returns the week key (YYYY-MM-DD of Monday) of a date.
 * @param {Date} date Date.
 * @returns {string} Week key.
 */
export function weekKey(date) {
  return dayKey(weekStart(date));
}

/**
 * Builds a label such as "KW 12/26" from the ISO week number and ISO week year; the label follows the current
 * language of i18n.js.
 * @param {Date} monday Monday of the week.
 * @returns {string} Week label.
 */
export function weekLabel(monday) {
  const thursday = addDays(monday, 3);
  const firstThursday = addDays(weekStart(new Date(thursday.getFullYear(), 0, 4)), 3);
  const week = 1 + Math.round((thursday - firstThursday) / (7 * DAY_MS));
  return t('weekLabel', week, String(thursday.getFullYear()).slice(-2));
}

/**
 * Lists the Mondays from the week of `first` to the week of `last`, inclusive.
 * @param {Date} first First date.
 * @param {Date} last Last date.
 * @returns {Date[]} Week starts.
 */
export function weekRange(first, last) {
  const end = weekStart(last);
  const weeks = [];
  for (let w = weekStart(first); w <= end; w = addDays(w, 7)) {
    weeks.push(w);
  }
  return weeks;
}

/**
 * Lists the first days of all months from the month of `first` to the month of `last`, inclusive.
 * @param {Date} first First date.
 * @param {Date} last Last date.
 * @returns {Date[]} Month starts.
 */
export function monthRange(first, last) {
  const end = new Date(last.getFullYear(), last.getMonth(), 1);
  const months = [];
  for (let m = new Date(first.getFullYear(), first.getMonth(), 1); m <= end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    months.push(m);
  }
  return months;
}

/**
 * Returns the load that counts for performance and volume.
 * Assisted exercises store the assistance as weight; with a body weight the load is body weight minus assistance.
 * @param {{weightKg: number|null}} set Set row.
 * @param {{assisted: boolean}} info Exercise info.
 * @param {{bodyWeightKg: number|null}} settings User settings.
 * @returns {number|null} Load in kg or null if unknown.
 */
export function effectiveLoad(set, info, settings) {
  if (!info.assisted) {
    return set.weightKg;
  }
  if (!settings.bodyWeightKg) {
    return null;
  }
  return Math.max(settings.bodyWeightKg - (set.weightKg ?? 0), 0);
}

/**
 * Estimates the one-rep max with the Epley formula; only for 1 to 12 reps and a positive load.
 * @param {number|null} load Load in kg.
 * @param {number|null} reps Repetitions.
 * @returns {number|null} Estimated one-rep max or null.
 */
export function e1rm(load, reps) {
  if (!(load > 0) || !(reps >= 1) || reps > 12) {
    return null;
  }
  return reps === 1 ? load : load * (1 + reps / 30);
}

/**
 * Computes the volume (load x reps) of a single work set.
 * @param {object} set Set row.
 * @param {object} info Exercise info.
 * @param {object} settings User settings.
 * @returns {number} Volume in kg, 0 for warm-up sets or sets without load or reps.
 */
function setVolume(set, info, settings) {
  if (!isWorkSet(set)) {
    return 0;
  }
  const load = effectiveLoad(set, info, settings);
  return load > 0 && set.reps > 0 ? load * set.reps : 0;
}

/**
 * Computes the volume of a workout.
 * @param {object} workout Workout.
 * @param {Map<string, object>} exercises Exercise infos.
 * @param {object} settings User settings.
 * @returns {number} Volume in kg.
 */
function workoutVolume(workout, exercises, settings) {
  return workout.sets.reduce((sum, s) => sum + setVolume(s, exercises.get(s.exKey), settings), 0);
}

/**
 * Returns the arithmetic mean.
 * @param {number[]} values Values.
 * @returns {number|null} Mean or null for an empty list.
 */
function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Rounds to one decimal place.
 * @param {number} v Value.
 * @returns {number} Rounded value.
 */
function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * Returns the value at a quantile of a sorted list (nearest rank, rounded down).
 * @param {number[]} sorted Ascending values, not empty.
 * @param {number} q Quantile between 0 and 1.
 * @returns {number} Value at the quantile.
 */
function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

/**
 * Returns the median.
 * @param {number[]} values Values.
 * @returns {number|null} Median or null for an empty list.
 */
function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compares the first and the last level of a chronological series.
 * With at least 6 values the means of the first 3 and last 3 are compared, with 2 to 5 the first and last value.
 * @param {number[]} values Chronological values.
 * @param {boolean} lowerIsBetter True if smaller values mean progress (assistance).
 * @returns {{first: number, last: number, percent: number|null, method: 'avg3'|'firstLast'}|null} Comparison or null
 *   if there are fewer than 2 values.
 */
export function improvement(values, lowerIsBetter = false) {
  if (values.length < 2) {
    return null;
  }
  const method = values.length >= 6 ? 'avg3' : 'firstLast';
  const first = method === 'avg3' ? mean(values.slice(0, 3)) : values[0];
  const last = method === 'avg3' ? mean(values.slice(-3)) : values[values.length - 1];
  const delta = lowerIsBetter ? first - last : last - first;
  return { first, last, percent: first ? (delta / first) * 100 : null, method };
}

/**
 * Counts consecutive weeks with workouts.
 * @param {Set<string>} activeWeeks Week keys with at least one workout.
 * @param {Date} from Week start to count backwards from.
 * @returns {number} Number of consecutive active weeks.
 */
function streakBackwards(activeWeeks, from) {
  let count = 0;
  for (let w = from; activeWeeks.has(dayKey(w)); w = addDays(w, -7)) {
    count += 1;
  }
  return count;
}

/**
 * Maps a start hour to a time of day; the label follows the current language of i18n.js.
 * @param {number} hour Hour 0-23.
 * @returns {string} Time of day.
 */
function dayTime(hour) {
  const [morning, midday, afternoon, evening, night] = t('dayTimes');
  if (hour >= 5 && hour <= 10) {
    return morning;
  }
  if (hour >= 11 && hour <= 13) {
    return midday;
  }
  if (hour >= 14 && hour <= 16) {
    return afternoon;
  }
  if (hour >= 17 && hour <= 21) {
    return evening;
  }
  return night;
}

/**
 * Returns the entry with the highest count.
 * @param {Map<string, number>} counts Counts by name.
 * @returns {{name: string, count: number}|null} Top entry or null.
 */
function topEntry(counts) {
  let best = null;
  for (const [name, count] of counts) {
    if (!best || count > best.count) {
      best = { name, count };
    }
  }
  return best;
}

/**
 * Computes the overview key figures.
 * @param {object} data Parsed data.
 * @param {object} settings User settings.
 * @param {Date} [now] Reference time for the current streak.
 * @returns {object|null} Key figures or null without workouts.
 */
export function overview(data, settings, now = new Date()) {
  const { workouts, exercises } = data;
  if (!workouts.length) {
    return null;
  }
  const first = workouts[0].start;
  const last = workouts[workouts.length - 1].start;
  const durations = workouts.map((w) => w.durationMin).filter((d) => d !== null);
  const activeWeeks = new Set(workouts.map((w) => weekKey(w.start)));
  const weeks = weekRange(first, last);
  let workSets = 0;
  let reps = 0;
  let volumeKg = 0;
  const exWorkouts = new Map();
  const exSets = new Map();
  const weekdays = t('weekdays');
  const weekdayCounts = new Map(weekdays.map((d) => [d, 0]));
  const dayTimeCounts = new Map(t('dayTimes').map((d) => [d, 0]));
  let assistedWithoutWeight = false;
  for (const w of workouts) {
    const weekday = weekdays[(w.start.getDay() + 6) % 7];
    weekdayCounts.set(weekday, weekdayCounts.get(weekday) + 1);
    const time = dayTime(w.start.getHours());
    dayTimeCounts.set(time, dayTimeCounts.get(time) + 1);
    for (const key of new Set(w.sets.map((s) => s.exKey))) {
      exWorkouts.set(key, (exWorkouts.get(key) ?? 0) + 1);
    }
    for (const s of w.sets.filter(isWorkSet)) {
      const info = exercises.get(s.exKey);
      workSets += 1;
      reps += s.reps ?? 0;
      volumeKg += setVolume(s, info, settings);
      exSets.set(s.exKey, (exSets.get(s.exKey) ?? 0) + 1);
      assistedWithoutWeight ||= info.assisted && !settings.bodyWeightKg;
    }
  }
  let favorite = null;
  for (const [key, count] of exWorkouts) {
    const sets = exSets.get(key) ?? 0;
    if (!favorite || count > favorite.workouts || (count === favorite.workouts && sets > favorite.sets)) {
      favorite = { key, name: exercises.get(key).name, workouts: count, sets };
    }
  }
  let longestStreak = 0;
  let run = 0;
  for (const w of weeks) {
    run = activeWeeks.has(dayKey(w)) ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
  }
  const thisWeek = weekStart(now);
  const currentStreak = activeWeeks.has(dayKey(thisWeek))
    ? streakBackwards(activeWeeks, thisWeek)
    : streakBackwards(activeWeeks, addDays(thisWeek, -7));
  return {
    workouts: workouts.length,
    totalMinutes: durations.reduce((a, b) => a + b, 0),
    avgDurationMin: mean(durations),
    volumeKg,
    workSets,
    reps,
    weeks: weeks.length,
    avgWorkoutsPerWeek: workouts.length / weeks.length,
    avgSetsPerWorkout: workSets / workouts.length,
    longestStreak,
    currentStreak,
    first,
    last,
    favorite,
    topWeekday: topEntry(weekdayCounts),
    topDayTime: topEntry(dayTimeCounts),
    assistedWithoutWeight,
  };
}

/**
 * Builds gap-free weekly and monthly series from the first to the last workout.
 * @param {object} data Parsed data.
 * @param {object} settings User settings.
 * @returns {{weeks: object[], months: object[]}} Weekly entries (workouts, volume, mean duration) and monthly entries
 *   (workouts, volume).
 */
export function timeSeries(data, settings) {
  const { workouts, exercises } = data;
  if (!workouts.length) {
    return { weeks: [], months: [] };
  }
  const first = workouts[0].start;
  const last = workouts[workouts.length - 1].start;
  const weeks = new Map(weekRange(first, last).map((w) => [dayKey(w), {
    key: dayKey(w), label: weekLabel(w), start: w, workouts: 0, volumeKg: 0, durations: [],
  }]));
  const months = new Map(monthRange(first, last).map((m) => [monthKey(m), {
    key: monthKey(m), label: monthLabel(m), start: m, workouts: 0, volumeKg: 0,
  }]));
  for (const w of workouts) {
    const volume = workoutVolume(w, exercises, settings);
    const week = weeks.get(weekKey(w.start));
    const month = months.get(monthKey(w.start));
    week.workouts += 1;
    week.volumeKg += volume;
    if (w.durationMin !== null) {
      week.durations.push(w.durationMin);
    }
    month.workouts += 1;
    month.volumeKg += volume;
  }
  return {
    weeks: [...weeks.values()].map(({ durations, ...rest }) => ({ ...rest, avgDurationMin: mean(durations) })),
    months: [...months.values()],
  };
}

/**
 * Lists all exercises sorted by number of sessions (descending), then by name.
 * @param {object} data Parsed data.
 * @returns {{key: string, name: string, group: string, sessions: number}[]} Exercise list.
 */
export function exerciseList(data) {
  const sessions = new Map();
  for (const w of data.workouts) {
    for (const key of new Set(w.sets.map((s) => s.exKey))) {
      sessions.set(key, (sessions.get(key) ?? 0) + 1);
    }
  }
  return [...data.exercises.values()]
    .map((e) => ({ key: e.key, name: e.name, group: e.group, sessions: sessions.get(e.key) ?? 0 }))
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name, 'de'));
}

/**
 * Picks the best record by a value.
 * @param {object|null} best Current record.
 * @param {number|null} value Candidate value.
 * @param {Date} date Candidate date.
 * @param {boolean} lower True if smaller values win.
 * @param {object} [extra] Additional fields of the candidate.
 * @returns {object|null} Better record.
 */
function better(best, value, date, lower = false, extra = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return best;
  }
  if (!best || (lower ? value < best.value : value > best.value)) {
    return { value, date, ...extra };
  }
  return best;
}

/**
 * Computes the per-session history, records and improvement of one exercise.
 * @param {object} data Parsed data.
 * @param {string} key Exercise key.
 * @param {object} settings User settings.
 * @returns {object|null} History with `metric` ('e1rm'|'assist'|'topLoad'|'reps'|'duration'), `sessions`,
 *   `series` ({x, y} per session of the main metric), `prs`, `improvement` and hint flags; null for unknown keys.
 *   For assisted exercises the improvement always uses the minimum assistance per session, independent of body weight.
 */
export function exerciseHistory(data, key, settings) {
  const info = data.exercises.get(key);
  if (!info) {
    return null;
  }
  const assistOnly = info.assisted && !settings.bodyWeightKg;
  const sessions = [];
  let repCapHit = false;
  for (const w of data.workouts) {
    const sets = w.sets.filter((s) => s.exKey === key && isWorkSet(s));
    if (!sets.length) {
      continue;
    }
    const session = {
      date: w.start, title: w.title, sets: sets.length, topLoad: null, e1rm: null, minAssist: null, maxReps: null,
      volumeKg: 0, maxDurationS: null, maxDistanceKm: null,
    };
    for (const s of sets) {
      const load = effectiveLoad(s, info, settings);
      if (load > 0) {
        session.topLoad = Math.max(session.topLoad ?? 0, load);
        const est = e1rm(load, s.reps);
        if (est !== null) {
          session.e1rm = Math.max(session.e1rm ?? 0, est);
        } else if (s.reps > 12) {
          repCapHit = true;
        }
      }
      if (info.assisted && s.reps >= 1 && s.weightKg !== null) {
        session.minAssist = session.minAssist === null ? s.weightKg : Math.min(session.minAssist, s.weightKg);
      }
      if (s.reps !== null) {
        session.maxReps = Math.max(session.maxReps ?? 0, s.reps);
      }
      if (s.durationS !== null) {
        session.maxDurationS = Math.max(session.maxDurationS ?? 0, s.durationS);
      }
      if (s.distanceKm !== null) {
        session.maxDistanceKm = Math.max(session.maxDistanceKm ?? 0, s.distanceKm);
      }
      session.volumeKg += setVolume(s, info, settings);
    }
    sessions.push(session);
  }

  let metric = 'duration';
  if (assistOnly) {
    metric = 'assist';
  } else if (sessions.some((s) => s.e1rm !== null)) {
    metric = 'e1rm';
  } else if (sessions.some((s) => s.topLoad !== null)) {
    metric = 'topLoad';
  } else if (sessions.some((s) => s.maxReps > 0)) {
    metric = 'reps';
  }
  const valueOf = {
    e1rm: (s) => s.e1rm,
    assist: (s) => s.minAssist,
    topLoad: (s) => s.topLoad,
    reps: (s) => s.maxReps || null,
    duration: (s) => s.maxDurationS,
  }[metric];
  const series = sessions.filter((s) => valueOf(s) !== null).map((s) => ({ x: s.date, y: valueOf(s) }));

  let prs = { heaviest: null, e1rm: null, reps: null, volume: null, duration: null, distance: null };
  for (const s of sessions) {
    prs = {
      heaviest: assistOnly ? better(prs.heaviest, s.minAssist, s.date, true) : better(prs.heaviest, s.topLoad, s.date),
      e1rm: better(prs.e1rm, s.e1rm, s.date),
      reps: better(prs.reps, s.maxReps || null, s.date),
      volume: better(prs.volume, s.volumeKg || null, s.date),
      duration: better(prs.duration, s.maxDurationS || null, s.date),
      distance: better(prs.distance, s.maxDistanceKm || null, s.date),
    };
  }

  return {
    info,
    metric,
    sessions,
    series,
    prs,
    improvement: info.assisted
      ? improvement(sessions.map((s) => s.minAssist).filter((v) => v !== null), true)
      : improvement(series.map((p) => p.y)),
    repCapHit,
    assistOnly,
  };
}

/**
 * Counts work sets per week and muscle group (primary group only).
 * @param {object} data Parsed data.
 * @param {number} [recentWeeks] Number of weeks for the recent average.
 * @param {number} [chartWeeks] Number of weeks for the stacked chart.
 * @returns {object} Per-group averages and shares, the stacked weekly series and the exercises in "Sonstiges".
 */
export function muscleVolume(data, recentWeeks = 4, chartWeeks = 12) {
  const { workouts, exercises } = data;
  const empty = Object.fromEntries(MUSCLE_GROUPS.map((g) => [g, 0]));
  if (!workouts.length) {
    return { groups: [], weeks: [], otherExercises: [], totalSets: 0 };
  }
  const weeks = new Map(weekRange(workouts[0].start, workouts[workouts.length - 1].start)
    .map((w) => [dayKey(w), { key: dayKey(w), label: weekLabel(w), counts: { ...empty } }]));
  const totals = { ...empty };
  let totalSets = 0;
  for (const w of workouts) {
    const week = weeks.get(weekKey(w.start));
    for (const s of w.sets.filter(isWorkSet)) {
      const group = exercises.get(s.exKey).group;
      week.counts[group] += 1;
      totals[group] += 1;
      totalSets += 1;
    }
  }
  const weekList = [...weeks.values()];
  const recent = weekList.slice(-recentWeeks);
  const groups = MUSCLE_GROUPS.map((group) => {
    const recentAvg = recent.reduce((sum, w) => sum + w.counts[group], 0) / recent.length;
    return {
      group,
      sets: totals[group],
      recentAvg,
      totalAvg: totals[group] / weekList.length,
      share: totalSets ? totals[group] / totalSets : 0,
      underTrained: !UNMARKED_GROUPS.includes(group) && recentAvg < MIN_WEEKLY_SETS,
    };
  });
  const otherExercises = [...exercises.values()].filter((e) => e.group === 'Sonstiges').map((e) => e.name);
  return { groups, weeks: weekList.slice(-chartWeeks), otherExercises, totalSets };
}

/**
 * Computes the fun facts.
 * @param {object} data Parsed data.
 * @param {object} settings User settings.
 * @returns {object|null} Volume comparisons, biggest session, heaviest lift, total reps, strongest month and PRs per
 *   month; null without workouts.
 */
export function funFacts(data, settings) {
  const { workouts, exercises } = data;
  if (!workouts.length) {
    return null;
  }
  const series = timeSeries(data, settings);
  let totalVolumeKg = 0;
  let totalReps = 0;
  let biggestSession = null;
  let heaviestLift = null;
  for (const w of workouts) {
    const volume = workoutVolume(w, exercises, settings);
    totalVolumeKg += volume;
    if (volume > 0 && (!biggestSession || volume > biggestSession.volumeKg)) {
      biggestSession = { volumeKg: volume, date: w.start, title: w.title };
    }
    for (const s of w.sets.filter(isWorkSet)) {
      totalReps += s.reps ?? 0;
      const info = exercises.get(s.exKey);
      if (!info.assisted && s.weightKg > 0 && (!heaviestLift || s.weightKg > heaviestLift.loadKg)) {
        heaviestLift = { loadKg: s.weightKg, exercise: info.name, date: w.start };
      }
    }
  }
  const strongestMonth = series.months.reduce((best, m) => (!best || m.volumeKg > best.volumeKg ? m : best), null);

  const prCounts = new Map(series.months.map((m) => [m.key, 0]));
  const bestE1rm = new Map();
  for (const w of workouts) {
    const sessionBest = new Map();
    for (const s of w.sets.filter(isWorkSet)) {
      const est = e1rm(effectiveLoad(s, exercises.get(s.exKey), settings), s.reps);
      if (est !== null) {
        sessionBest.set(s.exKey, Math.max(sessionBest.get(s.exKey) ?? 0, est));
      }
    }
    for (const [key, value] of sessionBest) {
      const previous = bestE1rm.get(key);
      if (previous !== undefined && value > previous) {
        prCounts.set(monthKey(w.start), prCounts.get(monthKey(w.start)) + 1);
      }
      if (previous === undefined || value > previous) {
        bestE1rm.set(key, value);
      }
    }
  }

  return {
    totalVolumeKg,
    cars: totalVolumeKg / COMPARISONS.car,
    elephants: totalVolumeKg / COMPARISONS.elephant,
    blueWhales: totalVolumeKg / COMPARISONS.blueWhale,
    biggestSession,
    heaviestLift,
    totalReps,
    strongestMonth: strongestMonth && strongestMonth.volumeKg > 0 ? strongestMonth : null,
    prsPerMonth: series.months.map((m) => ({ key: m.key, label: m.label, count: prCounts.get(m.key) })),
  };
}

/**
 * Computes the global strength factor from the e1RM progress of all exercises with enough sessions.
 * Assisted exercises are skipped because their progress is measured as falling assistance.
 * @param {object} data Parsed data.
 * @param {object} settings User settings.
 * @returns {{p: number, medianPct: number|null, exerciseCount: number, fallback: boolean}} Strength factor.
 */
function strengthFactor(data, settings) {
  const g = GAIN_MODEL;
  const percents = [];
  for (const info of data.exercises.values()) {
    if (info.assisted) {
      continue;
    }
    const history = exerciseHistory(data, info.key, settings);
    if (history.metric !== 'e1rm' || history.series.length < g.strengthMinSessions) {
      continue;
    }
    const result = improvement(history.series.map((s) => s.y));
    if (result && result.percent !== null) {
      percents.push(result.percent);
    }
  }
  const medianPct = median(percents);
  if (medianPct === null) {
    return { p: g.strengthFallback, medianPct: null, exerciseCount: 0, fallback: true };
  }
  const p = Math.min(g.strengthMax, Math.max(g.strengthMin, g.strengthBase + medianPct / g.strengthDivisor));
  return { p, medianPct, exerciseCount: percents.length, fallback: false };
}

/**
 * Counts full calendar months between two dates.
 * @param {Date} from Earlier date.
 * @param {Date} to Later date.
 * @returns {number} Full months, at least 0.
 */
function fullMonthsBetween(from, to) {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
  return Math.max(0, to.getDate() < from.getDate() ? months - 1 : months);
}

/**
 * Estimates the muscle mass gained over the training period from literature models.
 * Per calendar month: potential (McDonald, with body weight also Aragon) x covered share x consistency x strength factor.
 * @param {object} data Parsed data.
 * @param {{sex: 'm'|'w', bodyWeightKg: number|null, experience: 'beginner'|'some'|'advanced'}} settings User settings.
 * @returns {object|null} Range `low`/`high` in kg (rounded to 0.1) and all intermediate values; null without workouts.
 */
export function muscleGainEstimate(data, settings) {
  const { workouts } = data;
  if (!workouts.length) {
    return null;
  }
  const g = GAIN_MODEL;
  const firstDay = startOfDay(workouts[0].start);
  const lastDay = startOfDay(workouts[workouts.length - 1].start);
  const endDay = addDays(lastDay, 1);
  const pretraining = g.pretrainingMonths[settings.experience] ?? 0;
  const bodyWeight = settings.bodyWeightKg || null;
  const sexFactor = settings.sex === 'w' ? g.femaleFactor : 1;
  const strength = strengthFactor(data, settings);

  const months = monthRange(firstDay, lastDay).map((monthStart) => {
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    const from = monthStart > firstDay ? monthStart : firstDay;
    const to = monthEnd < endDay ? monthEnd : endDay;
    const coveredDays = Math.max(0, Math.round((to - from) / DAY_MS));
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const fraction = coveredDays / daysInMonth;
    const trainingAge = pretraining + fullMonthsBetween(firstDay, from);
    const rate = [...g.rates].reverse().find((r) => trainingAge >= r.fromMonth);
    let potLow = rate.mcdonaldKg[0];
    let potHigh = rate.mcdonaldKg[1];
    if (bodyWeight) {
      potLow = Math.min(potLow, (rate.aragonPct[0] / 100) * bodyWeight);
      potHigh = Math.max(potHigh, (rate.aragonPct[1] / 100) * bodyWeight);
    }
    potLow *= sexFactor;
    potHigh *= sexFactor;
    const workoutCount = workouts.filter((w) => w.start >= from && w.start < to).length;
    const target = (coveredDays / 7) * g.targetWorkoutsPerWeek;
    const consistency = target > 0 ? Math.min(1, workoutCount / target) : 0;
    return {
      key: monthKey(monthStart),
      label: monthLabel(monthStart),
      coveredDays,
      fraction,
      trainingAge,
      potLow,
      potHigh,
      workouts: workoutCount,
      consistency,
      gainLow: fraction * potLow * consistency * strength.p,
      gainHigh: fraction * potHigh * consistency * strength.p,
    };
  });

  const fractionSum = months.reduce((sum, m) => sum + m.fraction, 0);
  return {
    low: round1(months.reduce((sum, m) => sum + m.gainLow, 0)),
    high: round1(months.reduce((sum, m) => sum + m.gainHigh, 0)),
    months,
    monthsCovered: fractionSum,
    avgConsistency: fractionSum ? months.reduce((sum, m) => sum + m.fraction * m.consistency, 0) / fractionSum : 0,
    p: strength.p,
    medianPct: strength.medianPct,
    strengthExercises: strength.exerciseCount,
    strengthFallback: strength.fallback,
    pretrainingMonths: pretraining,
    trainingAgeEnd: pretraining + fullMonthsBetween(firstDay, endDay),
    model: bodyWeight ? 'mcdonald+aragon' : 'mcdonald',
    sexFactor,
  };
}

/**
 * Builds the training heatmap of the last weeks up to the week of the last workout.
 * Level 0 means no training; levels 1-4 follow the quartiles of work sets on training days.
 * @param {object} data Parsed data.
 * @param {number} [weeks] Number of weeks (columns).
 * @returns {{cells: {key: string, date: Date, sets: number, level: number, trained: boolean}[], weeks: number}} Cells
 *   week by week, Monday to Sunday.
 */
export function heatmap(data, weeks = 53) {
  const { workouts } = data;
  if (!workouts.length) {
    return { cells: [], weeks: 0 };
  }
  const counts = new Map();
  for (const w of workouts) {
    const key = dayKey(w.start);
    counts.set(key, (counts.get(key) ?? 0) + w.sets.filter(isWorkSet).length);
  }
  const sorted = [...counts.values()].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q2 = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const lastWeek = weekStart(workouts[workouts.length - 1].start);
  const firstWeek = addDays(lastWeek, -7 * (weeks - 1));
  const cells = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const date = addDays(firstWeek, i);
    const key = dayKey(date);
    const trained = counts.has(key);
    const sets = counts.get(key) ?? 0;
    let level = 0;
    if (trained) {
      level = sets <= q1 ? 1 : sets <= q2 ? 2 : sets <= q3 ? 3 : 4;
    }
    cells.push({ key, date, sets, level, trained });
  }
  return { cells, weeks };
}
