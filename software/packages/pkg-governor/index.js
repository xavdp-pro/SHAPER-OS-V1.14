/**
 * @package @shaper/pkg-governor
 * Intent: INTENT.md
 *
 * The governor's contract: desired state written to a ledger, work derived
 * from the gap, makers asking from outside. The governor never dials out and
 * never commands — this module contains no fetch on purpose.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const STATES = ['DESIRED', 'RECONCILING', 'PURRING', 'DEGRADED', 'REAPED'];

/** What a reported event does to a row. A table, not branches: a new event
 *  kind is one line here (the system learns no dialect). Unknown events are
 *  recorded for audit and transition nothing. */
const EVENT_TRANSITIONS = {
  STAMPING: 'RECONCILING',
  STAMPED: 'PURRING',
  STAMP_FAILED: 'DEGRADED',
  REAPING: 'RECONCILING',
  REAPED: 'REAPED',
  REAP_FAILED: 'DEGRADED',
  // A refusal is a fact, not a failure. The reap recipe looked at `env` and
  // would not end a production universe (exit 4). Reported as REAP_FAILED it
  // used to be offered again at every beat, forever — a reap storm on a row
  // no robot may end. Under its own name the row rests: its end is a human
  // decision (Rule 27), and the poll never offers it again.
  REAP_REFUSED: 'DEGRADED',
  VALIDATING: 'PURRING',
  VALIDATED: 'PURRING',
  VALIDATION_FAILED: 'DEGRADED',
  // The fourth kind of work: binding a row to a container that already
  // exists. The stamp cannot adopt — its idempotence is keyed by row id,
  // and "already exists" is only ever its own replay — so a frozen tenant
  // written as a DESIRED row used to be offered a stamp, withheld forever
  // by an inventory it was never part of, or born a second time beside
  // the original. An adoption looks and binds; it creates nothing.
  ADOPTING: 'RECONCILING',
  ADOPTED: 'PURRING',
  ADOPT_FAILED: 'DEGRADED',
};

/** Facts an event must carry to mean what it claims. A STAMPED whose facts
 *  say the container is not running is not a birth: it used to purr all the
 *  same, because the table read the event's name and never its facts. The
 *  word is compared without case — LXD's list column says RUNNING, its API
 *  says Running — and any other word, or none, degrades the row. A second
 *  table, not a branch: the next fact a birth must prove is one line here. */
const running = (v) => typeof v === 'string' && v.toLowerCase() === 'running';
const EVENT_FACTS = {
  STAMPED: { state: running },
  // An adoption purrs only if the recipe looked (the container runs) and
  // said what it bound: `legacy: true`, the recipe's own admission that this
  // instance was born outside the ledger, from no matrix it can name.
  ADOPTED: { state: running, legacy: (v) => v === true },
};
const UNMET_TRANSITION = 'DEGRADED';

/** The digest of a row that was never born from a matrix: an adopted row
 *  binds to a container that already existed. It is a word, not an absence,
 *  so that a missing digest stays the defect it always was — and it is
 *  never a digest a maker could declare in its inventory. */
export const ADOPTED_DIGEST = 'none';

/** The shape of a row's `params`: a flat object of scalars under keys a shell
 *  can carry as `SHAPER_PARAM_<KEY>`. The key grammar is the whole defence
 *  on the maker's side too (poller.mjs builds the recipe's environment from
 *  these keys and nothing else), so it is one regex, shared by name. A key
 *  that could read as a loader or shell variable — LD_PRELOAD, BASH_ENV, a
 *  key with a space — fails the grammar before any allow-list is consulted. */
export const PARAM_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const PARAM_TYPES = new Set(['string', 'number', 'boolean']);

/** A journal on disk: every change appended, the last word per id winning at
 *  boot. The ledger is not like the queue — a queue's durability is evidence
 *  and never resumption, but a ledger IS the desired state: a governor that
 *  forgot its rows would abandon every universe it asked for. So this one is
 *  authoritative, and it is read back in full. */
export function createFileStorage(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    load() {
      if (!fs.existsSync(file)) return [];
      return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    },
    append(record) {
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
    },
  };
}

/** Rule 27, applied to the governor's own offers: a reap that keeps failing
 *  backs off (30s, 1m, 2m, 4m…) and stops after `maxHealingAttempts`; a claim
 *  (STAMPING, REAPING, VALIDATING) silent past `claimBudgetMs` is offered
 *  again. The numbers are options because a fleet's clock is its own; the
 *  bounds themselves are not optional.
 *
 *  `paramsSchema` is the allow-list of what a row may carry to its recipe,
 *  per class: `{ 'univ-x-y': { n: { type: 'number', unique: true } } }`. A
 *  class that declares nothing carries nothing. The product declares it at
 *  creation, because a param is a promise the recipe reads under root and
 *  the governor must know every word of it before a row is written. */
export function createGovernor({
  now = () => Date.now(), storage = null,
  maxHealingAttempts = 5, reapBackoffMs = 30 * 1000, claimBudgetMs = 10 * 60 * 1000,
  paramsSchema = {},
} = {}) {
  const rows = new Map();     // id -> ledger row
  const makers = new Map();   // host -> { token, version, lanes, inventory:Set<digest>, lastPollAt, enrolledAt }
  const refusals = [];        // reports refused at the door — a credential lying about another machine's rows
  let seq = 0;

  /** Persist a snapshot. Inventory is a Set in memory and a list on disk. */
  const persist = (kind, value) => {
    if (!storage) return;
    const body = kind === 'maker' ? { ...value, inventory: [...value.inventory] } : value;
    storage.append({ kind, at: new Date(now()).toISOString(), body });
  };

  if (storage) {
    for (const record of storage.load()) {
      if (record.kind === 'row') {
        rows.set(record.body.id, record.body);
        const n = Number(String(record.body.id).split('-').pop());
        if (Number.isFinite(n) && n > seq) seq = n;
      } else if (record.kind === 'maker') {
        makers.set(record.body.host, { ...record.body, inventory: new Set(record.body.inventory || []) });
      } else if (record.kind === 'refusal') {
        refusals.push(record.body);
      }
    }
  }

  const stamp = () => new Date(now()).toISOString();

  /** The tandem enrols a maker; the fleet is not a place one walks into.
   *
   *  Two names, and they are not the same thing (found on terrain, the first
   *  birth): `host` is what the machine answers when asked who it is —
   *  `vps-053c1354` — and it is the identity, because it is the only name
   *  that cannot drift from reality. `fleetName` is what the fleet map and
   *  the humans call it — `gbs-test` — and it is what a ledger row names,
   *  because a row is written by a person or a product, not by a kernel.
   *  Enrolment is where the two are bound, once, by the tandem. Without this
   *  the governor hands work to `gbs-test` while the maker asks as
   *  `vps-053c1354`, and nothing ever happens — silently. */
  function enrolMaker({ host, fleetName }) {
    if (!host) throw new Error('host is required — a maker\'s identity is its host');
    const name = fleetName || host;
    if (makers.has(host)) throw new Error(`host "${host}" is already enrolled`);
    for (const m of makers.values()) {
      if (m.fleetName === name) throw new Error(`fleet name "${name}" is already bound to host "${m.host}"`);
    }
    const token = crypto.randomBytes(24).toString('hex');
    const maker = {
      token, host, fleetName: name, version: null, lanes: 0,
      inventory: new Set(), lastPollAt: null, enrolledAt: stamp(),
    };
    makers.set(host, maker);
    persist('maker', maker);
    return { host, fleetName: name, token };
  }

  function makerByToken(token) {
    for (const m of makers.values()) if (m.token === token) return m;
    return null;
  }

  /** A row's params, held to the class's allow-list. Every refusal is a
   *  typed fact naming the key: a param the governor did not understand used
   *  to have nowhere to go, and one it passed along unread would reach a
   *  recipe running as root. The result is the checked object — every key
   *  the caller gave, each one named by the schema, in the caller's order (a
   *  key the schema does not name is a refusal, never a key dropped on the
   *  way) — or `{ refused, reason }`. */
  const checkParams = (klass, params) => {
    if (params === undefined || params === null) return { params: {} };
    if (typeof params !== 'object' || Array.isArray(params)) {
      return { refused: true, reason: 'params must be a flat object of scalars' };
    }
    const schema = paramsSchema[klass] || {};
    const clean = {};
    for (const [key, value] of Object.entries(params)) {
      if (!PARAM_KEY.test(key)) {
        return { refused: true, reason: `param key ${JSON.stringify(key)} is not a word a recipe may receive (${PARAM_KEY})` };
      }
      const rule = schema[key];
      if (!rule) return { refused: true, reason: `param "${key}" is not declared for class "${klass}"` };
      if (!PARAM_TYPES.has(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
        return { refused: true, reason: `param "${key}" must be a scalar (string, number or boolean)` };
      }
      if (typeof value !== rule.type) {
        return { refused: true, reason: `param "${key}" must be a ${rule.type}, got a ${typeof value}` };
      }
      clean[key] = value;
    }
    return { params: clean };
  };

  const sameParams = (a = {}, b = {}) => {
    const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
  };

  /** The live row of the same class carrying `key = value`, if any. Two rows
   *  on one unique value are a collision on the host (two DNAT rules on one
   *  port), never a product detail — so the ledger, not the recipe, refuses. */
  const holderOf = (klass, key, value, except = new Set()) =>
    [...rows.values()].find((r) =>
      r.klass === klass && r.state !== 'REAPED' && !except.has(r.id) && r.params?.[key] === value) || null;

  /** Desired state is idempotent: one live row per (account, klass). */
  function desire({ account, klass, matrix, digest, machine, env = 'demo', deadlineAt, params }) {
    for (const field of ['account', 'klass', 'matrix', 'digest', 'machine']) {
      const v = { account, klass, matrix, digest, machine }[field];
      if (!v) throw new Error(`${field} is required`);
    }
    const checked = checkParams(klass, params);
    if (checked.refused) return { refused: true, created: false, reason: checked.reason };
    // An adopted row binds to a container by its name, carried in the
    // params slot (`instance`, which the class must declare). A row with no
    // matrix and no name would be a row for nothing: refused, typed.
    if (digest === ADOPTED_DIGEST && typeof checked.params.instance !== 'string') {
      return {
        refused: true, created: false,
        reason: `an adopted row (digest "${ADOPTED_DIGEST}") names the instance it binds to: params.instance, a string the class "${klass}" declares`,
      };
    }
    const open = [...rows.values()].filter((r) =>
      r.account === account && r.klass === klass && r.state !== 'REAPED');
    // The life to protect comes first, whatever the ledger's order. A re-ask
    // pressed twice used to meet the broken row again (a Map iterates in
    // insertion order), end it a second time and birth a second fresh row —
    // the twin invariant 4 exists to forbid.
    const living = open.find((r) => r.state !== 'DEGRADED');
    if (living) {
      // The params of a living row are immutable, like its digest: the
      // recipe already bound host resources to them. A re-ask carrying other
      // params used to be answered with the old row and nothing said — the
      // product believed N had changed, the host had not heard of it.
      if (!sameParams(living.params, checked.params)) {
        return {
          refused: true, created: false, row: living,
          reason: `row "${living.id}" is alive with other params — a living row's params are immutable; end it first`,
        };
      }
      return { row: living, created: false };
    }
    // What remains is broken. A DEGRADED row is not a life to protect — for
    // the environments a robot may end. A production universe is not one of
    // them: its reap is refused by the recipe (exit 4), so ending it here
    // would leave the old row storming and a twin stamped beside it. The
    // re-ask is refused as a typed fact carrying the row id; its end is a
    // human decision (Rule 27). Nothing is created, nothing is thrown.
    const guarded = open.find((r) => r.env === 'prod');
    if (guarded) {
      return {
        refused: true, created: false, row: guarded,
        reason: `row "${guarded.id}" is a degraded production universe — a robot does not end one, and no twin is born beside it (Rule 27)`,
      };
    }
    // A unique value is carried by one live row of the class. The broken
    // rows this very ask is ending are the exception: their value passes to
    // the successor (a tenant keeps its number across a rebirth), and poll()
    // withholds the successor's birth until the predecessor is REAPED — the
    // host never carries two instances on one value.
    const ending = new Set(open.map((r) => r.id));
    for (const [key, rule] of Object.entries(paramsSchema[klass] || {})) {
      if (!rule.unique || !(key in checked.params)) continue;
      const holder = holderOf(klass, key, checked.params[key], ending);
      if (holder) {
        return {
          refused: true, created: false, row: holder,
          reason: `param "${key}" = ${JSON.stringify(checked.params[key])} is already held by live row "${holder.id}" — a unique value is carried by one live row of class "${klass}"`,
        };
      }
    }
    // Asking again means: end the broken one (its deadline becomes now, and
    // a maker will reap whatever half-exists), start fresh.
    for (const broken of open) {
      broken.deadlineAt = stamp();
      broken.updatedAt = stamp();
      persist('row', broken);
    }
    const id = `inst-${now()}-${++seq}`;
    const row = {
      id, account, klass, matrix, digest, machine, env, params: checked.params,
      state: 'DESIRED', deadlineAt: deadlineAt || null,
      createdAt: stamp(), updatedAt: stamp(), events: [],
    };
    rows.set(id, row);
    persist('row', row);
    return { row, created: true };
  }

  /** The heartbeat. Dates the ask, records the declared inventory, returns
   *  the work this host owes — and withholds what its bytes cannot back. */
  function poll({ token, host, version, lanes, inventory = [] }) {
    const maker = makerByToken(token);
    if (!maker) return { ok: false, code: 401, error: 'not enrolled' };
    if (maker.host !== host) {
      return { ok: false, code: 403, error: `this credential is bound to "${maker.host}" — a maker's identity is its host` };
    }
    maker.lastPollAt = stamp();
    maker.version = version ?? maker.version;
    maker.lanes = lanes ?? maker.lanes;
    maker.inventory = new Set(inventory.map((i) => (typeof i === 'string' ? i : i.digest)));
    persist('maker', maker);

    /** The last event the table understood. Unknown events are recorded
     *  for audit and mean nothing to the automaton, so they never hide the
     *  claim or the refusal that put the row where it is. */
    const lastTransition = (row) =>
      [...row.events].reverse().find((e) => e.event in EVENT_TRANSITIONS) || null;
    const ageOf = (event) => now() - new Date(event.at).getTime();

    /** The governor validates a child from FACTS the ledger holds: the stamp
     *  recipe reported whether the child ships an acceptance spec, and the
     *  governor knows no more than that. Work is derived once, and offered
     *  again only if a VALIDATING claim went silent past its budget. */
    const needsValidation = (row) => {
      const stamped = row.events.find((e) => e.event === 'STAMPED' || e.event === 'ADOPTED');
      if (!stamped || stamped.data?.checks !== true) return false;
      if (row.events.some((e) => e.event === 'VALIDATED' || e.event === 'VALIDATION_FAILED')) return false;
      const claims = row.events.filter((e) => e.event === 'VALIDATING');
      if (claims.length === 0) return true;
      return ageOf(claims[claims.length - 1]) > claimBudgetMs;
    };

    /** Rule 27 on the reap. A reap the recipe REFUSED is never offered
     *  again — the row rests, a human ends it. A reap that FAILED is offered
     *  again after an exponential pause, and never again after
     *  `maxHealingAttempts`: the governor is not the storm. Both used to be
     *  re-offered at every beat, five seconds apart, forever. */
    const reapIsDue = (row) => {
      if (lastTransition(row)?.event === 'REAP_REFUSED') return false;
      const failures = row.events.filter((e) => e.event === 'REAP_FAILED');
      if (failures.length === 0) return true;
      if (failures.length >= maxHealingAttempts) return false;
      return ageOf(failures[failures.length - 1]) >= reapBackoffMs * 2 ** (failures.length - 1);
    };

    /** The predecessor a successor waits on: a live row of the same class
     *  still holding one of its unique values. desire() let the value pass
     *  to the successor; the host must not see both. */
    const predecessorOf = (row) => {
      for (const [key, rule] of Object.entries(paramsSchema[row.klass] || {})) {
        if (!rule.unique || !(key in (row.params || {}))) continue;
        const holder = holderOf(row.klass, key, row.params[key], new Set([row.id]));
        if (holder) return { rowId: row.id, key, on: holder.id };
      }
      return null;
    };

    const work = [];
    const preload = new Set();
    const withheld = [];
    for (const row of rows.values()) {
      // A row names the machine the way the fleet map does; the maker asks
      // under the name its kernel gives. Enrolment bound the two.
      if (row.machine !== maker.fleetName && row.machine !== maker.host) continue;
      const pastDeadline = row.deadlineAt && now() >= new Date(row.deadlineAt).getTime();
      // How a row comes to life: stamped from its matrix, or adopted — bound
      // to a container that already exists, which no inventory of matrices
      // can vouch for and none needs to.
      const birth = row.digest === ADOPTED_DIGEST ? 'adopt' : 'stamp';
      let kind = null;
      if (row.state === 'DESIRED') {
        // A row past its deadline is never stamped — it used to be born and
        // reaped in two consecutive beats. Its end is offered instead: the
        // reap recipe proves the absence ("already gone") and the slot frees.
        kind = pastDeadline ? 'reap' : birth;
      } else if (row.state === 'RECONCILING') {
        // A claim. A maker that died mid-work used to hold the row here
        // forever — RECONCILING, counted living, its matrix pinned. Past the
        // budget the claim is presumed dead and the same work is offered
        // again; a stamp claim on a row now past its deadline becomes a reap.
        const claim = lastTransition(row);
        if (claim && ageOf(claim) > claimBudgetMs) {
          kind = (claim.event === 'REAPING' || pastDeadline) ? 'reap' : birth;
        }
      } else if (pastDeadline && row.state !== 'REAPED') {
        kind = 'reap';
      } else if (row.state === 'PURRING' && needsValidation(row)) {
        kind = 'validate';
      }
      if (!kind) continue;
      if (kind === 'reap' && !reapIsDue(row)) continue;
      if (kind === 'stamp' && !maker.inventory.has(row.digest)) {
        preload.add(row.digest);
        continue;
      }
      // A birth on a unique value still held by a predecessor waits for
      // that predecessor's REAPED — reported by the same beat's reap, or
      // by a human when the reap rested (Rule 27). The wait is a typed
      // fact in the answer, never a silent absence of work.
      const waitingOn = kind === birth ? predecessorOf(row) : null;
      if (waitingOn) {
        withheld.push(waitingOn);
        continue;
      }
      // The row's params ride the work as data: the maker lays them on the
      // recipe's environment (SHAPER_PARAM_<KEY>), never on its argv.
      work.push({
        workId: `${kind}:${row.id}`, kind, rowId: row.id,
        klass: row.klass, matrix: row.matrix, digest: row.digest,
        account: row.account, env: row.env, params: { ...(row.params || {}) },
      });
    }
    return { ok: true, work, preload: [...preload], withheld };
  }

  /** A maker reports; the table decides what the event means. */
  function report({ token, rowId, event, data = {} }) {
    const maker = makerByToken(token);
    if (!maker) return { ok: false, code: 401, error: 'not enrolled' };
    const row = rows.get(rowId);
    if (!row) return { ok: false, code: 404, error: `no row "${rowId}"` };
    // The same binding poll() applies, on the way back. A credential is
    // bound to one machine; a report on another machine's row used to be
    // accepted all the same, so a stolen token could write REAPED on any
    // row in the ledger — slot freed, matrix dereferenced, twin at the next
    // ask. A stolen credential may lie about its own host's rows, never
    // about another's. The refusal is a security fact: it is journaled.
    if (row.machine !== maker.fleetName && row.machine !== maker.host) {
      const refusal = {
        at: stamp(), host: maker.host, fleetName: maker.fleetName,
        rowId, machine: row.machine, event: String(event),
      };
      refusals.push(refusal);
      persist('refusal', refusal);
      return { ok: false, code: 403, error: `row "${rowId}" belongs to "${row.machine}" — this credential reports for "${maker.fleetName}" only` };
    }
    // An event means what its name says only if its facts hold: a STAMPED
    // that reports a stopped container degrades the row instead of purring.
    const claimed = EVENT_FACTS[event] || {};
    const unmet = Object.keys(claimed).filter((k) => !claimed[k](data?.[k]));
    const entry = { event, data, host: maker.host, at: stamp() };
    if (unmet.length) entry.unmet = unmet;
    row.events.push(entry);
    const next = unmet.length ? UNMET_TRANSITION : EVENT_TRANSITIONS[event];
    if (next) {
      row.state = next;
      row.updatedAt = stamp();
    }
    persist('row', row);
    return unmet.length ? { ok: true, state: row.state, unmet } : { ok: true, state: row.state };
  }

  /** The silences. A host quiet beyond the interval is drifting. */
  function silentMakers({ maxAgeMs }) {
    const cutoff = now() - maxAgeMs;
    return [...makers.values()]
      .filter((m) => !m.lastPollAt || new Date(m.lastPollAt).getTime() < cutoff)
      .map((m) => ({ host: m.host, fleetName: m.fleetName, lastPollAt: m.lastPollAt }));
  }

  /** Matrices still referenced by a live row may never be deleted. An
   *  adopted row references none: its container was born of no matrix. */
  function referencedDigests() {
    const held = new Set();
    for (const row of rows.values()) {
      if (row.state !== 'REAPED' && row.digest !== ADOPTED_DIGEST) held.add(row.digest);
    }
    return held;
  }

  return {
    enrolMaker, desire, poll, report, silentMakers, referencedDigests,
    /** The observation surface: who runs, under which names, last seen when.
     *  Credentials never leave — an observer reads presence, not power. */
    listMakers: () => [...makers.values()].map((m) => ({
      host: m.host, fleetName: m.fleetName, version: m.version,
      lanes: m.lanes, lastPollAt: m.lastPollAt, enrolledAt: m.enrolledAt,
      inventory: m.inventory.size,
    })),
    listRows: () => [...rows.values()],
    getRow: (id) => rows.get(id) || null,
    /** Reports refused at the door: who lied, about which row, when. */
    listRefusals: () => refusals.map((r) => ({ ...r })),
    STATES,
  };
}

/** Reference HTTP surface. A real governor mounts these in its own app; the
 *  contract and the transport stay separable so the SaaS binds its database
 *  without inheriting this server. */
export function createGovernorServer({ governor, port = 0, host = '127.0.0.1', adminToken }) {
  if (!adminToken) throw new Error('adminToken is required — enrolment is the tandem\'s act');
  const sendJson = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve(null); } });
  });
  const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, `http://${host}`);
    if (req.method === 'POST' && pathname === '/api/makers/enrol') {
      if (bearer(req) !== adminToken) return sendJson(res, 401, { error: 'enrolment is the tandem\'s act' });
      const body = await readBody(req);
      // The fleetName crosses the door too. Enrolment is WHERE the kernel's
      // name and the fleet's name are bound (v1.13.24); an HTTP door that
      // dropped it re-created the two-names defect for every remote tandem:
      // rows written for "gbs-test" while the maker asks as its hostname,
      // and work silently never delivered.
      try { return sendJson(res, 201, governor.enrolMaker({ host: body?.host, fleetName: body?.fleetName })); }
      catch (err) { return sendJson(res, 400, { error: err.message }); }
    }
    if (req.method === 'POST' && pathname === '/api/makers/poll') {
      const body = await readBody(req);
      const out = governor.poll({ ...body, token: bearer(req) });
      return sendJson(res, out.ok ? 200 : out.code, out);
    }
    // The door answers enrol, poll, events — nothing else. Any POST under
    // /api/work/ used to be taken as a report; the route is exact.
    const events = req.method === 'POST' && pathname.match(/^\/api\/work\/([^/]+)\/events$/);
    if (events) {
      const rowId = decodeURIComponent(events[1]);
      const body = await readBody(req);
      const out = governor.report({ token: bearer(req), rowId, event: body?.event, data: body?.data });
      return sendJson(res, out.ok ? 200 : out.code, out);
    }
    return sendJson(res, 404, { error: 'Not Found' });
  });
  server.listen(port, host);
  return server;
}
