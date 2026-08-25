perimeter: software/scripts
goal: every script under software/scripts carries English comments, echoes and error messages, and still runs unchanged
agent: agy
effort: high

# Task — put the operational scripts into English

## The rule

Everything we write is in English: comments, `echo` lines, usage strings, error
messages, variable names. These scripts are read by other operators and other
agents, none of whom are assumed to read French.

## What to do

Across `software/scripts`, translate comments, usage text, progress messages
and error messages into natural technical English.

**Change no behaviour.** Specifically:

* no renamed variables that other scripts or CI reference;
* no altered control flow, exit codes, or option names;
* no reformatting beyond the lines you touch;
* any French inside a value the script compares or passes on — a container
  name, a path, a grep pattern — stays exactly as it is.

## Quality bar

These are the files someone reads at three in the morning when a deployment is
broken. Write plainly: say what the script is doing and why this step exists,
not what the next line obviously does. Where a comment records a hard-won fact
— a flag that had to be added, a bug that forced a workaround — keep that
knowledge and make it clearer, never shorter.

## Proof

For every `.sh` file you touch: `bash -n <file>` must pass.
For every `.mjs` file you touch: `node --check <file>` must pass.
Run both across the whole perimeter and report the counts.

## Done when

Every file parses, no behaviour changed, and `grep -rIl "[éèêàçùôûî]" software/scripts`
returns only files whose remaining French is data — listed in your summary with
the reason.
