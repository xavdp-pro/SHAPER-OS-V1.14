perimeter: software/tasks-agy
goal: every task file in software/tasks-agy is written in English, and their filenames are English too
agent: agy
effort: low

# Task — put the task files themselves into English

## The rule

In this repository **everything produced is in English**: code, comments,
documentation, filenames, error messages, and the task files handed to agents.
French belongs only to spoken conversation with the maintainer.

Four files under `software/tasks-agy/` break that rule:

| Current name | Rename to |
| :--- | :--- |
| `corpus-difficile.md` | `hard-case-corpus.md` |
| `purge-chemins-machine.md` | `purge-machine-paths.md` |
| `mesure-corpus.md` | `measure-corpus.md` |
| `formats-ods-pptx.md` | keep as is |

## What to do

Rename them with `git mv`, then translate their contents into clear, idiomatic
technical English. Rewrite the prose so an English reader finds it natural —
this is not a word-for-word substitution.

Keep intact, exactly as they are:

* the header keys and their values: `perimeter:`, `goal:`, `agent:`, `effort:`
  — except the `goal:` sentence itself, which is prose and must be translated;
* every file path, command, flag and rule number quoted in the text;
* the meaning of each instruction. These files describe work that is already
  finished; they are a record. Do not soften, extend or improve them.

## Done when

`grep -rIl "[éèêàçùôûî]" software/tasks-agy --include="*.md"` returns nothing,
and no filename contains a French word.
