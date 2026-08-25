perimeter: software/bricks/brick-helm/app/mds
goal: every document under brick-helm/app/mds is written in English, with its technical content unchanged
agent: agy
effort: low

# Task — put the helm design documents into English

## The rule

In this repository **everything produced is in English**: code, comments,
documentation, filenames, error messages. French belongs only to spoken
conversation with the maintainer, never to a file.

`software/bricks/brick-helm/app/mds/` holds around thirty design documents,
plans and feature notes. Most are in French. Translate them.

## How to translate

Rewrite the prose into clear, idiomatic technical English. An English reader
must find it natural — this is not a word-for-word substitution.

Leave **exactly** as they are:

* every file path, command, flag, port number, container name, environment
  variable and rule number;
* every code block and every quoted output;
* every checkbox state (`[x]` / `[ ]`) — these documents record decisions
  already taken, and their status is a fact, not prose;
* the meaning. These are design records. Do not soften, extend, correct or
  improve them, even when a statement now looks wrong.

## One exception that matters

`VOICE-NAMES.md` documents **French voice commands** — the words the speech
recogniser actually listens for. The surrounding prose gets translated; the
quoted French words themselves must be preserved untouched, because they are
product data, not writing. When in doubt about a French word inside quotes or
a code span, keep it and translate around it.

## Filenames

Rename to English where the name is French, using `git mv`:
`ORCHESTRATION-DYNAMIQUE.md`, `ORCHESTRATEUR-QUEUE.md`, `CONCRETISER-SHAPER.md`,
`FEATURE-VOIX-PRESENTATION.md`, `regles.md`, `PLAN-CONTROLE-WEB-AGENT.md`.
Then update every reference to them you find inside the same directory.

## Done when

`grep -rIl "[éèêàçùôûî]" software/bricks/brick-helm/app/mds` returns only files
whose remaining French is quoted product data, and you list those files with
the reason in your summary.
