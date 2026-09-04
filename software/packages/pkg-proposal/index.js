/**
 * @shaper/pkg-proposal — the workshop, executable.
 *
 * Intent: software/packages/pkg-proposal/INTENT.md
 *
 * Pure by construction: no connection, no transaction, no route, no model
 * (invariant 1). The caller brings the material and whatever an agent filled;
 * this package decides what may be proposed, seals it, and later decides what
 * an acceptance is allowed to execute. It never executes.
 */

import { createHash } from 'node:crypto';

export class Refused extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'Refused';
    this.code = code;
    this.detail = detail;
  }
}

const refuse = (code, message, detail) => { throw new Refused(code, message, detail); };

/** Argument types a catalogue may declare. A class picks; it never invents. */
export const ARG_TYPES = ['text', 'number', 'date', 'money', 'choice', 'ref', 'boolean'];

/** What a tool does to the world. `read` answers; `write` changes. */
export const TOOL_KINDS = ['read', 'write'];

/** How far a write reaches — invariant 13. */
export const REACHES = ['record', 'universe'];

export const LIMITS = {
  toolName: /^[a-z][a-z0-9_]{1,40}$/,
  argName: /^[a-z][a-z0-9_]{1,40}$/,
  maxToolsPerCatalogue: 40,
  maxArgsPerTool: 12,
  maxLinesPerProposal: 40,
  maxMaterialChars: 20000,
  maxSpanChars: 400,
};

/**
 * Anything that looks like an instruction or an expression is refused wherever
 * a label is expected: a catalogue is inert data, never a place to write code
 * or to smuggle a standing instruction (invariants 2 and 11). The patterns are
 * the ones `sectors/schema.js` already refuses, plus the shapes a prompt
 * injection takes when it hides in a declaration.
 */
const FORBIDDEN_IN_TEXT = [
  { pattern: /\{\{|\}\}/, why: 'interpolation syntax — a label is text, not a template' },
  { pattern: /\$\{/, why: 'template literal — a label is text, not code' },
  { pattern: /<\s*script/i, why: 'markup — a label is text, not a document' },
];

function inertText(value, path, max = 200) {
  if (typeof value !== 'string' || !value.trim()) refuse('label', `${path}: a non-empty string is required`);
  if (value.length > max) refuse('label', `${path}: longer than ${max} characters`);
  for (const { pattern, why } of FORBIDDEN_IN_TEXT) {
    if (pattern.test(value)) refuse('label', `${path}: ${why}`);
  }
  return value;
}

/**
 * Validate and freeze a class's tool catalogue. Closed by construction: a name
 * absent from here can never be filled, proposed, or executed (invariant 2).
 */
export function defineCatalogue(declaration) {
  if (!declaration || typeof declaration !== 'object') refuse('catalogue', 'a catalogue is an object of tools');
  const names = Object.keys(declaration);
  if (names.length > LIMITS.maxToolsPerCatalogue) {
    refuse('catalogue', `more than ${LIMITS.maxToolsPerCatalogue} tools`);
  }
  const tools = {};
  for (const name of names) {
    if (!LIMITS.toolName.test(name)) refuse('tool', `"${name}": not a tool name`);
    const raw = declaration[name] || {};
    const kind = raw.kind;
    if (!TOOL_KINDS.includes(kind)) refuse('tool', `${name}: kind must be one of ${TOOL_KINDS.join(', ')}`);

    // Invariant 13: a write declares whether it comes back and how far it
    // reaches. A read declares neither — it changes nothing to undo.
    let reversible = null;
    let reaches = null;
    let touches = null;
    if (kind === 'write') {
      if (typeof raw.reversible !== 'boolean') {
        refuse('tool', `${name}: a write declares whether accepting it can be undone (reversible: true|false)`);
      }
      reversible = raw.reversible;
      reaches = raw.reaches ?? 'record';
      if (!REACHES.includes(reaches)) refuse('tool', `${name}: reaches must be one of ${REACHES.join(', ')}`);
      // Invariant 12: a write names every field it touches.
      if (!Array.isArray(raw.touches) || raw.touches.length === 0) {
        refuse('tool', `${name}: a write names every field it touches (touches: [...])`);
      }
      touches = raw.touches.map((f, i) => inertText(f, `${name}.touches[${i}]`, 60));
    } else if ('reversible' in raw || 'touches' in raw) {
      refuse('tool', `${name}: a read declares neither reversible nor touches — it changes nothing`);
    }

    // Invariant 7: standing acceptance is declared per tool, and never for a
    // tool that cannot be undone.
    const standing = raw.standingAcceptable === true;
    if (standing && kind === 'write' && reversible === false) {
      refuse('tool', `${name}: an irreversible write can never be accepted by a standing rule`);
    }

    const argsRaw = raw.args || {};
    const argNames = Object.keys(argsRaw);
    if (argNames.length > LIMITS.maxArgsPerTool) refuse('tool', `${name}: more than ${LIMITS.maxArgsPerTool} arguments`);
    const args = {};
    for (const argName of argNames) {
      if (!LIMITS.argName.test(argName)) refuse('arg', `${name}.${argName}: not an argument name`);
      const spec = argsRaw[argName] || {};
      if (!ARG_TYPES.includes(spec.type)) {
        refuse('arg', `${name}.${argName}: type must be one of ${ARG_TYPES.join(', ')}`);
      }
      if (spec.type === 'choice') {
        if (!Array.isArray(spec.options) || spec.options.length === 0) {
          refuse('arg', `${name}.${argName}: a choice declares its options`);
        }
        spec.options.forEach((o, i) => inertText(String(o), `${name}.${argName}.options[${i}]`, 60));
      }
      args[argName] = Object.freeze({
        type: spec.type,
        required: spec.required === true,
        max: Number.isFinite(spec.max) ? spec.max : null,
        options: spec.type === 'choice' ? Object.freeze([...spec.options]) : null,
      });
    }

    tools[name] = Object.freeze({
      name, kind, reversible, reaches, touches: touches && Object.freeze(touches), standingAcceptable: standing, args: Object.freeze(args),
    });
  }
  // An empty catalogue is valid: a class that has declared no capability can
  // propose nothing, which is the honest behaviour.
  return Object.freeze(tools);
}

/** The reserved tool every catalogue carries, whatever it declared. */
export const UNKNOWN = 'unknown';

function checkArgument(tool, argName, value, spec) {
  const where = `${tool}.${argName}`;
  switch (spec.type) {
    case 'text':
      if (typeof value !== 'string') refuse('arg', `${where}: expected text`);
      if (spec.max && value.length > spec.max) refuse('arg', `${where}: longer than ${spec.max}`);
      return value;
    case 'number':
    case 'money': {
      if (typeof value !== 'number' || !Number.isFinite(value)) refuse('arg', `${where}: expected a number`);
      if (spec.max !== null && value > spec.max) refuse('arg', `${where}: greater than ${spec.max}`);
      return value;
    }
    case 'boolean':
      if (typeof value !== 'boolean') refuse('arg', `${where}: expected true or false`);
      return value;
    case 'date':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) refuse('arg', `${where}: expected a date`);
      return value;
    case 'choice':
      if (!spec.options.includes(value)) refuse('arg', `${where}: not one of ${spec.options.join(', ')}`);
      return value;
    case 'ref':
      if (typeof value !== 'string' && !Number.isInteger(value)) refuse('arg', `${where}: expected a reference`);
      return value;
    default:
      return refuse('arg', `${where}: unknown type`);
  }
}

export function digestOf(material) {
  return `sha256:${createHash('sha256').update(String(material), 'utf8').digest('hex')}`;
}

/**
 * Turn what an agent filled into a sealed proposal.
 *
 * Every line is validated against the catalogue (invariants 2, 3) and its span
 * is RESOLVED against the material as received (invariant 4): a line whose
 * span does not match the words it claims is refused by name, so a composed
 * quotation cannot vouch for a composed value.
 */
export function propose({
  material, filled = [], catalogue, authority = null, filledBy = 'agent', now = 0, lifeMs = 15 * 60 * 1000,
}) {
  if (typeof material !== 'string') refuse('material', 'material must be text');
  if (material.length > LIMITS.maxMaterialChars) {
    refuse('bound', `material longer than ${LIMITS.maxMaterialChars} characters`, { max: LIMITS.maxMaterialChars });
  }
  if (!Array.isArray(filled)) refuse('filled', 'filled must be a list of tools');
  if (filled.length > LIMITS.maxLinesPerProposal) {
    refuse('bound', `more than ${LIMITS.maxLinesPerProposal} lines`, { max: LIMITS.maxLinesPerProposal });
  }

  const lines = filled.map((entry, index) => {
    const id = `L${index + 1}`;
    const name = entry?.tool;
    if (name !== UNKNOWN && !catalogue[name]) {
      refuse('catalogue', `${id}: "${name}" is not a tool this class declared`, { line: id, tool: name });
    }
    const tool = name === UNKNOWN ? { name: UNKNOWN, kind: 'read', reversible: null, reaches: null, standingAcceptable: false, args: {} } : catalogue[name];

    // The span: offsets into the material as received.
    const span = entry?.span;
    if (!span || !Number.isInteger(span.at) || !Number.isInteger(span.length)) {
      refuse('span', `${id}: every line carries a span into the material`, { line: id });
    }
    if (span.at < 0 || span.length <= 0 || span.at + span.length > material.length) {
      refuse('span', `${id}: span falls outside the material`, { line: id, span });
    }
    if (span.length > LIMITS.maxSpanChars) refuse('bound', `${id}: span longer than ${LIMITS.maxSpanChars}`, { line: id });
    const quoted = material.slice(span.at, span.at + span.length);
    // If the caller also sent the words, they must BE the words.
    if (typeof entry.fragment === 'string' && entry.fragment !== quoted) {
      refuse('span', `${id}: the fragment is not what the span says`, { line: id, claimed: entry.fragment, actual: quoted });
    }

    const args = {};
    if (name !== UNKNOWN) {
      const given = entry.args || {};
      for (const [argName, spec] of Object.entries(tool.args)) {
        if (!(argName in given)) {
          if (spec.required) refuse('arg', `${id}: ${name}.${argName} is required`, { line: id });
          continue;
        }
        args[argName] = checkArgument(name, argName, given[argName], spec);
      }
      for (const argName of Object.keys(given)) {
        if (!(argName in tool.args)) refuse('arg', `${id}: ${name} declares no argument "${argName}"`, { line: id });
      }
    }

    const needs = Array.isArray(entry.needs) ? entry.needs.map(String) : [];

    // Invariants 5 and 13: what is not understood, and what cannot be undone,
    // arrive unticked — and the irreversible arrives alone.
    const irreversible = tool.kind === 'write' && tool.reversible === false;
    const ticked = !(name === UNKNOWN || irreversible) && entry.ticked !== false;

    return Object.freeze({
      id, tool: tool.name, kind: tool.kind, args: Object.freeze(args),
      span: Object.freeze({ at: span.at, length: span.length }), fragment: quoted,
      needs: Object.freeze(needs), ticked, irreversible,
      reaches: tool.reaches, reason: name === UNKNOWN ? inertText(entry.reason || 'not understood', `${id}.reason`) : null,
    });
  });

  const known = new Set(lines.map((l) => l.id));
  for (const line of lines) {
    for (const need of line.needs) {
      if (!known.has(need)) refuse('needs', `${line.id}: needs ${need}, which is not in this proposal`, { line: line.id });
    }
  }
  // Invariant 13: an irreversible line travels alone.
  const irreversibles = lines.filter((l) => l.irreversible);
  if (irreversibles.length && lines.length > 1) {
    refuse('alone', `${irreversibles[0].id}: what cannot be undone is proposed alone`, { line: irreversibles[0].id });
  }

  const materialDigest = digestOf(material);
  return Object.freeze({
    id: `prop-${materialDigest.slice(7, 19)}-${lines.length}`,
    materialDigest,
    filledBy,
    authority,
    lines: Object.freeze(lines),
    staleAfter: now + lifeMs,
  });
}

/**
 * What an acceptance is allowed to execute.
 *
 * The acceptance names a proposal by identity and the lines it keeps; the
 * arguments are the ones already proposed, never re-supplied (invariant 6).
 * Returns the ordered calls, or throws a typed refusal that names the line.
 */
export function accept({ proposal, keep = [], authority = null, now = 0, standing = false }) {
  if (!proposal || !proposal.id) refuse('proposal', 'an acceptance names a proposal');
  if (now > proposal.staleAfter) refuse('stale', `proposal ${proposal.id} is stale`, { id: proposal.id });
  if (proposal.authority && proposal.authority !== authority) {
    refuse('authority', 'a proposal is not accepted under another authority', { made: proposal.authority, given: authority });
  }
  const kept = new Set(keep.map(String));
  const byId = new Map(proposal.lines.map((l) => [l.id, l]));
  for (const id of kept) if (!byId.has(id)) refuse('line', `${id}: not a line of ${proposal.id}`, { line: id });

  for (const id of kept) {
    const line = byId.get(id);
    if (line.tool === UNKNOWN) refuse('unknown', `${id}: what was not understood cannot be accepted`, { line: id });
    // Invariant 9: a line may declare it needs another.
    for (const need of line.needs) {
      if (!kept.has(need)) {
        refuse('needs', `${id} needs ${need}, which was not kept`, { line: id, needs: need });
      }
    }
    // Invariant 7: a standing rule accepts only what the catalogue allows it to.
    if (standing && !(line.kind === 'read' || line.reaches === 'record')) {
      refuse('standing', `${id}: this line is not standing-acceptable`, { line: id });
    }
  }

  const calls = proposal.lines
    .filter((l) => kept.has(l.id))
    .map((l) => Object.freeze({ line: l.id, tool: l.tool, kind: l.kind, args: l.args }));

  return Object.freeze({
    proposal: proposal.id,
    materialDigest: proposal.materialDigest,
    authority,
    acceptedAt: now,
    calls: Object.freeze(calls),
    // Invariant 8: the caller applies these whole, or none — and invariant 10:
    // this key is what makes a second attempt create once.
    idempotencyKey: `${proposal.id}:${[...kept].sort().join(',')}`,
  });
}
