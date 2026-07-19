import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const sourceRoot = path.resolve('src');
const forbidden = [
  ['Node built-in import', /(?:from\s+|import\s*\()['"]node:/u],
  ['Node filesystem', /(?:from\s+|import\s*\()['"](?:fs|fs\/promises)['"]/u],
  ['Electron', /(?:from\s+|import\s*\()['"]electron['"]/u],
  ['External process', /(?:from\s+|import\s*\()['"]child_process['"]/u],
  [
    'Network module import',
    /(?:from\s+|import\s*\()['"](?:node:)?(?:http|https|net|tls|dns|dgram)(?:\/[^'"]*)?['"]/u
  ],
  ['Network client import', /(?:from\s+|import\s*\()['"](?:axios|got|undici|node-fetch)['"]/u],
  ['Network fetch', /\bfetch\s*\(/u],
  ['XML HTTP request', /\bXMLHttpRequest\b/u],
  ['WebSocket', /\bWebSocket\b/u],
  ['EventSource', /\bEventSource\b/u],
  ['Beacon telemetry', /\bsendBeacon\s*\(/u]
];

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(target)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(target);
    }
  }

  return files;
}

const violations = [];
for (const file of await collectTypeScriptFiles(sourceRoot)) {
  const content = await readFile(file, 'utf8');
  for (const [label, pattern] of forbidden) {
    if (pattern.test(content)) {
      violations.push(`${path.relative(process.cwd(), file)}: ${label}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Forbidden production APIs detected:\n${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Forbidden production API check passed.\n');
}
