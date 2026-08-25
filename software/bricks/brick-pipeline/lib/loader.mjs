/**
 * @file loader.mjs
 * @description ESM loader hook to connect test benchmarks with the brick-pipeline extractor.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PIPELINE_INDEX_URL = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.js')).href;

export async function resolve(specifier, context, defaultResolve) {
  const next = await defaultResolve(specifier, context);
  if (next.url.endsWith('packages/rag/lib/extractor.js')) {
    return {
      url: PIPELINE_INDEX_URL,
      shortCircuit: true,
      format: 'module',
    };
  }
  return next;
}
