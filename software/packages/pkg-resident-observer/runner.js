#!/usr/bin/env node
import { createResidentObserver } from './index.js';

const [contextPath, journalPath] = process.argv.slice(2);
if (!contextPath || !journalPath) {
  console.error('Usage: shaper-resident-observe <context.json> <incidents.jsonl>');
  process.exitCode = 2;
} else {
  try {
    const result = await createResidentObserver({ contextPath, journalPath }).observe();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
