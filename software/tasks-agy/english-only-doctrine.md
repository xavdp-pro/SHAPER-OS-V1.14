perimeter: doctrine
goal: the five architecture essays in doctrine/ are written in English, with every rule number, figure and claim preserved exactly
agent: agy
effort: medium

# Task — put the five doctrine essays into English

## The rule

In this repository **everything produced is in English**. French belongs only
to spoken conversation with the maintainer, never to a file. The doctrine is
read by every agent working on this system, so a French corpus is a dead end
for anyone who does not read French.

## The five files, and only these five

1. `doctrine/VOCABULARY-AND-PITCH.md`
2. `doctrine/CONVERGENCE-PROPOSAL-STEADY-STATE.md`
3. `doctrine/FRACTAL-ARCHITECTURE-WORDPRESS-SAAS-EXAMPLE.md`
4. `doctrine/FRACTAL-TERRAFORM-AND-CORRECTION-LAW.md`
5. `doctrine/REAL-INFRASTRUCTURE-CAPACITY-PLANNING-SAAS.md`
6. `doctrine/SOVEREIGN-WEB-CHAIN-WAF-AND-CACHE.md`

**Do not touch** `README.md`, `CONVERGENCE-STATE.md` or `DOCUMENT-PIPELINE.md`
in the same directory — they are being handled elsewhere and you would collide.
The files have already been renamed; do not rename anything.

## How to translate

This is doctrine. It carries decisions that agents will apply literally, so
precision outranks elegance — but the English must still read as English, not
as translated French.

Preserve **exactly**, without exception:

* every rule number (`Rule 27`, `R23-R27`, `0G`…) and every cross-reference;
* every figure, unit and measurement — `10 Gbit/s`, `4.3 s`, `~23 MB`, `1/N`,
  `50 sites`, `3 levels`. If a number appears, it was measured or decided;
  reproducing it wrong turns doctrine into fiction;
* every file path, command, container name, port and environment variable;
* every internal link, adjusting only the target filename when it points at one
  of the renamed files listed above;
* the strength of each statement. "Never", "must", "is not acceptable" are
  load-bearing. Do not soften them into "should" or "prefer".

## What you must not do

Do not improve the reasoning, add examples, fill perceived gaps, or reorganise
sections. If a passage looks wrong or contradictory to you, **translate it
faithfully and report it in your summary** — deciding is the maintainer's job,
not yours.

## Done when

The six files contain no French prose, every rule number and figure matches the
original, and your summary lists any passage you found doubtful.
