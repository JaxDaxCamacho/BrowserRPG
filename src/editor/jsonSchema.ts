/**
 * A small subset of JSON Schema, as produced by zod's toJSONSchema, and helpers
 * for building forms from it.
 */
export interface JsonSchema {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
  description?: string;
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function resolve(schema: JsonSchema, root: JsonSchema): JsonSchema {
  let current = schema;
  for (let i = 0; i < 10 && current.$ref; i++) {
    const name = current.$ref.replace(/^#\/(\$defs|definitions)\//, '');
    current = root.$defs?.[name] ?? {};
  }
  if (current.allOf?.length === 1) return resolve(current.allOf[0]!, root);
  return current;
}

export function options(schema: JsonSchema): JsonSchema[] | null {
  return schema.anyOf ?? schema.oneOf ?? null;
}

/** Union of literal values, such as `1 | 2`. */
export function literalChoices(schema: JsonSchema, root: JsonSchema): unknown[] | null {
  const opts = options(schema);
  if (!opts) return null;
  const resolved = opts.map((o) => resolve(o, root));
  return resolved.every((o) => 'const' in o) ? resolved.map((o) => o.const) : null;
}

/** For a union of objects that share a constant field (like "kind"), that field's name. */
export function discriminator(schema: JsonSchema, root: JsonSchema): string | null {
  const opts = options(schema)?.map((o) => resolve(o, root));
  if (!opts || opts.length === 0 || !opts.every((o) => o.properties)) return null;
  const first = opts[0]!;
  for (const key of Object.keys(first.properties!)) {
    if (opts.every((o) => o.properties?.[key] && 'const' in resolve(o.properties[key]!, root))) return key;
  }
  return null;
}

export function branchFor(schema: JsonSchema, root: JsonSchema, key: string, value: unknown): JsonSchema | null {
  const opts = options(schema)?.map((o) => resolve(o, root)) ?? [];
  return opts.find((o) => resolve(o.properties![key]!, root).const === value) ?? null;
}

function typeOf(schema: JsonSchema): string | undefined {
  return Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
}

export function kindOf(schema: JsonSchema): string | undefined {
  return typeOf(schema);
}

/** A starting value that satisfies the schema's required fields. */
export function defaultFor(schema: JsonSchema, root: JsonSchema): Json {
  const s = resolve(schema, root);
  if ('const' in s) return s.const as Json;
  if (s.enum?.length) return s.enum[0] as Json;
  const opts = options(s);
  if (opts?.length) return defaultFor(opts[0]!, root);
  switch (typeOf(s)) {
    case 'object': {
      const out: JsonObject = {};
      for (const key of s.required ?? []) {
        const prop = s.properties?.[key];
        if (prop) out[key] = defaultFor(prop, root);
      }
      return out;
    }
    case 'array': {
      const items: Json[] = [];
      for (let i = 0; i < (s.minItems ?? 0); i++) items.push(s.items ? defaultFor(s.items, root) : null);
      return items;
    }
    case 'number':
    case 'integer':
      return s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 0);
    case 'boolean':
      return false;
    case 'string':
      return '';
    default:
      return null;
  }
}

/** Turns "physicalArmour" into "Physical armour". */
export function labelFor(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
