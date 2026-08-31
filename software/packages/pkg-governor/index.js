/**
 * @package @shaper/pkg-governor
 * Intent: INTENT.md
 *
 * The governor's contract: desired state written to a ledger, work derived
 * from the gap, makers asking from outside. The governor never dials out and
 * never commands — this module contains no fetch on purpose.
 */
import crypto from 'node:crypto';
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
};

export function createGovernor({ now = () => Date.now() } = {}) {
  const rows = new Map();     // id -> ledger row
  const makers = new Map();   // host -> { token, version, lanes, inventory:Set<digest>, lastPollAt, enrolledAt }
  let seq = 0;

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
    makers.set(host, {
      token, host, fleetName: name, version: null, lanes: 0,
      inventory: new Set(), lastPollAt: null, enrolledAt: stamp(),
    });
    return { host, fleetName: name, token };
  }

  function makerByToken(token) {
    for (const m of makers.values()) if (m.token === token) return m;
    return null;
  }

  /** Desired state is idempotent: one live row per (account, klass). */
  function desire({ account, klass, matrix, digest, machine, env = 'demo', deadlineAt }) {
    for (const field of ['account', 'klass', 'matrix', 'digest', 'machine']) {
      const v = { account, klass, matrix, digest, machine }[field];
      if (!v) throw new Error(`${field} is required`);
    }
    const live = [...rows.values()].find((r) =>
      r.account === account && r.klass === klass && r.state !== 'REAPED');
    if (live) return { row: live, created: false };
    const id = `inst-${now()}-${++seq}`;
    const row = {
      id, account, klass, matrix, digest, machine, env,
      state: 'DESIRED', deadlineAt: deadlineAt || null,
      createdAt: stamp(), updatedAt: stamp(), events: [],
    };
    rows.set(id, row);
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

    const work = [];
    const preload = new Set();
    for (const row of rows.values()) {
      // A row names the machine the way the fleet map does; the maker asks
      // under the name its kernel gives. Enrolment bound the two.
      if (row.machine !== maker.fleetName && row.machine !== maker.host) continue;
      const pastDeadline = row.deadlineAt && now() >= new Date(row.deadlineAt).getTime();
      let kind = null;
      if (row.state === 'DESIRED') kind = 'stamp';
      else if (pastDeadline && row.state !== 'REAPED' && row.state !== 'RECONCILING') kind = 'reap';
      if (!kind) continue;
      if (kind === 'stamp' && !maker.inventory.has(row.digest)) {
        preload.add(row.digest);
        continue;
      }
      work.push({
        workId: `${kind}:${row.id}`, kind, rowId: row.id,
        klass: row.klass, matrix: row.matrix, digest: row.digest,
        account: row.account, env: row.env,
      });
    }
    return { ok: true, work, preload: [...preload] };
  }

  /** A maker reports; the table decides what the event means. */
  function report({ token, rowId, event, data = {} }) {
    const maker = makerByToken(token);
    if (!maker) return { ok: false, code: 401, error: 'not enrolled' };
    const row = rows.get(rowId);
    if (!row) return { ok: false, code: 404, error: `no row "${rowId}"` };
    row.events.push({ event, data, host: maker.host, at: stamp() });
    const next = EVENT_TRANSITIONS[event];
    if (next) {
      row.state = next;
      row.updatedAt = stamp();
    }
    return { ok: true, state: row.state };
  }

  /** The silences. A host quiet beyond the interval is drifting. */
  function silentMakers({ maxAgeMs }) {
    const cutoff = now() - maxAgeMs;
    return [...makers.values()]
      .filter((m) => !m.lastPollAt || new Date(m.lastPollAt).getTime() < cutoff)
      .map((m) => ({ host: m.host, fleetName: m.fleetName, lastPollAt: m.lastPollAt }));
  }

  /** Matrices still referenced by a live row may never be deleted. */
  function referencedDigests() {
    const held = new Set();
    for (const row of rows.values()) if (row.state !== 'REAPED') held.add(row.digest);
    return held;
  }

  return {
    enrolMaker, desire, poll, report, silentMakers, referencedDigests,
    listRows: () => [...rows.values()],
    getRow: (id) => rows.get(id) || null,
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
      try { return sendJson(res, 201, governor.enrolMaker({ host: body?.host })); }
      catch (err) { return sendJson(res, 400, { error: err.message }); }
    }
    if (req.method === 'POST' && pathname === '/api/makers/poll') {
      const body = await readBody(req);
      const out = governor.poll({ ...body, token: bearer(req) });
      return sendJson(res, out.ok ? 200 : out.code, out);
    }
    if (req.method === 'POST' && pathname.startsWith('/api/work/')) {
      const rowId = decodeURIComponent(pathname.split('/')[3] || '');
      const body = await readBody(req);
      const out = governor.report({ token: bearer(req), rowId, event: body?.event, data: body?.data });
      return sendJson(res, out.ok ? 200 : out.code, out);
    }
    return sendJson(res, 404, { error: 'Not Found' });
  });
  server.listen(port, host);
  return server;
}
