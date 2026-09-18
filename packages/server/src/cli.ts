#!/usr/bin/env node
import { LiteServer } from './server.js';

// Parse CLI arguments: --port <port>, -p <port>, --host <host>, -h <host>
const args = process.argv.slice(2);
let port = 18760;
let host = '0.0.0.0';

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--port' || arg === '-p') {
    const val = parseInt(args[++i], 10);
    if (!isNaN(val)) port = val;
  } else if (arg.startsWith('--port=')) {
    const val = parseInt(arg.split('=')[1], 10);
    if (!isNaN(val)) port = val;
  } else if (arg === '--host' || arg === '-h') {
    host = args[++i];
  } else if (arg.startsWith('--host=')) {
    host = arg.split('=')[1];
  }
}

if (process.env.PORT) {
  const envPort = parseInt(process.env.PORT, 10);
  if (!isNaN(envPort)) port = envPort;
}

const server = new LiteServer({ port, host });
await server.listen(port, host);
console.log(`\x1b[32m✔\x1b[0m Vesper Lite Server listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
