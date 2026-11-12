/**
 * Parses a Hevy CSV export into workouts, sets and exercise metadata.
 * Pure module without DOM access, usable in the browser and in Node.
 * @module parse
 */

import { muscleGroupOf } from './muscles.js';

const LBS_TO_KG = 0.45359237;
const MILES_TO_KM = 1.609344;

const MONTHS = {
  jan: 0, feb: 1, mär: 2, mar: 2, mrz: 2, apr: 3, mai: 4, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, oct: 9,
  nov: 10, dez: 11, dec: 11,
};

const REQUIRED_COLUMNS = ['title', 'start_time', 'exercise_title', 'set_type', 'reps'];

const DATE_DAY_FIRST = /^(\d{1,2})\.? ([^\s\d,]+) (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([ap]m))?$/i;
const DATE_MONTH_FIRST = /^([^\s\d,]+) (\d{1,2}), (\d{4})(?:,| at)? (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([ap]m))?$/i;
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;
const DATE_DOTTED = /^(\d{1,2})\.(\d{1,2})\.(\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Splits CSV text into records and fields following RFC 4180.
 * Handles quoted fields, doubled quotes, separators and line breaks inside quotes, CRLF/LF,
 * a leading BOM and a last record without trailing line break.
 * @param {string} text Raw CSV text.
 * @returns {string[][]} Records as arrays of field values.
 */
export function parseCsv(text) {
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && src[i + 1] === '\n') {
        i += 1;
      }
    } else {
      field += ch;
    }
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Trims a name and collapses inner whitespace.
 * @param {string} s Raw name.
 * @returns {string} Normalized display name.
 */
export function normalizeName(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Builds the merge key of an exercise name (normalized, lower case).
 * @param {string} s Raw exercise name.
 * @returns {string} Exercise key.
 */
export function exerciseKey(s) {
  return normalizeName(s).toLocaleLowerCase('de');
}

/**
 * Resolves a month token such as "Nov.", "März", "Sept." or "Dec" to a zero-based month index.
 * @param {string} token Month token.
 * @returns {number|undefined} Month index or undefined if unknown.
 */
function monthIndex(token) {
  return MONTHS[token.toLocaleLowerCase('de').replace(/\./g, '').slice(0, 3)];
}

/**
 * Converts a 12-hour clock value to 24 hours.
 * @param {number} hour Hour as written.
 * @param {string|undefined} meridiem "AM", "PM" or undefined for 24-hour values.
 * @returns {number} Hour 0-23, or NaN if the 12-hour value is out of range.
 */
function to24Hour(hour, meridiem) {
  if (!meridiem) {
    return hour;
  }
  if (hour < 1 || hour > 12) {
    return NaN;
  }
  const pm = meridiem.toLowerCase() === 'pm';
  if (hour === 12) {
    return pm ? 12 : 0;
  }
  return pm ? hour + 12 : hour;
}

/**
 * Builds a local date and checks that no field rolled over.
 * @param {number} y Year.
 * @param {number|undefined} m Zero-based month.
 * @param {number} d Day of month.
 * @param {number} h Hour 0-23.
 * @param {number} min Minute.
 * @param {number} sec Second.
 * @returns {Date|null} Date or null if invalid.
 */
function localDate(y, m, d, h, min, sec) {
  if (m === undefined || !(d >= 1 && d <= 31) || !(h >= 0 && h <= 23) || !(min >= 0 && min <= 59) || !(sec >= 0 && sec <= 59)) {
    return null;
  }
  const date = new Date(y, m, d, h, min, sec);
  if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d) {
    return null;
  }
  return date;
}

/**
 * Parses a Hevy date such as "11 Nov. 2026, 12:50" as local time.
 * Also accepts "Nov 11, 2026, 12:50 PM", ISO "2026-11-11 12:50:00" and "11.11.2026 12:50".
 * @param {string} str Date text.
 * @returns {Date} Parsed date.
 * @throws {Error} If the text matches no known format or is not a valid date.
 */
export function parseHevyDate(str) {
  const s = String(str ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  let date = null;
  let m = s.match(DATE_DAY_FIRST);
  if (m) {
    date = localDate(+m[3], monthIndex(m[2]), +m[1], to24Hour(+m[4], m[7]), +m[5], +(m[6] ?? 0));
  } else if ((m = s.match(DATE_MONTH_FIRST))) {
    date = localDate(+m[3], monthIndex(m[1]), +m[2], to24Hour(+m[4], m[7]), +m[5], +(m[6] ?? 0));
  } else if ((m = s.match(DATE_ISO))) {
    if (m[7]) {
      const zoned = new Date(s.replace(' ', 'T'));
      date = Number.isNaN(zoned.getTime()) ? null : zoned;
    } else {
      date = localDate(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
    }
  } else if ((m = s.match(DATE_DOTTED))) {
    date = localDate(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] ?? 0));
  }
  if (!date) {
    throw new Error(`Unrecognized date: "${s}"`);
  }
  return date;
}

/**
 * Reads a column value of a record.
 * @param {{col: Object<string, number>}} ctx Parse context with the column index map.
 * @param {string[]} r Record.
 * @param {string|null} name Column name.
 * @returns {string} Raw value or an empty string.
 */
function cell(ctx, r, name) {
  return name !== null && name in ctx.col ? r[ctx.col[name]] ?? '' : '';
}

/**
 * Parses a numeric cell, warning once per column about invalid values.
 * @param {{col: Object<string, number>, warnings: string[], invalidColumns: Set<string>}} ctx Parse context.
 * @param {string[]} r Record.
 * @param {string|null} name Column name.
 * @param {number} line Line number for the warning.
 * @returns {number|null} Number or null if empty or invalid.
 */
function cellNumber(ctx, r, name, line) {
  const raw = cell(ctx, r, name).trim();
  if (raw === '') {
    return null;
  }
  const value = Number(raw.replace(',', '.'));
  if (Number.isNaN(value)) {
    if (!ctx.invalidColumns.has(name)) {
      ctx.invalidColumns.add(name);
      ctx.warnings.push(`Ungültige Zahl in Spalte "${name}" (Zeile ${line}: "${raw}"), Wert ignoriert.`);
    }
    return null;
  }
  return value;
}

/**
 * Parses a date cell or throws the German import error.
 * @param {string} value Raw date text.
 * @param {number} line Line number for the error.
 * @returns {Date} Parsed date.
 */
function cellDate(value, line) {
  try {
    return parseHevyDate(value);
  } catch {
    throw new Error(`Datum nicht erkannt in Zeile ${line}: "${value}". Erwartet z. B. "11 Nov. 2026, 12:50".`);
  }
}

/**
 * Parses a Hevy CSV export.
 * @param {string} text Raw CSV text.
 * @returns {{workouts: object[], exercises: Map<string, object>, setCount: number, warnings: string[]}}
 *   Workouts sorted by start, exercise infos by key, total set count and German warnings.
 * @throws {Error} With a German message if a required column is missing or a date cannot be parsed.
 */
export function parseHevyCsv(text) {
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const headerText = header.join(', ') || '(leer)';
  const weightCol = 'weight_kg' in col ? 'weight_kg' : 'weight_lbs' in col ? 'weight_lbs' : null;
  const missing = REQUIRED_COLUMNS.find((c) => !(c in col)) ?? (weightCol ? null : 'weight_kg');
  if (missing) {
    throw new Error(`Keine Hevy-CSV: Spalte "${missing}" fehlt. Gefunden: ${headerText}`);
  }
  const distanceCol = 'distance_km' in col ? 'distance_km' : 'distance_miles' in col ? 'distance_miles' : null;
  const weightFactor = weightCol === 'weight_lbs' ? LBS_TO_KG : 1;
  const distanceFactor = distanceCol === 'distance_miles' ? MILES_TO_KM : 1;
  const warnings = [];
  if (weightCol === 'weight_lbs') {
    warnings.push('Gewicht in lbs erkannt, in kg umgerechnet.');
  }
  if (distanceCol === 'distance_miles') {
    warnings.push('Distanz in Meilen erkannt, in km umgerechnet.');
  }

  const ctx = { col, warnings, invalidColumns: new Set() };
  const workoutsById = new Map();
  const exercises = new Map();
  let setCount = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const line = i + 1;
    if (r.length < header.length) {
      if (!(r.length === 1 && r[0].trim() === '')) {
        warnings.push(`Zeile ${line} ist unvollständig und wurde übersprungen.`);
      }
      continue;
    }
    const title = cell(ctx, r, 'title');
    const startRaw = cell(ctx, r, 'start_time');
    const id = `${title}\u0000${startRaw}`;
    let workout = workoutsById.get(id);
    if (!workout) {
      const start = cellDate(startRaw, line);
      const endRaw = cell(ctx, r, 'end_time').trim();
      const end = endRaw === '' ? null : cellDate(endRaw, line);
      workout = {
        id,
        title,
        description: cell(ctx, r, 'description'),
        start,
        end,
        durationMin: end && end > start ? (end - start) / 60000 : null,
        sets: [],
      };
      workoutsById.set(id, workout);
    }

    const rawName = cell(ctx, r, 'exercise_title');
    const exKey = exerciseKey(rawName);
    if (!exercises.has(exKey)) {
      const name = normalizeName(rawName);
      exercises.set(exKey, {
        key: exKey,
        name,
        assisted: /unterstützt|assisted/i.test(name),
        group: muscleGroupOf(name),
      });
    }

    const weight = cellNumber(ctx, r, weightCol, line);
    const distance = cellNumber(ctx, r, distanceCol, line);
    const supersetId = cell(ctx, r, 'superset_id').trim();
    const set = {
      exKey,
      setIndex: cellNumber(ctx, r, 'set_index', line) ?? workout.sets.length,
      type: cell(ctx, r, 'set_type').trim().toLowerCase() || 'normal',
      weightKg: weight === null ? null : weight * weightFactor,
      reps: cellNumber(ctx, r, 'reps', line),
      distanceKm: distance === null ? null : distance * distanceFactor,
      durationS: cellNumber(ctx, r, 'duration_seconds', line),
      rpe: cellNumber(ctx, r, 'rpe', line),
      supersetId: supersetId === '' ? null : supersetId,
    };
    workout.sets.push(set);
    setCount += 1;
  }

  const workouts = [...workoutsById.values()].sort((a, b) => a.start - b.start);
  return { workouts, exercises, setCount, warnings };
}
