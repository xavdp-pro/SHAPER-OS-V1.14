perimeter: software/packages
goal: every comment, log line and error message under software/packages is in English, while French kept as product data is left untouched and listed
agent: agy
effort: low

# Task — put the package sources into English

## The rule

In this repository **everything written by us is in English**: comments,
variable names, log lines, error messages, test names, README files. French
belongs only to spoken conversation with the maintainer.

## The distinction that matters most here

Some French in these files is **product data**, not writing. It must stay,
byte for byte. Translating it would break the running system.

**Never translate:**

| File | Why the French must stay |
| :--- | :--- |
| any locale / i18n table | those strings are the French user interface |
| `voiceNormalize.js` and its test | `épelle`, `écho`… are the words the speech recogniser matches |
| `voiceTtsPronounce.js` and its test | French pronunciation rules |
| `groqAck.js` and its test | French acknowledgement phrases spoken to the user |
| voice catalogues (`cartesiaVoices`, `deepgramVoices`, `elevenlabsVoices`) | voice names and language labels |
| any test fixture that is the text of a French document | it is sample input, not prose |

The rule of thumb: **if the French is inside a string that the program compares
against, displays, or speaks, it is data — leave it.** If the French is a
comment, a log line for a developer, or a test description, it is writing —
translate it.

When you are unsure, keep the French and list the file in your summary. A
missed translation costs nothing; a broken voice command costs a feature.

## What to do

Translate comments, JSDoc, developer-facing log lines, error messages and test
descriptions across `software/packages`. Rewrite into natural technical
English rather than substituting word for word.

Change no behaviour: no renamed exports, no altered logic, no reformatting
beyond the lines you touch.

## Proof

`node --test packages/*/test/*.test.js` must still report **78 passing, 0
failing** when you are done. Run it. If the count moved, you changed
behaviour — find out why and fix it rather than reporting success.

## Done when

Tests are green at 78/78, and your summary lists every file where you
deliberately kept French, with the reason.
