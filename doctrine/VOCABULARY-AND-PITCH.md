# SHAPER-OS — Vocabulary and Pitch
## Reference Document: Simple / Technical

This document serves two purposes: framing the commercial pitch (Simple section) and acting as a shared context for Claude Code (Technical section). It reflects the Simple/Technical toggle of SHAPER-OS.

---

## 0. POSITIONING — The Starting Observation

The core asset is neither a single product nor a single customer segment: it is the translation capability between the non-technical business leader and the CTO, within the very same meeting.

The pain point is identical for both profiles, only the phrasing differs:
- The business leader says: "I don't understand any of it and I'm afraid of getting ripped off."
- The CTO says: "I don't want to depend on an external black box."

It is the exact same anxiety: losing control. This is precisely what SHAPER-OS addresses.

Practical consequence: a single canvas / a single pitch, with sovereignty at the center, and the Simple/Technical toggle as the answer to the question of language register.

---

## 1. THE VOCABULARY PROBLEM TO SOLVE

The initial request was formulated in architect language: "a living, multidimensional pipeline, scalable and adaptable to any situation."

These four words represent a precise internal specification, but when spoken aloud they are heard as four interchangeable adjectives meaning "it's good." The problem is not the explanation, it is the register: these words describe a property, whereas the listener needs a behavior.

Rule: never state the adjective alone. Always translate it into a "what if" scenario.

---

## 2. THE FOUR TRANSLATIONS

### Adaptable
The building blocks are interchangeable. If the client changes accounting software, CRM, or even AI model, we reconnect instead of rebuilding.
Concretely: the investment does not die when a vendor changes its rules.

### Living
The system does not freeze on the delivery date. It retains memory of what it has done; therefore, the more it is used, the more accurate it becomes.
Concretely: in six months it works better than today, without paying for a new project.

### Scalable
Behavior does not change with volume. It works the same with three employees or thirty, with ten quotes a month or a thousand.
Concretely: no need to rebuild the system as you grow.

### Multidimensional
This is not a single pipe where everything queues up in a line. Multiple things move forward in parallel across multiple axes: prospecting runs while reporting is generated and client follow-ups are sent.
Concretely: we do not wait for one task to finish before the next one starts.

---

## 3. THE FRACTAL CONCEPT — The Keystone

Fractal is not a fifth adjective. It is the explanation that comes afterwards, when someone asks "but how does it hold together?".

The architecture is fractal: each perimeter reproduces the same logic at its scale (foundation, orchestration, restitution). An agent contains the structure of the entire system.

It is for this reason that the system is scalable and adaptable — not through a technical trick, but because the pattern repeats.

Clear version for a non-technical audience:
"It is built like a tree. Every branch has the same shape as the whole tree. So when you add a branch, you have nothing to reinvent."

---

## 4. PRESENTATION ORDER

Start from perceived risk, finish on peace of mind:

1. Adaptable — answers fear number one: "I'm going to be stuck with an obsolete thing."
2. Living — turns fear into a benefit: it does not degrade, it improves.
3. Scalable — reassures on growth.
4. Multidimensional — last, because it is the most abstract: it is the icing on the cake, not the opening argument.

Then fractal, only if the question "how does it hold together" is asked.

Closing sentence:
"You are not buying a tool, you are buying a system that ages well."

---

## 5. SIMPLE SECTION — For Non-Technical Business Leaders

### 30-Second Pitch
"I built a system that gives a company its own artificial intelligence, on-premises, under its control — rather than depending one hundred percent on an external cloud service that can change its rules overnight. It is the difference between renting an apartment and owning property: both give you shelter, but only one truly belongs to you."

### Short Version
"I build custom AI systems that the company owns and controls, rather than renting generic artificial intelligence in the cloud. Data sovereignty, operational autonomy, tools tailored to the business."

### Hook (business card, signature)
"I shape the AI that your business owns — not the one you rent."

### The Three Layers in Plain Language
1. The foundation — the technical foundation, hostable wherever the client wants: on-premises, in the cloud, or hybrid. Guarantees their data does not end up just anywhere.
2. The orchestrating brain — a layer of agents working together like a small team: one plans, another executes, another verifies. Allows automating complex tasks without constant supervision.
3. Client-facing tools — the visible part: concrete business tools built for their exact need.

### Vocabulary to Ban in Front of a Business Leader
Do not say: P1, P2, P3, Maestro, KovZu, agentic, orchestration.
Say: sovereignty, autonomy, custom-built. Three memorable words that justify the price.

---

## 6. TECHNICAL SECTION — For CTOs, CIOs, Developers

### Architecture
SHAPER-OS-V1.13 is a three-perimeter architecture:
- P1: Sovereign foundation — infrastructure deployable in cloud, hybrid, or on-premise depending on client compliance constraints.
- P2: Agentic layer — multi-agent orchestration. Maestro as supervisor, KovZu as execution agent. Role separation for planning / execution / verification. Interoperable with multiple dev environments: Cursor, Claude Code, OpenCode, Antigravity/Gemini, depending on the task.
- P3: Specific client tools, built on this foundation for a precise business use case.

The frontend exposes a Simple/Technical toggle to adapt the displayed granularity to the audience.

### The Execution Flow
1. Trigger — a task arrives (client request, scheduled automation, or direct instruction). It lands on Maestro.
2. Dispatch — Maestro does not execute, he arbitrates. He breaks down the task and distributes it to execution agents and the appropriate environment: Claude Code for complex autonomous code, Cursor for rapid local iteration, OpenCode or Antigravity/Gemini depending on specialty or availability. Each tool has a defined role, no random interchangeability.
3. Execution — agents work on the P1 foundation, which hosts data, models, and access, and determines the deployment mode according to constraints (GDPR, confidentiality, budget).
4. Verification — control loop before delivery: an agent, or Maestro, reviews, tests, validates. Prevents an autonomous AI from delivering without supervision.
5. Restitution — the result lands in P3, with the Simple/Technical toggle adapting the display: the business leader sees the result, the technical persona digs into logs and execution details.

### Key Point to Convey
It is not a single model doing everything. It is a chain where each link — orchestrator, executors, foundation, control, restitution — has a precise role. A team, not a tool.

### Fractal Recursion
Each perimeter replays the foundation / orchestration / restitution pattern at its own scale. An agent is structurally a reduced instance of the system. Scalability and adaptability are therefore emergent properties of the structure, not added optimizations.

---

## 7. USAGE NOTE FOR CLAUDE CODE

This file is the context bridge between conceptual framing discussions and work on the repository. It sets the reference vocabulary: the four properties and their translations, the fractal principle, the Simple/Technical separation.

To be kept up to date whenever a new concept is established.
