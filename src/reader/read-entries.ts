/**
 * The static reader: the entries a config file passes to `defineConfig(`,
 * read from its AST without evaluating it.
 *
 * The reader finds the one call to `defineConfig` imported from
 * `@open-tomato/define-config`, requires every element of its array to be
 * an object literal, and converts each element to a plain value. A value
 * it cannot know statically is an opaque location: it stands in the entry
 * as {@link OPAQUE} and its key path is recorded for that entry.
 *
 * @module
 */
import type { TSESTree } from '@typescript-eslint/types';

/**
 * The module whose `defineConfig` export marks the array the reader reads.
 */
export const DEFINE_CONFIG_SOURCE = '@open-tomato/define-config';

/**
 * The name `defineConfig` is exported under from
 * {@link DEFINE_CONFIG_SOURCE}.
 */
export const DEFINE_CONFIG_EXPORT = 'defineConfig';

/**
 * The marker the reader writes where a value is not a literal: an
 * identifier, a call, a member access, a template with expressions, or an
 * object holding a spread or a computed key. The analysis replaces it
 * before merging; it never reaches the library.
 */
export const OPAQUE: unique symbol = Symbol('define-config/opaque');

/**
 * The type of {@link OPAQUE}.
 */
export type Opaque = typeof OPAQUE;

/**
 * A key path from an entry's root, one array item per object key as
 * written. A dotted key such as `'a.b'` is one item, so `['a.b']` and
 * `['a', 'b']` stay apart even though they dot-join to the same string.
 * The empty path names the entry itself.
 */
export type KeyPath = readonly string[];

/**
 * A value as the reader read it: a JSON-like literal, an array or map of
 * them, or {@link OPAQUE} where the source holds something else.
 */
export type ReadValue =
  | null
  | boolean
  | number
  | string
  | Opaque
  | readonly ReadValue[]
  | ReadObject;

/**
 * An object literal as the reader read it: its keys in runtime order, each
 * with its value.
 */
export interface ReadObject {
  /** The value written at each key. */
  readonly [key: string]: ReadValue;
}

/**
 * The file has no call to the imported `defineConfig`, or has more than
 * one, so it yields no entries.
 */
export interface NoEntries {
  /** Discriminant. */
  readonly kind: 'none';
}

/**
 * The file has one `defineConfig(` call, but its argument is not an array
 * literal whose every element is an object literal (after unwrapping `as`
 * and `satisfies`), so no entry index after the first such element can be
 * known and the file yields no entries.
 */
export interface UnsupportedEntries {
  /** Discriminant. */
  readonly kind: 'unsupported';
  /** The `defineConfig(` call. */
  readonly call: TSESTree.CallExpression;
}

/**
 * The entries of a file's one `defineConfig(` call. The arrays below are
 * parallel: index `i` of each describes the array's element `i`.
 */
export interface ReadEntries {
  /** Discriminant. */
  readonly kind: 'entries';
  /** The `defineConfig(` call. */
  readonly call: TSESTree.CallExpression;
  /**
   * Each element as a plain value, with {@link OPAQUE} at every opaque
   * location. An element holding a spread or a computed key at its top
   * level is itself {@link OPAQUE}.
   */
  readonly entries: readonly ReadValue[];
  /**
   * The key paths of each entry's opaque locations, in source order. An
   * entry that is itself opaque has the one path `[]`.
   */
  readonly opaque: readonly (readonly KeyPath[])[];
  /**
   * Each element's `ObjectExpression` node, with any `as` or `satisfies`
   * around it unwrapped.
   */
  readonly elements: readonly TSESTree.ObjectExpression[];
}

/**
 * What {@link readEntries} makes of a file.
 */
export type ReadResult = NoEntries | UnsupportedEntries | ReadEntries;

/**
 * A value read at some node, with the paths of its opaque locations
 * relative to that node.
 */
interface Read {
  readonly value: ReadValue;
  readonly opaque: readonly KeyPath[];
}

/** The read of a node that is opaque as a whole. */
const OPAQUE_HERE: Read = { value: OPAQUE, opaque: [[]] };

/** The shared result for a file that yields no entries. */
const NO_ENTRIES: NoEntries = { kind: 'none' };

/** Program keys that hold tokens and comments rather than child nodes. */
const NON_CHILD_KEYS = new Set(['parent', 'tokens', 'comments']);

/** Wrap a literal value that holds no opaque location. */
const known = (value: ReadValue): Read => ({ value, opaque: [] });

/** Whether `value` is an AST node. */
const isNode = (value: unknown): value is TSESTree.Node => typeof value === 'object'
  && value !== null
  && typeof (value as { type?: unknown }).type === 'string';

/** Strip any `as` and `satisfies` wrapped around `node`. */
const unwrap = (node: TSESTree.Node): TSESTree.Node => node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression'
  ? unwrap(node.expression)
  : node;

/** Every node of the tree rooted at `node`, root first. */
function* descendants(node: TSESTree.Node): Generator<TSESTree.Node> {
  yield node;
  for (const [key, child] of Object.entries(node)) {
    if (NON_CHILD_KEYS.has(key)) {
      continue;
    }
    for (const item of Array.isArray(child)
      ? child
      : [child]) {
      if (isNode(item)) {
        yield* descendants(item);
      }
    }
  }
}

/** The name an import specifier imports, whether written as a name or a string. */
const importedName = (specifier: TSESTree.ImportSpecifier): string => specifier.imported.type === 'Identifier'
  ? specifier.imported.name
  : String(specifier.imported.value);

/** The local names `defineConfig` is imported under as a value. */
const defineConfigNames = (program: TSESTree.Program): ReadonlySet<string> => new Set(program.body
  .filter((statement): statement is TSESTree.ImportDeclaration => statement.type === 'ImportDeclaration')
  .filter((declaration) => declaration.source.value === DEFINE_CONFIG_SOURCE && declaration.importKind !== 'type')
  .flatMap((declaration) => declaration.specifiers)
  .filter((specifier): specifier is TSESTree.ImportSpecifier => specifier.type === 'ImportSpecifier')
  .filter((specifier) => specifier.importKind !== 'type' && importedName(specifier) === DEFINE_CONFIG_EXPORT)
  .map((specifier) => specifier.local.name));

/** Read a `Literal` node: strings, numbers, booleans and `null` only. */
const readLiteral = (literal: TSESTree.Literal): Read => {
  if ('regex' in literal || 'bigint' in literal) {
    return OPAQUE_HERE;
  }
  const { value } = literal;
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? known(value)
    : OPAQUE_HERE;
};

/** Read a template literal, known only when it has no expressions. */
const readTemplate = (template: TSESTree.TemplateLiteral): Read => {
  const cooked = template.expressions.length === 0
    ? template.quasis[0]?.value.cooked
    : undefined;
  return typeof cooked === 'string'
    ? known(cooked)
    : OPAQUE_HERE;
};

/** Read a unary expression, known only as a minus on a number literal. */
const readUnary = (unary: TSESTree.UnaryExpression): Read => {
  const argument = unwrap(unary.argument);
  return unary.operator === '-' && argument.type === 'Literal' && typeof argument.value === 'number'
    ? known(-argument.value)
    : OPAQUE_HERE;
};

/** Read an array literal, known only when every element is known. */
const readArray = (array: TSESTree.ArrayExpression): Read => {
  const reads = array.elements.map((element) => element === null || element.type === 'SpreadElement'
    ? OPAQUE_HERE
    : readValue(element));
  return reads.every((read) => read.opaque.length === 0)
    ? known(reads.map((read) => read.value))
    : OPAQUE_HERE;
};

/** Whether `property` is `__proto__: value`, which sets the prototype rather than a key. */
const setsPrototype = (property: TSESTree.PropertyNonComputedName): boolean => {
  const { key } = property;
  const name = key.type === 'Identifier'
    ? key.name
    : key.value;
  return name === '__proto__' && property.kind === 'init' && !property.method && !property.shorthand;
};

/**
 * Read one member of an object literal as its key and value, or
 * `undefined` when the member makes its whole object opaque: a spread, a
 * computed key, or a `__proto__` setter.
 */
const readMember = (member: TSESTree.ObjectLiteralElement): readonly [string, Read] | undefined => {
  if (member.type === 'SpreadElement' || member.computed || setsPrototype(member)) {
    return undefined;
  }
  const key = member.key.type === 'Identifier'
    ? member.key.name
    : String(member.key.value);
  return [key, member.kind === 'init'
    ? readValue(member.value)
    : OPAQUE_HERE];
};

/**
 * Read an object literal. A later member with a key already written
 * replaces the earlier one's value in its original position, and integer
 * keys sort first, both as at runtime.
 */
const readObject = (object: TSESTree.ObjectExpression): Read => {
  const members = object.properties.map(readMember);
  if (members.some((member) => member === undefined)) {
    return OPAQUE_HERE;
  }
  const byKey = new Map(members.filter((member) => member !== undefined));
  const pairs = [...byKey];
  return {
    value: Object.fromEntries(pairs.map(([key, read]) => [key, read.value])),
    opaque: pairs.flatMap(([key, read]) => read.opaque.map((path) => [key, ...path])),
  };
};

/** Read the value written at `node`. */
const readValue = (node: TSESTree.Node): Read => {
  const value = unwrap(node);
  switch (value.type) {
    case 'Literal':
      return readLiteral(value);
    case 'TemplateLiteral':
      return readTemplate(value);
    case 'UnaryExpression':
      return readUnary(value);
    case 'ArrayExpression':
      return readArray(value);
    case 'ObjectExpression':
      return readObject(value);
    default:
      return OPAQUE_HERE;
  }
};

/**
 * The element nodes of a `defineConfig(` call's array, or `undefined`
 * unless the one argument is an array literal of object literals.
 */
const elementNodes = (call: TSESTree.CallExpression): readonly TSESTree.ObjectExpression[] | undefined => {
  const [argument] = call.arguments;
  if (argument === undefined || argument.type === 'SpreadElement') {
    return undefined;
  }
  const array = unwrap(argument);
  if (array.type !== 'ArrayExpression') {
    return undefined;
  }
  const elements = array.elements.map((element) => element === null || element.type === 'SpreadElement'
    ? undefined
    : unwrap(element));
  return elements.every((element) => element?.type === 'ObjectExpression')
    ? elements as TSESTree.ObjectExpression[]
    : undefined;
};

/** Read the entries of the one `defineConfig(` call. */
const readCall = (call: TSESTree.CallExpression): UnsupportedEntries | ReadEntries => {
  const elements = elementNodes(call);
  if (elements === undefined) {
    return { kind: 'unsupported', call };
  }
  const reads = elements.map(readObject);
  return {
    kind: 'entries',
    call,
    entries: reads.map((read) => read.value),
    opaque: reads.map((read) => read.opaque),
    elements,
  };
};

/**
 * Read the entries a config file passes to `defineConfig(`, statically.
 *
 * The call is the one whose callee is a local name `defineConfig` is
 * imported under, as a value, from {@link DEFINE_CONFIG_SOURCE}; a file
 * with no such call, or with more than one, yields `none`. The call's
 * argument must be an array literal whose every element is an object
 * literal, `as` and `satisfies` unwrapped; otherwise the file is
 * `unsupported`. Inside an element, a string, number, boolean or `null`
 * literal, a template with no expressions, a minus on a number, and
 * object and array literals of those are read as written; anything else
 * is an opaque location (see {@link OPAQUE}). A spread, a computed key or
 * a `__proto__` setter makes its whole enclosing object opaque, and an
 * array with any opaque item is opaque as a whole.
 *
 * @example
 * ```ts
 * import { parse } from '@typescript-eslint/parser';
 *
 * const program = parse(
 *   "import { defineConfig } from '@open-tomato/define-config';\n"
 *   + 'export default defineConfig([{ on: { ok: \'next\', fail: target } }]);',
 *   { sourceType: 'module', range: true, loc: true },
 * );
 * const read = readEntries(program);
 * // read.kind === 'entries'
 * // read.entries → [{ on: { ok: 'next', fail: OPAQUE } }]
 * // read.opaque  → [[['on', 'fail']]]
 * ```
 *
 * @param program - The file's `Program` node, as `@typescript-eslint/parser`
 *   produces it.
 * @returns The entries with their opaque paths and element nodes, or why
 *   the file yields none.
 */
export const readEntries = (program: TSESTree.Program): ReadResult => {
  const names = defineConfigNames(program);
  if (names.size === 0) {
    return NO_ENTRIES;
  }
  const calls = [...descendants(program)].filter((node): node is TSESTree.CallExpression => node.type === 'CallExpression'
    && node.callee.type === 'Identifier'
    && names.has(node.callee.name));
  const [call] = calls;
  return call === undefined || calls.length > 1
    ? NO_ENTRIES
    : readCall(call);
};
