/**
 * The analysis: the entries the static reader read from one file, merged
 * behind the host's `defaults` with the library's own `merge`, and the
 * merged `flows` resolved with its own `resolveGraph`, the way the loader
 * runs them.
 *
 * Every entry is stamped with a `$layer` first, as the loader stamps what
 * it reads: a `defaults` entry keeps the `$layer` it carries or gets
 * {@link DEFAULTS_LAYER}, and every file entry gets
 * {@link PROJECT_LAYER}, replacing any `$layer` the file wrote. So a key
 * set once in the defaults and once in the file is not a `duplicate-key`,
 * and a key set twice in the file is.
 *
 * An opaque value is merged as {@link PLACEHOLDER}. The analysis keeps
 * every finding that stand-in produces; dropping the ones an opaque value
 * could influence is the suppression's job, which reads
 * {@link Analysis.opaque}.
 *
 * @module
 */
import type { PluginSettings } from './settings';
import type { KeyPath, ReadEntries, ReadValue } from '../reader/read-entries';
import type { MergeResult } from '@open-tomato/define-config';

import { merge, resolveGraph } from '@open-tomato/define-config';

import { OPAQUE } from '../reader/read-entries';

/**
 * The string an opaque value is merged as. It starts with `$`, which no
 * typed step id may, and no registry is expected to use it as a step or
 * outcome name, so a handler, `step`, `$start` or `when:` naming it never
 * resolves: the graph reports it as unknown at the opaque path, and the
 * suppression drops that finding.
 */
export const PLACEHOLDER = '$define-config/opaque';

/**
 * The `$layer` a `defaults` entry gets when it carries none, the label the
 * loader's first layer is expected to use.
 */
export const DEFAULTS_LAYER = 'defaults';

/**
 * The `$layer` every entry of the linted file gets, replacing any `$layer`
 * the file wrote, as the loader labels the project's own config file.
 */
export const PROJECT_LAYER = 'project';

/** An entry as it is passed to `merge`: a plain object with its `$layer`. */
export type StampedEntry = Readonly<Record<string, unknown>> & { readonly $layer: string };

/** What `resolveGraph` returns: the graph and its diagnostics. */
export type GraphResult = ReturnType<typeof resolveGraph>;

/**
 * The entries a file's analysis needs from the static reader: each
 * entry's value and its opaque paths.
 */
export type AnalysedEntries = Pick<ReadEntries, 'entries' | 'opaque'>;

/**
 * The analysis of one file: what was merged, the merge's result, and the
 * graph's when the host gave steps.
 */
export interface Analysis {
  /**
   * How many `defaults` entries stand in front of the file's in
   * {@link Analysis.entries}. A merge diagnostic's or provenance record's
   * `entry` below it names a `defaults` entry; any other is the file's
   * entry `entry - defaultsCount`.
   */
  readonly defaultsCount: number;
  /**
   * The entries passed to `merge`, stamped: the `defaults`, then the
   * file's with each opaque value as {@link PLACEHOLDER}. A file entry
   * opaque as a whole is an entry with nothing but its `$layer`.
   */
  readonly entries: readonly StampedEntry[];
  /**
   * The key paths of each file entry's opaque locations, as the reader
   * recorded them, indexed by file entry rather than by merge entry.
   */
  readonly opaque: readonly (readonly KeyPath[])[];
  /** The merge of {@link Analysis.entries} with the host's `required` and `duplicates`. */
  readonly merge: MergeResult;
  /**
   * The merged `flows` resolved with the host's steps. Absent when the
   * settings give no `steps`: every step would read as unknown, so no
   * graph finding exists.
   */
  readonly graph?: GraphResult;
}

/** Whether `value` is an object and not an array: a record the merge descends into. */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

/** A read value with every {@link OPAQUE} replaced by {@link PLACEHOLDER}. */
const withPlaceholder = (value: ReadValue): unknown => {
  if (value === OPAQUE) {
    return PLACEHOLDER;
  }
  if (Array.isArray(value)) {
    return value.map(withPlaceholder);
  }
  return isRecord(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withPlaceholder(item as ReadValue)]))
    : value;
};

/** A `defaults` entry with its own `$layer`, or {@link DEFAULTS_LAYER}. */
const stampDefault = (entry: Readonly<Record<string, unknown>>): StampedEntry => {
  const layer = entry['$layer'];
  return {
    ...entry,
    $layer: typeof layer === 'string'
      ? layer
      : DEFAULTS_LAYER,
  };
};

/** A file entry with its placeholders, stamped with {@link PROJECT_LAYER}. */
const stampFileEntry = (entry: ReadValue): StampedEntry => {
  const value = withPlaceholder(entry);
  return {
    ...(isRecord(value)
      ? value
      : {}),
    $layer: PROJECT_LAYER,
  };
};

/**
 * The merged `flows` as `resolveGraph` takes it: a section that is
 * missing or not an object is no flows, as the loader reads it.
 */
const flowsOf = (value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
  const flows = value['flows'];
  return isRecord(flows)
    ? flows
    : {};
};

/**
 * Analyse one file's entries under the host's settings: stamp the layers,
 * merge the `defaults` then the file's entries with each opaque value as
 * {@link PLACEHOLDER}, and resolve the merged `flows` with the settings'
 * `steps` when there are any. Nothing passed in is changed.
 *
 * @example
 * ```ts
 * const read = readEntries(program); // defineConfig([{ a: 1 }, { a: 2, b: someName }])
 * const analysis = analyse(read, { defaults: [{ a: 0 }], required: [], duplicates: 'warn' });
 * // analysis.defaultsCount → 1
 * // analysis.merge.value → { a: 2, b: PLACEHOLDER }
 * // analysis.merge.diagnostics → [{ code: 'duplicate-key', path: ['a'], entry: 2, … }]
 * // analysis.opaque → [[], [['b']]]
 * // analysis.graph → undefined, since no steps were given
 * ```
 *
 * @param read - The file's entries and their opaque paths, as
 *   `readEntries` returns them.
 * @param settings - The host's settings, as `readSettings` checked them.
 * @returns What was merged, the merge's result, and the graph's when the
 *   settings give `steps`.
 */
export const analyse = (read: AnalysedEntries, settings: PluginSettings): Analysis => {
  const entries = [...settings.defaults.map(stampDefault), ...read.entries.map(stampFileEntry)];
  const merged = merge(entries, { required: settings.required, duplicates: settings.duplicates });
  const base = {
    defaultsCount: settings.defaults.length,
    entries,
    opaque: read.opaque,
    merge: merged,
  };
  return settings.steps === undefined
    ? base
    : { ...base, graph: resolveGraph(flowsOf(merged.value), settings.steps) };
};
