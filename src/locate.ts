/**
 * The locator: where in the linted file a finding is reported, and with
 * what message.
 *
 * A finding is first tied to the entry that owns it:
 *
 * - a merge finding uses its `entry` when it carries one;
 * - a graph finding, and a merge finding that carries no `entry`, takes
 *   the longest prefix of its path (the path itself first, the empty path
 *   last) holding a `set` or `replace` provenance record, and the last
 *   such record there.
 *
 * The owning entry's index counts the `defaults` first. An index below
 * the defaults count names a `defaults` entry, which has no node in the
 * file: the finding is reported on the `defineConfig` callee with its
 * message prefixed {@link DEFAULTS_PREFIX}. Any other index names the
 * file's element `entry - defaultsCount`, and the finding's path is
 * walked down that element's `ObjectExpression` (see {@link walkPath}).
 * A finding tied to no entry is reported on the `defineConfig(` call with
 * its message as the library wrote it.
 *
 * @module
 */
import type { Analysis } from './analysis/analyse';
import type { KeyPath, ReadEntries } from './reader/read-entries';
import type { Diagnostic, MergeResult, ProvenanceRecord } from '@open-tomato/define-config';
import type { TSESTree } from '@typescript-eslint/types';

import { provenanceOf } from '@open-tomato/define-config';

import { unwrap } from './reader/read-entries';

/**
 * The words put in front of the message of a finding owned by a
 * `defaults` entry, which the linted file did not write.
 */
export const DEFAULTS_PREFIX = '(from defaults)';

/**
 * Which stage produced a finding: `merge` for the merge's diagnostics,
 * `graph` for `resolveGraph`'s. It decides how the owning entry is found.
 */
export type FindingSource = 'merge' | 'graph';

/**
 * Where a finding is reported: the node ESLint underlines and the message
 * shown there.
 */
export interface Located {
  /**
   * The deepest `Property` the finding's path reaches in its entry, the
   * entry's element when the path's first key misses, the `defineConfig`
   * callee for a `defaults` entry, or the `defineConfig(` call when no
   * entry owns the finding.
   */
  readonly node: TSESTree.Node;
  /** The library's message, prefixed {@link DEFAULTS_PREFIX} for a `defaults` entry. */
  readonly message: string;
}

/** What the locator needs from the static reader: the call and its element nodes. */
export type LocatedRead = Pick<ReadEntries, 'call' | 'elements'>;

/** What the locator needs from the analysis: the defaults count and the merge's provenance. */
export type LocatedAnalysis = Pick<Analysis, 'defaultsCount'> & {
  /** The merge's result; only its `provenance` is read. */
  readonly merge: Pick<MergeResult, 'provenance'>;
};

/** A property matched by one step of the walk, with how many path keys its key spans. */
interface Step {
  readonly property: TSESTree.Property;
  readonly span: number;
}

/** Whether a provenance record wrote a value at its path, rather than removing one. */
const writes = (record: ProvenanceRecord): boolean => record.kind === 'set' || record.kind === 'replace';

/**
 * Every prefix of `path`, longest first: the path itself down to the
 * empty path.
 *
 * @param path - A finding's key path.
 * @returns `path.length + 1` prefixes, from `path` to `[]`.
 */
export const prefixesOf = (path: KeyPath): readonly KeyPath[] => [...path, '']
  .map((_, index) => path.slice(0, path.length - index));

/**
 * The entry that last wrote the deepest written part of `path`: the last
 * `set` or `replace` record at the longest prefix of `path` that has one.
 * A prefix holding only `remove` records is passed over for a shorter
 * one, since a removal leaves nothing the finding could be about.
 *
 * @example
 * ```ts
 * const result = merge([{ a: { b: 1 } }, { a: { b: 2 } }, { a: { b: false } }]);
 * entryByProvenance(result, ['a', 'b']); // 1: entry 2 only removed it
 * entryByProvenance(result, ['a', 'b', 'c']); // 1, from the prefix a.b
 * entryByProvenance(result, ['z']); // undefined
 * ```
 *
 * @param merge - The merge's result; only its `provenance` is read.
 * @param path - The finding's key path.
 * @returns The merge index of that entry, or `undefined` when no prefix
 *   of `path` was ever written.
 */
export const entryByProvenance = (merge: Pick<MergeResult, 'provenance'>, path: KeyPath): number | undefined => prefixesOf(path)
  .map((prefix) => provenanceOf(merge, prefix).filter(writes)
    .at(-1))
  .find((record) => record !== undefined)
  ?.entry;

/**
 * The merge index of the entry that owns a finding: a merge finding's own
 * `entry` when it carries one, otherwise {@link entryByProvenance} over
 * its path. A graph finding's `entry`, should it carry one, is not a
 * merge index and is not read.
 *
 * @param diagnostic - The finding.
 * @param source - The stage that produced it.
 * @param merge - The merge's result; only its `provenance` is read.
 * @returns The merge index of the owning entry, `defaults` first, or
 *   `undefined` when none owns it.
 */
export const entryOf = (
  diagnostic: Diagnostic,
  source: FindingSource,
  merge: Pick<MergeResult, 'provenance'>,
): number | undefined => source === 'merge' && diagnostic.entry !== undefined
  ? diagnostic.entry
  : entryByProvenance(merge, diagnostic.path);

/** The key a property is written under, as the runtime spells it, or `undefined` for a computed key. */
const keyOf = (property: TSESTree.Property): string | undefined => {
  if (property.computed) {
    return undefined;
  }
  return property.key.type === 'Identifier'
    ? property.key.name
    : String(property.key.value);
};

/**
 * How many keys of `path`, from index `from`, the written key `key`
 * spans: `n` when those `n` keys dot-join to `key`, so a dotted key
 * `'a.b'` spans `['a', 'b']`, and a path key that itself holds a dot is
 * matched by the same key written whole.
 */
const spanOf = (key: string, path: KeyPath, from: number): number | undefined => path
  .slice(from)
  .map((_, index) => index + 1)
  .find((span) => path.slice(from, from + span).join('.') === key);

/**
 * The property of `object` that the keys of `path` from `from` lead to.
 * When more than one matches, the last written wins, as a repeated key
 * does at runtime.
 */
const stepInto = (object: TSESTree.ObjectExpression, path: KeyPath, from: number): Step | undefined => object.properties
  .flatMap((member): readonly Step[] => {
    const key = member.type === 'Property'
      ? keyOf(member)
      : undefined;
    const span = key === undefined
      ? undefined
      : spanOf(key, path, from);
    return member.type === 'Property' && span !== undefined
      ? [{ property: member, span }]
      : [];
  })
  .at(-1);

/** Walk on from `object` at key index `from`, `reached` being the deepest node matched so far. */
const walkFrom = (
  object: TSESTree.ObjectExpression,
  path: KeyPath,
  from: number,
  reached: TSESTree.ObjectExpression | TSESTree.Property,
): TSESTree.ObjectExpression | TSESTree.Property => {
  const step = from < path.length
    ? stepInto(object, path, from)
    : undefined;
  if (step === undefined) {
    return reached;
  }
  const value = unwrap(step.property.value);
  return value.type === 'ObjectExpression'
    ? walkFrom(value, path, from + step.span, step.property)
    : step.property;
};

/**
 * Walk `path` down an element's object literal, property by property, and
 * return the deepest `Property` reached. A written key matches the run of
 * path keys it dot-joins to, so `'a.b': 1` is reached by `['a', 'b']`.
 * The walk stops at the first key that misses, at a value that is not an
 * object literal (`as` and `satisfies` unwrapped), or at the path's end.
 *
 * @example
 * ```ts
 * // element: { flows: { 'f.a': { step: 'nope' } } }
 * walkPath(element, ['flows', 'f', 'a', 'step']); // the `step` Property
 * walkPath(element, ['flows', 'g']); // the `flows` Property
 * walkPath(element, ['other']); // the element itself
 * ```
 *
 * @param element - One element of the `defineConfig(` array.
 * @param path - A finding's key path.
 * @returns The deepest `Property` reached, or `element` when the path's
 *   first key misses or the path is empty.
 */
export const walkPath = (
  element: TSESTree.ObjectExpression,
  path: KeyPath,
): TSESTree.ObjectExpression | TSESTree.Property => walkFrom(element, path, 0, element);

/**
 * Where to report one surviving finding, by the rules in this module's
 * description.
 *
 * @example
 * ```ts
 * // settings: { defaults: [{ seed: true }] }
 * // file: defineConfig([{ a: 1 }, { a: 2 }])
 * const [finding] = suppress(analysis).merge; // duplicate-key at a, entry 2
 * locate(finding, 'merge', read, analysis);
 * // { node: <the `a: 2` Property>, message: finding.message }
 * ```
 *
 * @param diagnostic - A finding that survived the suppression.
 * @param source - The stage that produced it.
 * @param read - The file's `defineConfig(` call and element nodes, as
 *   `readEntries` returns them.
 * @param analysis - The file's analysis: its defaults count and merge.
 * @returns The node to report on and the message to report.
 */
export const locate = (
  diagnostic: Diagnostic,
  source: FindingSource,
  read: LocatedRead,
  analysis: LocatedAnalysis,
): Located => {
  const entry = entryOf(diagnostic, source, analysis.merge);
  if (entry === undefined) {
    return { node: read.call, message: diagnostic.message };
  }
  if (entry < analysis.defaultsCount) {
    return { node: read.call.callee, message: `${DEFAULTS_PREFIX} ${diagnostic.message}` };
  }
  const element = read.elements[entry - analysis.defaultsCount];
  return element === undefined
    ? { node: read.call, message: diagnostic.message }
    : { node: walkPath(element, diagnostic.path), message: diagnostic.message };
};
