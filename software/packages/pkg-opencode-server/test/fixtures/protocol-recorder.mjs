#!/usr/bin/env node
// HTTP protocol recorder for bridge transport tests. It never runs a model,
// emits an agent result, or establishes model/CLI compatibility.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const record = process.env.SHAPER_PROTOCOL_RECORD;
if (!record || !port) throw new Error('record path and port are required');

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/global/event') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"server.connected"}\n\n');
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/global/health') return res.end('{"healthy":true}');
  if (url.pathname === '/session' && req.method === 'POST') {
    return res.end('{"id":"ses_transport"}');
  }
  if (url.pathname === '/session/ses_transport/prompt_async') {
    let text = '';
    for await (const chunk of req) text += chunk;
    fs.writeFileSync(record, text);
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(404);
  res.end(JSON.stringify({ error: `Unimplemented recorder route: ${url.pathname}` }));
}).listen(port, '127.0.0.1');
