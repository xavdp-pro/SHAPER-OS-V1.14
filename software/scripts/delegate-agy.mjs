#!/usr/bin/env node
/**
 * Historical entry point — delegation is no longer specific to Antigravity.
 * Everything moved to `delegate.mjs`, which routes to the agent the task
 * declares. This file stays because permission rules name it.
 *
 *   node scripts/delegate-agy.mjs --all --agent agy --effort medium
 */
import './delegate.mjs';
