/**
 * @file index.js
 * @package @shaper/pkg-universe
 * @description Reads a universe manifest and says whether it is a valid
 * declaration — and if not, exactly where it is wrong.
 *
 * The validator implements the subset of JSON Schema the universe contract
 * actually uses. It carries no dependency on purpose: it must run inside a
 * brick image, on a clean-sheet host, and in a test, without an install step
 * standing between an agent and the answer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Canonical location of the contract this package enforces. */
export const SCHEMA_PATH = path.resolve(HERE, '../../schemas/universe-manifest.schema.json');

/** Layer prefixes from docs/architecture/NAMING.md, as patterns. */
export const LAYER_PATTERNS = {
  universe: /^univ-[a-z0-9][a-z0-9-]*$/,
  brick: /^brick-[a-z0-9][a-z0-9-]*$/,
  package: /^@shaper\/pkg-[a-z0-9][a-z0-9-]*$/,
  image: /^img-[a-z0-9][a-z0-9-]*$/,
};

let cachedSchema = null;

/** Loads the universe manifest schema from disk, once. */
export function loadSchema(schemaPath = SCHEMA_PATH) {
  if (schemaPath === SCHEMA_PATH && cachedSchema) return cachedSchema;
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  if (schemaPath === SCHEMA_PATH) cachedSchema = schema;
  return schema;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(value, expected) {
  const actual = typeOf(value);
  const allowed = Array.isArray(expected) ? expected : [expected];
  return allowed.some((t) => (t === 'number' ? actual === 'integer' || actual === 'number' : t === actual));
}

/**
 * Validates a value against the schema subset used by the universe contract:
 * type, required, enum, pattern, propertyNames, additionalProperties,
 * properties, items, minItems, minProperties, minLength, minimum, maximum.
 *
 * @param {*} value
 * @param {object} schema
 * @param {string} [at] - JSON path of `value`, used in messages
 * @returns {string[]} One message per violation, each naming its path
 */
export function validateAgainstSchema(value, schema, at = '') {
  const errors = [];
  const where = at || '(root)';

  if (schema.type && !typeMatches(value, schema.type)) {
    errors.push(`${where}: expected ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}, found ${typeOf(value)}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${where}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`);
  }

  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${where}: "${value}" does not match ${schema.pattern}`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${where}: must not be empty`);
    }
  }

  if (typeOf(value) === 'integer' || typeOf(value) === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${where}: ${value} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${where}: ${value} is above ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${where}: needs at least ${schema.minItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, i) => errors.push(...validateAgainstSchema(item, schema.items, `${where}[${i}]`)));
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);

    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      errors.push(`${where}: needs at least ${schema.minProperties} entr(y|ies)`);
    }

    for (const required of schema.required || []) {
      if (!(required in value)) errors.push(`${where}: missing required property "${required}"`);
    }

    if (schema.propertyNames?.pattern) {
      const re = new RegExp(schema.propertyNames.pattern);
      for (const key of keys) {
        if (!re.test(key)) errors.push(`${where}: key "${key}" does not match ${schema.propertyNames.pattern}`);
      }
    }

    for (const key of keys) {
      const child = at ? `${at}.${key}` : key;
      const propSchema = schema.properties?.[key];
      if (propSchema) {
        errors.push(...validateAgainstSchema(value[key], propSchema, child));
      } else if (schema.additionalProperties === false) {
        errors.push(`${child}: unknown property (the contract lists what a universe may declare)`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...validateAgainstSchema(value[key], schema.additionalProperties, child));
      }
    }
  }

  return errors;
}

/**
 * Invariants a JSON Schema cannot express, and which are the whole point of a
 * manifest: the boot order must cover every brick exactly once, and a brick's
 * package and image must be the same component as its key.
 *
 * @param {object} manifest
 * @returns {string[]}
 */
export function checkManifestInvariants(manifest) {
  const errors = [];
  const bricks = manifest?.bricks && typeof manifest.bricks === 'object' ? manifest.bricks : {};
  const declared = Object.keys(bricks);

  for (const [key, brick] of Object.entries(bricks)) {
    const component = key.replace(/^brick-/, '');

    // The image is the brick, materialised — those two names must agree, or a
    // universe boots something other than what it declared.
    if (brick?.image && brick.image !== `img-${component}`) {
      errors.push(`bricks.${key}.image: "${brick.image}" is not the image of ${key} (expected img-${component})`);
    }

    // The package need not share the brick's name: `brick-mariadb` is configured
    // by `@shaper/pkg-db`, and `brick-qdrant` by `@shaper/pkg-rag`. Requiring the
    // names to match would force a manifest to misname its own source.
    if (!brick?.package && !brick?.upstream) {
      errors.push(`bricks.${key}: declares neither a package it is built from nor an upstream image it wraps`);
    }

    // Rule 37: a fork states its origin, and only a fork carries one. The
    // schema expresses this as if/then, which validateAgainstSchema's subset
    // does not evaluate — so the invariant is enforced here, in words the
    // schema and the verifier agree on.
    if (brick?.source === 'fork' && !(brick?.forkedFrom?.package && brick?.forkedFrom?.atVersion)) {
      errors.push(`bricks.${key}: source is fork with no forkedFrom { package, atVersion } — a fork whose origin is unknown cannot be maintained (Rule 37)`);
    }
    if (brick?.source && brick.source !== 'fork' && brick?.forkedFrom) {
      errors.push(`bricks.${key}: carries forkedFrom but is not source: fork — one of the two is lying (Rule 37)`);
    }
  }

  const booted = (manifest?.bootOrder || []).flat();
  const seen = new Set();
  for (const name of booted) {
    if (!declared.includes(name)) {
      errors.push(`bootOrder: "${name}" is booted but never declared in bricks`);
    }
    if (seen.has(name)) {
      errors.push(`bootOrder: "${name}" is booted twice`);
    }
    seen.add(name);
  }
  for (const name of declared) {
    if (!seen.has(name)) errors.push(`bootOrder: "${name}" is declared but never booted`);
  }

  return errors;
}

/**
 * Validates a manifest object against the contract and its invariants.
 *
 * @param {object} manifest
 * @param {object} [schema]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManifest(manifest, schema = loadSchema()) {
  const errors = [
    ...validateAgainstSchema(manifest, schema),
    ...checkManifestInvariants(manifest),
  ];
  return { valid: errors.length === 0, errors };
}

/**
 * Reads a manifest from disk and validates it.
 *
 * @param {string} manifestPath
 * @returns {{ valid: boolean, errors: string[], manifest: object|null, path: string }}
 */
export function loadManifest(manifestPath) {
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { valid: false, errors: [`${manifestPath}: unreadable manifest — ${err.message}`], manifest: null, path: manifestPath };
  }
  const { valid, errors } = validateManifest(manifest);
  return { valid, errors, manifest, path: manifestPath };
}

/**
 * The bricks this universe takes from the catalogue rather than the base.
 * The base repository never has to guess: the manifest says it.
 *
 * @param {object} manifest
 * @returns {string[]}
 */
export function catalogueBricks(manifest) {
  return Object.entries(manifest?.bricks || {})
    .filter(([, brick]) => brick?.source === 'catalogue')
    .map(([key]) => key)
    .sort();
}
