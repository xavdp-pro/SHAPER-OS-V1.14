perimeter: software/bricks/brick-helm/app/server
goal: every comment, developer log line and test name under brick-helm/app/server is in English, while French that the product shows or matches is preserved and listed
agent: agy
effort: low

# Task — put the helm server sources into English

## The rule

In this repository **everything we write is in English**: comments, JSDoc,
developer log lines, error messages, test descriptions. French belongs only to
spoken conversation with the maintainer.

## The distinction that decides every case

Some French here is **product data**, not writing. It must survive byte for
byte — translating it breaks a running feature.

**Never translate:**

| What | Why |
| :--- | :--- |
| `lib/locale.js` | the French user interface strings themselves |
| `lib/voiceNormalize.js`, `lib/voiceTtsPronounce.js` and their tests | `épelle`, `écho`… are the words the speech recogniser matches, and the pronunciation rules it applies |
| `lib/groqAck.js` and its test | French acknowledgement phrases spoken aloud to the user |
| `lib/cartesiaVoices.js`, `lib/deepgramVoices.js`, `lib/elevenlabsVoices.js` | voice names and language labels |
| any prompt sent to a model that asks it to answer **in French** | that is the product's behaviour, not our prose |
| French accented ranges inside a regular expression, e.g. `[a-zà-ÿ]` | removing them breaks tokenisation |
| test fixtures that are the text of a French document | sample input, not prose |

The rule of thumb: **if the French sits in a string the program compares,
displays, speaks, or sends to a model as an instruction about language, it is
data — leave it.** If it is a comment, a developer log line, or a test name, it
is writing — translate it.

When unsure, keep the French and list the file in your summary. A missed
translation costs nothing; a broken voice command costs a feature.

## What to do

Translate comments, JSDoc, developer-facing logs, thrown error messages and
test descriptions. Rewrite into natural technical English rather than
substituting word for word.

Change no behaviour: no renamed exports, no altered control flow, no
reformatting beyond the lines you touch.

## Proof

Run the test suites that exist under this perimeter and report their counts
before and after. They must be identical. If a count moves, you changed
behaviour — investigate rather than report success.

## Done when

Tests match their previous counts, and your summary lists every file where you
deliberately kept French, with the reason for each.
