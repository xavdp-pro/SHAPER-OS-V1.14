# Brick: PIPELINE (Document Understanding Pipeline)

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)
> **Status**: TARGET — not implemented. See [`doctrine/DOCUMENT-PIPELINE.md`](../../../doctrine/DOCUMENT-PIPELINE.md) for the reasoning and the worked cases, and `CONVERGENCE-STATE.md` for where the code actually stands.

## 1. Declarative Objective

Turn any incoming document — whatever its source, its quality or its orientation — into **structured, sourced data plus a filed artefact**, without a human retyping anything.

The pipeline is a **service**, not a feature of the GED. The GED is one of its callers, never its owner.

## 2. Invariants

1. **The page is the unit of work, not the file.** A PDF is a sequence of pages, and pages differ: one is pure text, the next a pure scan, a third both. Each page is classified and routed on its own.
2. **The order of stages is canonical, and each entry point is explicit.** Deposit → page split (PDF only: page image **and** native text layer when present) → orientation analysis, rotation and deskew → legibility measurement → triple reading → arbitration → type recognition → business handler. Every stage depends on the one before it: straightening after reading is pointless, and reading before straightening degrades all three witnesses at once. A document never enters "at the beginning" on principle — it enters **at the stage matching its nature**: a PDF at the page split, **a standalone image directly at the orientation stage** as a one-page document, a text-only file at the reading stage with a single witness, and the result says so. All of them leave by the same path.
3. **Three witnesses on the same page, and a fourth agent that arbitrates.** Native text extraction, OCR of the image and a vision model are three witnesses, run together and never one instead of another. None of them returns the result: an **arbiter agent** receives the three readings, resolves the divergences and **produces the final result**. Field evidence: without that arbitration stage the success rate collapses on difficult document types; with it, 100% as long as the page's visual quality holds. A witness must never be allowed to deliver a result directly.
4. **Insufficient quality is detected and refused, out loud.** When the page is too degraded for the arbiter to decide, the pipeline does not return a weak result — it marks the document unusable, names the offending pages, and tells the requester the document is too degraded for a reliable analysis. A reasoned refusal is a good outcome; a field guessed on an illegible page is the worst one, because nothing downstream can tell it from a correct value.
5. **Geometry before reading.** Orientation and skew are corrected before any analysis. A page read upside down is not a poor result, it is a wrong one.
6. **Legibility is measured and stored, never assumed.** Every page carries a legibility score. A bad photocopy is a known-bad input, and downstream consumers must be able to see that rather than inherit a confident-looking wrong value.
7. **Every extracted field carries its provenance and its confidence** — which witness produced it, on which page, at which coordinates. A field nobody can trace is not delivered (Rule 0G).
8. **Document type is recognised, then handled.** Recognition and business handling are two separate stages: the pipeline identifies *what this is*, a declared handler decides *what to do about it*. Adding a document type never means editing the pipeline.
9. **The depositor travels with the document.** Who submitted it, through which channel, authenticated how — carried end to end, because filing and routing depend on it.
10. **One brick, both scales — modest VPS and large server (Rule 32).** The same image must run gently on a small VPS for a single operator and hold up as a rocket on a large server under heavy load, **by parameter, never by fork**. Scaling out means deploying several pipeline instances drawing from the same queue, coordinated by an agent that feeds and arbitrates that queue rather than by a hardcoded topology. A brick that only works at one scale is not a base.
11. **Multiplexed by construction, and dimensioned for it.** Several documents at once, and several pages of one document at once. Worker count is a parameter, never a constant. No stage may assume it is alone or that it runs in order. Throughput is a first-class requirement, not an optimisation to add later — a pipeline that serialises is a pipeline nobody can share.
12. **State lives in the database; the event stream only accelerates it.** Every stage writes its state to the universe database **before** emitting its event, never after. Anything a human can see in the progress modal, another agent must be able to obtain by querying — a job's stage, a page's legibility, a field's confidence, what awaits a human. An information that exists only in the stream does not exist. This is what lets a supervisor diagnose a stuck pipeline from the outside, cold (Rule 23), and what makes retry counting and `DEGRADED` possible at all (Rule 27).
13. **It reports its progress to whoever is watching.** Every stage emits an event — document received, page N classified, page N read, type recognised, filed — on a channel the agent's web page consumes live. A caller must be able to open a modal and watch the document being understood, per page, without polling. A pipeline that only answers at the end is unusable in an interface.
14. **It owns no model — it calls declared agents.** Two capacity classes are required: `document-text`, whose mission is to understand a document's text and return structured fields with confidence, and `document-vision`, whose mission is to read a straightened page as an image. The mapping from class to actual engine is declared in `manifest.json` (Rule 21), never in this brick. An agent is a witness among the others, never an arbiter; an unavailable agent lowers confidence and is reported as missing, it does not fail the page or get silently ignored.
15. **Source-agnostic ingestion.** GED upload, email attachment, messaging channel, API call — one entry contract. A new source is configuration, never a fork of the pipeline.
16. **Every stage journals, and efficacy is measured per document type.** Duration, available witnesses, legibility, disagreements, arbiter decision and refusals go to JSONL. Rates are computed per type, never globally. Accuracy is NOT confidence: a system's confidence is its opinion of itself. Any human correction of an extracted field is recorded as ground truth, so the evaluation corpus builds itself from use, and a claimed accuracy figure always rests on a known truth.
17. **Categories are governed, labels are normalised.** Recognition assigns a category from a closed, governed vocabulary; analysis assigns labels from an open one — supplier, period, arrival channel, depositor. Every proposed label is normalised (case, accents, known synonyms) before it is applied, or the vocabulary drifts into five spellings of one reality. A new *category* is proposed to a human rather than created outright, because a category commands a business handler.
18. **Processing state is a journal, never a boolean.** Each document carries where the pipeline got to, which pipeline version produced the result, which business handlers acted and when, which external processes took it over, and a content hash. A document processed twice — a forwarded email, a re-scan — is recognised by its hash: agents are not re-run and no second accounting row is written. Without the version recorded, no regression can be explained and no run reproduced.
19. **Nothing is invented.** When a value cannot be read, the pipeline says so and escalates. An empty field with a reason beats a plausible number.

## 3. Deployment — fast and solid, which is a build-time decision

The brick carries heavy dependencies (OCR engine, language data, image tooling) that other
bricks do not. That must never turn into slow or fragile deployments, so:

1. **Never built at deploy time.** Deployment pulls an **immutable tagged image** from the
   mesh registry — `v1.x.y`, never a floating `latest` (Rule 0E). A universe coming up must
   not depend on an apt mirror being reachable.
2. **Layers ordered by rate of change.** System packages first — they change monthly —
   then the application code, which changes hourly. A code fix rebuilds one thin layer and
   redeploys in seconds; the OCR layer is rebuilt only when the OCR itself changes.
3. **Pinned versions, no surprise upgrades.** `apt` package versions are pinned, so the
   same tag rebuilt tomorrow gives the same image. An image that drifts is not an artefact
   you can trust (Rule 0E).
4. **The heavy image never contaminates the light ones.** The GED image is 138 MB with no
   build step at all; OCR, language data and poppler roughly double that. That weight lives
   here and nowhere else (Rule 32).
5. **Cold start is part of "solid".** The container must be answering health checks without
   waiting for a model to load. Anything slow to initialise loads lazily, on first use.

## 4. Environment

- Runtime: Podman container, own image — it carries the heavy parts (OCR engine, image processing, optionally a local vision model) that must never bloat the GED image.
- Depends on: declared agents for the `document-text`, `document-vision` and `document-arbiter` capacity classes, `@shaper/queue` for job intake and multiplexing, `@shaper/vault` for model credentials, `@shaper/logger` for the audit trail, `@shaper/ged-engine` for artefact filing, MariaDB for structured output.
- Perimeter: **P2**. Business handlers that consume its output are **P3**.
- **The quality gate runs inside this container — no runtime access needed.** What this
  brick produces is documents and data: extracted fields, a filed artefact, structured rows.
  Verifying those is schema validation, arithmetic consistency, column typing, provenance —
  **none of it executes untrusted code**, so none of it needs isolation from the process
  doing the checking. Running the gate in-process is faster, simpler, and removes a
  privilege that would otherwise have to be justified.
- **An ephemeral sandbox is required for exactly one case, and it is not this brick's**:
  when the artefact to verify is **executable code** that must actually be run. That belongs
  to whoever produces code — the agent layer — not to a pipeline that produces documents.
  Should this brick ever need it, that is a change of mandate to be argued, not a permission
  to grant in advance.
- Consequence: **no container-runtime socket, no podman-in-podman.** Least privilege here is
  not a hardening measure to add later, it is the natural consequence of what the brick does.

## 5. Contract

- **In**: a document, its source, its depositor, and an optional expected type.
- **Out**: category and normalised labels, processing-state journal, pipeline version; per page — classification, orientation applied, legibility score, text, and the witnesses that produced it; per document — recognised type, extracted fields with provenance and confidence, the filed artefact path, and the structured rows written.
- **Progress**: an event stream keyed by job id, consumable by a web page, carrying stage transitions per document and per page.
- **On refusal**: an explicit "document too degraded for reliable analysis", naming the pages responsible, reaching the requester rather than a log.
- **On failure**: the job carries the reason and the stage it failed at, and that failure reaches the watcher on the same channel. It never completes silently (Rule 20).

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: fast-eval
- **role**: requires
- **depth**: D2
- **throughput**: T2
- **degraded**: queue
- **rationale**: Multi-witness document understanding. The native and OCR witnesses are deterministic; the vision witness consumes a model at D2. The arbiter that reconciles them is mechanical by design (D0) and must stay that way.
