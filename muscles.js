/**
 * Maps exercise names to a primary muscle group using ordered keyword rules.
 * The first matching rule wins, so the order of MUSCLE_RULES is significant.
 * @module muscles
 */

/** Muscle groups in display order. */
export const MUSCLE_GROUPS = [
  'Brust',
  'Rücken',
  'Schultern',
  'Bizeps',
  'Trizeps',
  'Beine/Quads',
  'Beinbeuger',
  'Gesäß/Adduktoren/Abduktoren',
  'Waden',
  'Bauch',
  'Cardio',
  'Sonstiges',
];

/** Fallback group for exercises no rule matches. */
export const OTHER_GROUP = 'Sonstiges';

/** Ordered keyword rules; strings match as substrings, regular expressions as given. */
export const MUSCLE_RULES = [
  {
    group: 'Cardio',
    keywords: ['laufband', 'radfahren', 'crosstrainer', 'rudermaschine', 'treppensteigen', /\bgehen\b/, 'joggen',
      /\bboxen\b/, 'burpee', 'aufwärmen', 'warm up', 'treadmill', 'cycling', 'elliptical', 'rowing machine', 'running',
      'walking', 'stair'],
  },
  {
    group: 'Bauch',
    keywords: ['crunch', 'plank', 'russian twist', 'side bend', 'rumpfbeugen', 'sit-up', 'situp', 'beinheben', 'leg raise',
      'bauch', 'ab wheel'],
  },
  { group: 'Waden', keywords: ['wadenheben', 'calf'] },
  { group: 'Beinbeuger', keywords: ['beinbeugen', 'leg curl', 'rumänisch', 'romanian', 'stiff leg'] },
  { group: 'Bizeps', keywords: ['curl', 'bizeps', 'biceps', 'hammer'] },
  { group: 'Trizeps', keywords: ['trizeps', 'triceps', 'stirndrücken', 'skull crusher', 'french press'] },
  {
    group: 'Schultern',
    keywords: ['reverse fliegende', 'reverse butterfly', 'reverse fly', 'rear delt', 'face pull', 'seitheben', 'frontheben',
      'lateral raise', 'front raise', 'schulterpresse', 'shoulder press', 'overhead press', 'military press', 'arnold'],
  },
  {
    group: 'Gesäß/Adduktoren/Abduktoren',
    keywords: ['adduktion', 'abduktion', 'adduct', 'abduct', 'hip thrust', 'glute', 'gesäß', 'kick nach hinten', 'kickback'],
  },
  {
    group: 'Beine/Quads',
    keywords: ['squat', 'kniebeuge', 'beinpress', 'beinstrecken', 'leg press', 'leg extension', 'hackenschmidt', 'hack squat',
      'ausfallschritt', 'lunge'],
  },
  {
    group: 'Brust',
    keywords: ['brust', 'bankdrücken', 'bench', 'fliegende', 'butterfly', 'crossover', 'chest', 'hex press', 'liegestütz',
      'push-up', 'push up', 'pullover', 'überzüge', 'dips', 'pec deck'],
  },
  {
    group: 'Rücken',
    keywords: ['latzug', 'pulldown', 'lat-pulldown', 'rudern', /\brow\b/, 'klimmz', 'pull-up', 'pull up', 'chin-up', 't-bar',
      'hyperextension', 'kreuzheben', 'deadlift', 'schulterheben', 'shrug'],
  },
];

/**
 * Returns the primary muscle group of an exercise.
 * @param {string} name Exercise name in any casing or spacing.
 * @returns {string} One of MUSCLE_GROUPS.
 */
export function muscleGroupOf(name) {
  const text = String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
  const rule = MUSCLE_RULES.find((r) => r.keywords.some((k) => (typeof k === 'string' ? text.includes(k) : k.test(text))));
  return rule ? rule.group : OTHER_GROUP;
}
