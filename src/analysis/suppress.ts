/**
 * The suppression: which of an analysis's findings could depend on an
 * opaque value, and so are dropped. The analysis merges each opaque value
 * as a placeholder string, which the real value need not match, so a
 * finding the placeholder could have caused, or that the real value could
 * have removed, is never reported. The rule under-reports and never
 * over-reports.
 *
 * - A merge finding is dropped when its `path` is a prefix of an opaque
 *   location's path, or has one as a prefix.
 * - A graph finding for flow `<f>` (its `path` starts `['flows', f]`) is
 *   dropped when any opaque location lies under `flows.<f>` or above it,
 *   whether the file wrote it there itself or it stands inside a
 *   `$replace` over that flow. The graph resolves each flow on its own,
 *   so an opaque value in another flow never touches it.
 * - A graph finding whose path names no flow is kept only when no opaque
 *   location lies under `flows`, or above it, at all.
 *
 * An opaque location whose last key is `$replace` stands for the whole
 * object holding it, since a `$replace` that is true at runtime replaces
 * that object's merged subtree where the placeholder replaces nothing.
 *
 * @module
 */
import type { Analysis } from './analyse';
import type { KeyPath } from '../reader/read-entries';
import type { Diagnostic } from '@open-tomato/define-config';

/** The key that makes a map replace, rather than merge into, its subtree. */
const REPLACE_KEY = '$replace';

/** The top-level key the graph is resolved from. */
const FLOWS_KEY = 'flows';

/** The path of the whole `flows` section. */
const FLOWS_PATH: KeyPath = [FLOWS_KEY];

/**
 * Whether `prefix` is a prefix of `path`, key by key. Every path has the
 * empty path as a prefix, and every path is a prefix of itself. Keys are
 * compared whole, so `['a']` is not a prefix of `['ab']` nor of `['a.b']`.
 *
 * @param prefix - The candidate prefix.
 * @param path - The path it is checked against.
 * @returns `true` when `path` starts with every key of `prefix`, in order.
 */
export const isPrefix = (prefix: KeyPath, path: KeyPath): boolean => prefix.length <= path.length
  && prefix.every((key, index) => path[index] === key);

/**
 * Whether two paths lie on one line from the root: one is a prefix of the
 * other, so a value at one can change what stands at the other.
 *
 * @param left - One path.
 * @param right - The other path.
 * @returns `true` when either is a prefix of the other.
 */
export const overlaps = (left: KeyPath, right: KeyPath): boolean => isPrefix(left, right) || isPrefix(right, left);

/**
 * The path whose subtree an opaque location can change: its own path, or
 * for an opaque `$replace` the path of the object holding it.
 *
 * @example
 * ```ts
 * reachOf(['flows', 'f', 'a', 'on', 'fail']); // ['flows', 'f', 'a', 'on', 'fail']
 * reachOf(['flows', '$replace']); // ['flows']
 * reachOf(['$replace']); // []
 * ```
 *
 * @param path - An opaque location's key path, as the reader recorded it.
 * @returns The path of the subtree the opaque value can change.
 */
export const reachOf = (path: KeyPath): KeyPath => path[path.length - 1] === REPLACE_KEY
  ? path.slice(0, -1)
  : path;

/**
 * Every subtree the file's opaque locations can change, across all its
 * entries: each opaque path through {@link reachOf}.
 *
 * @param opaque - Each file entry's opaque paths, as `Analysis.opaque`
 *   holds them.
 * @returns One path per opaque location, in entry then source order.
 */
export const opaqueReaches = (opaque: readonly (readonly KeyPath[])[]): readonly KeyPath[] => opaque.flatMap((paths) => paths.map(reachOf));

/**
 * The merge findings no opaque location could influence: those whose
 * `path` overlaps no path in `reaches`. Order is kept.
 *
 * @param diagnostics - The merge's diagnostics.
 * @param reaches - The subtrees opaque locations can change, as
 *   {@link opaqueReaches} returns them.
 * @returns The findings to report.
 */
export const keptMergeFindings = (
  diagnostics: readonly Diagnostic[],
  reaches: readonly KeyPath[],
): readonly Diagnostic[] => diagnostics.filter((diagnostic) => !reaches.some((reach) => overlaps(reach, diagnostic.path)));

/**
 * The part of the config a graph finding depends on: its flow's path
 * `['flows', f]` when its path names one, the whole `flows` section
 * otherwise.
 */
const graphScopeOf = (path: KeyPath): KeyPath => path.length >= 2 && path[0] === FLOWS_KEY
  ? path.slice(0, 2)
  : FLOWS_PATH;

/**
 * The graph findings no opaque location could influence: a finding for
 * flow `<f>` is kept when no path in `reaches` overlaps `['flows', f]`,
 * and a finding naming no flow when none overlaps `['flows']`. Order is
 * kept.
 *
 * @param diagnostics - The graph's diagnostics.
 * @param reaches - The subtrees opaque locations can change, as
 *   {@link opaqueReaches} returns them.
 * @returns The findings to report.
 */
export const keptGraphFindings = (
  diagnostics: readonly Diagnostic[],
  reaches: readonly KeyPath[],
): readonly Diagnostic[] => diagnostics.filter((diagnostic) => {
  const scope = graphScopeOf(diagnostic.path);
  return !reaches.some((reach) => overlaps(reach, scope));
});

/** An analysis's findings that survive the suppression. */
export interface Findings {
  /** The merge's diagnostics no opaque location could influence, in merge order. */
  readonly merge: readonly Diagnostic[];
  /**
   * The graph's diagnostics no opaque location could influence, in graph
   * order; empty when the analysis resolved no graph.
   */
  readonly graph: readonly Diagnostic[];
}

/**
 * The findings of an analysis that no opaque value could have caused or
 * removed, by the rules in this module's description. Nothing passed in
 * is changed.
 *
 * @example
 * ```ts
 * // defineConfig([{ flows: { f: { a: { step: 'lint', on: { fail: target } }, b: { step: 'fix' } } } }])
 * const analysis = analyse(read, settings);
 * // analysis.graph.diagnostics → unknown-step at flows.f.a.on.fail, unreachable at flows.f.b
 * suppress(analysis); // { merge: [], graph: [] }
 * ```
 *
 * @param analysis - The analysis of one file, as `analyse` returns it.
 * @returns The merge and graph findings to report.
 */
export const suppress = (analysis: Pick<Analysis, 'opaque' | 'merge' | 'graph'>): Findings => {
  const reaches = opaqueReaches(analysis.opaque);
  return {
    merge: keptMergeFindings(analysis.merge.diagnostics, reaches),
    graph: keptGraphFindings(analysis.graph?.diagnostics ?? [], reaches),
  };
};
