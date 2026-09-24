/**
 * The settings reader: the host data the analysis needs, read from
 * eslint's shared `settings['define-config']` and checked before use.
 *
 * A host writes `settings: { 'define-config': { defaults, steps, required,
 * duplicates } }` once in its eslint config. Every field is optional, but
 * each one given must have the shape the library accepts, so a mistake
 * surfaces as one `malformed` result naming the field instead of a
 * `TypeError` thrown out of `merge` or a rule that silently reports
 * nothing. A key the reader does not know is a problem too: a misspelt
 * `step` would otherwise switch the graph rules off without a word.
 *
 * @module
 */
import type { MergeOptions, StepRegistry } from '@open-tomato/define-config';

/**
 * The key under eslint's shared `settings` that holds the plugin's host
 * data.
 */
export const SETTINGS_KEY = 'define-config';

/**
 * How a key path set twice within one layer is reported, as `merge`
 * accepts it: `warn`, `error` or `allow`.
 */
export type DuplicatesSetting = NonNullable<MergeOptions['duplicates']>;

/**
 * The `duplicates` value used when the settings leave it out, the same
 * default `merge` applies.
 */
export const DEFAULT_DUPLICATES: DuplicatesSetting = 'warn';

/** The values `duplicates` may take. */
const DUPLICATES_VALUES: readonly DuplicatesSetting[] = ['warn', 'error', 'allow'];

/** The keys `settings['define-config']` may hold. */
const KNOWN_KEYS: readonly string[] = ['defaults', 'steps', 'required', 'duplicates'];

/** The optional boolean flags of one step in a {@link StepRegistry}. */
const STEP_FLAGS: readonly string[] = ['required', 'pure', 'interactive'];

/**
 * The host data, checked and with every default filled in.
 */
export interface PluginSettings {
  /**
   * Entries merged in front of the file's own, as the loader's first
   * layer; empty when the settings give none.
   */
  readonly defaults: readonly Readonly<Record<string, unknown>>[];
  /**
   * The host's step registry. Absent when the settings give none, in
   * which case the graph is not resolved and no graph finding exists.
   */
  readonly steps?: StepRegistry;
  /** Dot-joined key paths the merged value must hold; empty by default. */
  readonly required: readonly string[];
  /** How a key path set twice within one layer is reported. */
  readonly duplicates: DuplicatesSetting;
}

/**
 * The settings were read and every field given is well formed.
 */
export interface SettingsOk {
  /** Discriminant. */
  readonly kind: 'ok';
  /** The settings, with defaults filled in. */
  readonly settings: PluginSettings;
}

/**
 * `settings['define-config']` is not set at all.
 */
export interface SettingsAbsent {
  /** Discriminant. */
  readonly kind: 'absent';
}

/**
 * `settings['define-config']` is set, but it or one of its fields does
 * not have the shape the library accepts.
 */
export interface SettingsMalformed {
  /** Discriminant. */
  readonly kind: 'malformed';
  /**
   * One line per problem found, each starting with the field it is about
   * (`steps.lint.outcomes: …`), in the order the fields are checked.
   */
  readonly problems: readonly string[];
}

/**
 * What {@link readSettings} returns.
 */
export type SettingsResult = SettingsOk | SettingsAbsent | SettingsMalformed;

/** A short name for the kind of `value`, for problem messages. */
const kindOf = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value)
    ? 'array'
    : typeof value;
};

/**
 * Whether `value` is a plain object: made by a literal or
 * `Object.create(null)`, not an array, a class instance or a function.
 */
const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** The problems with one element of `defaults`. */
const defaultsEntryProblems = (entry: unknown, index: number): string[] => {
  if (!isPlainObject(entry)) {
    return [`defaults[${index}]: expected a plain object, got ${kindOf(entry)}`];
  }
  const layer = entry['$layer'];
  if (layer !== undefined && typeof layer !== 'string') {
    return [`defaults[${index}].$layer: expected a string, got ${kindOf(layer)}`];
  }
  return [];
};

/** The problems with the `defaults` field. */
const defaultsProblems = (value: unknown): string[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [`defaults: expected an array of plain objects, got ${kindOf(value)}`];
  }
  return value.flatMap(defaultsEntryProblems);
};

/** The problems with the `outcomes` of the step registered as `name`. */
const outcomesProblems = (outcomes: unknown, name: string): string[] => {
  if (!Array.isArray(outcomes)) {
    return [`steps.${name}.outcomes: expected an array of strings, got ${kindOf(outcomes)}`];
  }
  return outcomes.flatMap((outcome: unknown, index) => typeof outcome === 'string'
    ? []
    : [`steps.${name}.outcomes[${index}]: expected a string, got ${kindOf(outcome)}`]);
};

/** The problems with the step registered as `name`. */
const stepProblems = ([name, spec]: [string, unknown]): string[] => {
  if (!isPlainObject(spec)) {
    return [`steps.${name}: expected { outcomes, required?, pure?, interactive? }, got ${kindOf(spec)}`];
  }
  const flags = STEP_FLAGS.flatMap((flag) => spec[flag] === undefined || typeof spec[flag] === 'boolean'
    ? []
    : [`steps.${name}.${flag}: expected a boolean, got ${kindOf(spec[flag])}`]);
  return [...outcomesProblems(spec['outcomes'], name), ...flags];
};

/** The problems with the `steps` field. */
const stepsProblems = (value: unknown): string[] => {
  if (value === undefined) {
    return [];
  }
  if (!isPlainObject(value)) {
    return [`steps: expected a step registry object, got ${kindOf(value)}`];
  }
  return Object.entries(value).flatMap(stepProblems);
};

/** The problems with one path of `required`, as `merge` checks it. */
const requiredPathProblems = (path: unknown, index: number): string[] => {
  if (typeof path !== 'string') {
    return [`required[${index}]: expected a dot-joined path, got ${kindOf(path)}`];
  }
  return path.split('.').includes('')
    ? [`required[${index}]: ${JSON.stringify(path)} has an empty key`]
    : [];
};

/** The problems with the `required` field. */
const requiredProblems = (value: unknown): string[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [`required: expected an array of dot-joined paths, got ${kindOf(value)}`];
  }
  return value.flatMap(requiredPathProblems);
};

/** Whether `value` is one of the `duplicates` values. */
const isDuplicatesSetting = (value: unknown): value is DuplicatesSetting => DUPLICATES_VALUES.some((allowed) => allowed === value);

/** The problems with the `duplicates` field. */
const duplicatesProblems = (value: unknown): string[] => value === undefined || isDuplicatesSetting(value)
  ? []
  : [`duplicates: expected 'warn', 'error' or 'allow', got ${JSON.stringify(value) ?? kindOf(value)}`];

/** The problems with keys the reader does not know. */
const unknownKeyProblems = (raw: Readonly<Record<string, unknown>>): string[] => Object.keys(raw)
  .filter((key) => !KNOWN_KEYS.includes(key))
  .map((key) => `${key}: unknown key; expected one of ${KNOWN_KEYS.join(', ')}`);

/**
 * Build the settings from a record every check has passed. The arrays are
 * copied, so a later change to the host's own arrays does not reach them.
 */
const toSettings = (raw: Readonly<Record<string, unknown>>): PluginSettings => {
  const defaults = raw['defaults'] as PluginSettings['defaults'] | undefined;
  const steps = raw['steps'] as StepRegistry | undefined;
  const required = raw['required'] as PluginSettings['required'] | undefined;
  const duplicates = raw['duplicates'] as DuplicatesSetting | undefined;
  return {
    defaults: [...(defaults ?? [])],
    ...(steps === undefined
      ? {}
      : { steps }),
    required: [...(required ?? [])],
    duplicates: duplicates ?? DEFAULT_DUPLICATES,
  };
};

/**
 * Read and check the plugin's host data from eslint's shared settings.
 *
 * @example
 * ```ts
 * readSettings({ 'define-config': { steps: { lint: { outcomes: ['success'] } } } });
 * // { kind: 'ok', settings: { defaults: [], steps: { lint: … }, required: [], duplicates: 'warn' } }
 *
 * readSettings({});
 * // { kind: 'absent' }
 *
 * readSettings({ 'define-config': { duplicates: 'loud' } });
 * // { kind: 'malformed', problems: ["duplicates: expected 'warn', 'error' or 'allow', got \"loud\""] }
 * ```
 *
 * @param shared - eslint's shared settings, as a rule reads them from
 *   `context.settings`; anything that is not an object holds no plugin
 *   settings.
 * @returns `absent` when {@link SETTINGS_KEY} is not set, `malformed`
 *   with every problem found when it or a field has the wrong shape, and
 *   `ok` with defaults filled in otherwise.
 */
export const readSettings = (shared: unknown): SettingsResult => {
  const raw: unknown = typeof shared === 'object' && shared !== null
    ? (shared as Readonly<Record<string, unknown>>)[SETTINGS_KEY]
    : undefined;
  if (raw === undefined) {
    return { kind: 'absent' };
  }
  if (!isPlainObject(raw)) {
    return { kind: 'malformed', problems: [`${SETTINGS_KEY}: expected an object, got ${kindOf(raw)}`] };
  }
  const problems = [
    ...defaultsProblems(raw['defaults']),
    ...stepsProblems(raw['steps']),
    ...requiredProblems(raw['required']),
    ...duplicatesProblems(raw['duplicates']),
    ...unknownKeyProblems(raw),
  ];
  return problems.length > 0
    ? { kind: 'malformed', problems }
    : { kind: 'ok', settings: toSettings(raw) };
};
