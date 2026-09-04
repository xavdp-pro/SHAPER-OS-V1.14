import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defineCatalogue, propose, accept, digestOf, Refused, UNKNOWN, LIMITS,
} from '../index.js';

// Intent: software/packages/pkg-proposal/INTENT.md
//
// Each test names the invariant it holds and the failure that invariant was
// written to prevent — several of them defects found in this house, not
// hypotheses. The first draft of the INTENT was attacked from four angles and
// came back with eleven blocking defects; these tests are what keeps the
// corrections from being prose.

const SHOP = defineCatalogue({
  match_client: {
    kind: 'read',
    args: { name: { type: 'text', required: true, max: 120 } },
    standingAcceptable: true,
  },
  create_client: {
    kind: 'write',
    reversible: true,
    reaches: 'record',
    touches: ['clients.name', 'clients.phone'],
    args: { name: { type: 'text', required: true }, phone: { type: 'text' } },
  },
  create_task: {
    kind: 'write',
    reversible: true,
    reaches: 'record',
    touches: ['tasks.title', 'tasks.column_id'],
    args: { title: { type: 'text', required: true }, due: { type: 'date' } },
  },
  issue_invoice: {
    kind: 'write',
    reversible: false,
    reaches: 'record',
    touches: ['invoices.number', 'invoices.total'],
    args: { total: { type: 'money', required: true } },
  },
});

const MATERIAL = 'Bonjour c est Mme Leroy, je voudrais 2 bouquets pour samedi, 14 rue des Lilas';
const spanOf = (needle) => {
  const at = MATERIAL.indexOf(needle);
  // A typo in a test would otherwise produce at:-1 and be refused for the
  // wrong reason — the test would go red on a defect that is not the one it
  // names. Caught exactly that way while writing these.
  assert.notEqual(at, -1, `the test material does not contain "${needle}"`);
  return { at, length: needle.length };
};

const refusal = (fn) => {
  try { fn(); } catch (err) {
    assert.ok(err instanceof Refused, `expected a typed refusal, got ${err}`);
    return err;
  }
  return assert.fail('expected a refusal');
};

// ── The catalogue is closed, and inert ────────────────────────────────────

test('invariant 2 — a tool the class did not declare cannot be proposed', () => {
  const err = refusal(() => propose({
    material: MATERIAL, catalogue: SHOP,
    filled: [{ tool: 'delete_everything', span: spanOf('Leroy') }],
  }));
  assert.equal(err.code, 'catalogue');
  assert.match(err.message, /delete_everything/);
});

test('invariant 2 — a catalogue may not smuggle a template or an instruction', () => {
  assert.equal(refusal(() => defineCatalogue({
    tool_a: { kind: 'write', reversible: true, touches: ['{{ system }}'], args: {} },
  })).code, 'label');
  assert.equal(refusal(() => defineCatalogue({
    tool_b: { kind: 'read', args: { pick: { type: 'choice', options: ['<script>x'] } } },
  })).code, 'label');
});

test('an empty catalogue is valid, and can propose nothing — the honest default', () => {
  const empty = defineCatalogue({});
  assert.deepEqual(Object.keys(empty), []);
  assert.equal(refusal(() => propose({
    material: MATERIAL, catalogue: empty, filled: [{ tool: 'anything', span: spanOf('Leroy') }],
  })).code, 'catalogue');
});

test('invariant 12 — a write must name every field it touches', () => {
  const err = refusal(() => defineCatalogue({
    set_field: { kind: 'write', reversible: true, args: {} },
  }));
  assert.equal(err.code, 'tool');
  assert.match(err.message, /names every field it touches/);
});

test('invariant 13 — a write declares whether it comes back', () => {
  assert.match(refusal(() => defineCatalogue({
    pay: { kind: 'write', touches: ['x'], args: {} },
  })).message, /can be undone/);
});

test('invariant 7 — an irreversible write is never standing-acceptable', () => {
  assert.match(refusal(() => defineCatalogue({
    seal: {
      kind: 'write', reversible: false, touches: ['x'], args: {}, standingAcceptable: true,
    },
  })).message, /standing rule/);
});

// ── Arguments are typed, and nothing else crosses ─────────────────────────

test('invariant 3 — a badly typed argument is refused, naming which and why', () => {
  const err = refusal(() => propose({
    material: MATERIAL, catalogue: SHOP,
    filled: [{ tool: 'issue_invoice', span: spanOf('2 bouquets'), args: { total: 'beaucoup' } }],
  }));
  assert.equal(err.code, 'arg');
  assert.match(err.message, /issue_invoice\.total/);
});

test('invariant 3 — an argument the tool never declared is refused', () => {
  assert.equal(refusal(() => propose({
    material: MATERIAL, catalogue: SHOP,
    filled: [{ tool: 'create_task', span: spanOf('samedi'), args: { title: 'x', sql: 'DROP TABLE' } }],
  })).code, 'arg');
});

// ── A fragment is a span, and it is resolved ──────────────────────────────

test('invariant 4 — a composed quotation is refused: the span is the truth', () => {
  const err = refusal(() => propose({
    material: MATERIAL, catalogue: SHOP,
    filled: [{
      tool: 'match_client',
      span: spanOf('Leroy'),
      fragment: 'Mme Dupont', // the model composed it
      args: { name: 'Leroy' },
    }],
  }));
  assert.equal(err.code, 'span');
  assert.equal(err.detail.actual, 'Leroy');
});

test('invariant 4 — a span outside the material is refused', () => {
  assert.equal(refusal(() => propose({
    material: MATERIAL, catalogue: SHOP,
    filled: [{ tool: 'match_client', span: { at: 9000, length: 5 }, args: { name: 'x' } }],
  })).code, 'span');
});

test('invariant 4 — the resolved words travel with the line', () => {
  const p = propose({
    material: MATERIAL, catalogue: SHOP,
    filled: [{ tool: 'match_client', span: spanOf('Mme Leroy'), args: { name: 'Mme Leroy' } }],
  });
  assert.equal(p.lines[0].fragment, 'Mme Leroy');
});

// ── unknown, and what arrives unticked ────────────────────────────────────

test('invariant 5 — unknown is a tool of full standing, and arrives unticked', () => {
  const p = propose({
    material: MATERIAL, catalogue: SHOP,
    filled: [{ tool: UNKNOWN, span: spanOf('2 bouquets'), reason: 'no price for this' }],
  });
  assert.equal(p.lines[0].tool, UNKNOWN);
  assert.equal(p.lines[0].ticked, false);
  assert.equal(p.lines[0].reason, 'no price for this');
});

test('invariant 5 — what was not understood can never be accepted', () => {
  const p = propose({
    material: MATERIAL, catalogue: SHOP,
    filled: [{ tool: UNKNOWN, span: spanOf('bouquets'), reason: 'unknown product' }],
  });
  assert.equal(refusal(() => accept({ proposal: p, keep: ['L1'] })).code, 'unknown');
});

test('invariant 13 — what cannot be undone arrives unticked, and alone', () => {
  const alone = propose({
    material: MATERIAL, catalogue: SHOP,
    filled: [{ tool: 'issue_invoice', span: spanOf('2 bouquets'), args: { total: 64 } }],
  });
  assert.equal(alone.lines[0].ticked, false);
  assert.equal(alone.lines[0].irreversible, true);

  // …and it refuses to travel as the sixth line of a pre-ticked list.
  const err = refusal(() => propose({
    material: MATERIAL, catalogue: SHOP,
    filled: [
      { tool: 'create_task', span: spanOf('samedi'), args: { title: 'Préparer' } },
      { tool: 'issue_invoice', span: spanOf('2 bouquets'), args: { total: 64 } },
    ],
  }));
  assert.equal(err.code, 'alone');
});

// ── The acceptance ────────────────────────────────────────────────────────

const twoLines = () => propose({
  material: MATERIAL, catalogue: SHOP, authority: 'sandrine',
  filled: [
    { tool: 'create_client', span: spanOf('Mme Leroy'), args: { name: 'Mme Leroy', phone: '0612' } },
    {
      tool: 'create_task', span: spanOf('samedi'), args: { title: 'Préparer 2 bouquets' }, needs: ['L1'],
    },
  ],
});

test('invariant 6 — the acceptance carries only line ids; the arguments are the proposed ones', () => {
  const p = twoLines();
  const a = accept({ proposal: p, keep: ['L1', 'L2'], authority: 'sandrine' });
  assert.deepEqual(a.calls.map((c) => c.tool), ['create_client', 'create_task']);
  // The surface could not have substituted a value: what executes is what was proposed.
  assert.equal(a.calls[0].args.phone, '0612');
  assert.equal(a.materialDigest, digestOf(MATERIAL));
});

test('invariant 6 — a proposal is not accepted under another authority', () => {
  assert.equal(refusal(() => accept({
    proposal: twoLines(), keep: ['L1'], authority: 'someone-else',
  })).code, 'authority');
});

test('invariant 6 — a stale proposal is no longer executable', () => {
  const p = propose({
    material: MATERIAL, catalogue: SHOP, now: 0, lifeMs: 1000,
    filled: [{ tool: 'create_task', span: spanOf('samedi'), args: { title: 'x' } }],
  });
  assert.equal(refusal(() => accept({ proposal: p, keep: ['L1'], now: 5000 })).code, 'stale');
});

test('invariant 9 — keeping a line whose support was dropped is refused before anything runs', () => {
  const p = twoLines();
  const err = refusal(() => accept({ proposal: p, keep: ['L2'], authority: 'sandrine' }));
  assert.equal(err.code, 'needs');
  // The refusal names both lines, so a surface can untick the dependant.
  assert.equal(err.detail.line, 'L2');
  assert.equal(err.detail.needs, 'L1');
});

test('invariant 10 — the same acceptance carries the same key, so a retry creates once', () => {
  const p = twoLines();
  const first = accept({ proposal: p, keep: ['L1', 'L2'], authority: 'sandrine' });
  const again = accept({ proposal: p, keep: ['L2', 'L1'], authority: 'sandrine' });
  assert.equal(first.idempotencyKey, again.idempotencyKey);
  const fewer = accept({ proposal: p, keep: ['L1'], authority: 'sandrine' });
  assert.notEqual(first.idempotencyKey, fewer.idempotencyKey);
});

test('invariant 7 — a standing rule accepts only what the catalogue lets it', () => {
  const p = twoLines();
  // record-scoped writes are fine for a standing rule…
  assert.ok(accept({
    proposal: p, keep: ['L1'], authority: 'sandrine', standing: true,
  }).calls.length === 1);
});

// ── Bounds ────────────────────────────────────────────────────────────────

test('invariant 15 — the entrance is bounded, and the refusal names the bound', () => {
  const err = refusal(() => propose({
    material: 'x'.repeat(LIMITS.maxMaterialChars + 1), catalogue: SHOP, filled: [],
  }));
  assert.equal(err.code, 'bound');
  assert.equal(err.detail.max, LIMITS.maxMaterialChars);
});

test('a proposal over no material is empty, not an error — nothing was understood', () => {
  const p = propose({ material: MATERIAL, catalogue: SHOP, filled: [] });
  assert.deepEqual(p.lines, []);
  assert.equal(accept({ proposal: p, keep: [] }).calls.length, 0);
});
