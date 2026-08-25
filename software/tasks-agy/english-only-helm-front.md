perimeter: software/bricks/brick-helm/app/src
goal: every comment, developer log line and test name under brick-helm/app/src is English, while the French user interface strings are preserved untouched
agent: agy
effort: high

# Task — put the helm front-end sources into English

## The rule

Everything **we write** is in English: comments, JSDoc, developer log lines,
test descriptions, variable names. French belongs only to spoken conversation
with the maintainer.

## The line that must not be crossed

`src/lib/locale.js` **is the French user interface**. Its ~215 French strings
are what the product displays to French-speaking users. Translating them would
replace the French UI with an English one — a product change nobody asked for.

**Leave untouched, byte for byte:**

* `src/lib/locale.js` — every translation string, both the `fr` and `en` tables;
* any French string that is displayed, spoken, or compared against user speech;
* `voiceAckStrip.js`, `voiceSendTrigger.js`, `voiceCursorLoop.js` and their
  tests wherever they match French phrases the user says aloud;
* French accented ranges inside regular expressions — tokenisation depends on them;
* test fixtures that are French sample text.

**Translate:** comments, JSDoc, `console.*` lines meant for a developer, thrown
error messages that never reach a user, and test descriptions.

The rule of thumb: **if a French string can end up on screen, in a speaker, or
on the matching side of a comparison, it is product data — leave it.** If it
only ever reaches a developer, it is writing — translate it.

When unsure, keep the French and list the file in your summary. A missed
translation costs nothing; a broken interface string costs a feature.

## Quality bar

Aim for English a native technical reader would not notice was translated.
Rewrite the sentence rather than transposing French word order. A comment that
reads awkwardly is worse than the French one it replaced, because it will be
copied by the next agent.

## Proof

Run the test suites under this perimeter and report their counts before and
after. They must be identical. If a count moves, you changed behaviour —
investigate rather than report success.

## Done when

Test counts match, no user-facing French was altered, and your summary lists
every file where you deliberately kept French with the reason for each.
