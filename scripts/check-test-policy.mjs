/**
 * Enforces the M10 test-harness boundary. Test and fixture sources must not depend on wall-clock
 * time, ambient randomness, or network clients; those capabilities make failures irreproducible
 * or allow supposedly local evidence to escape the machine.
 */
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';

const forbidden = [
  ['wall-clock Date.now', /\bDate\.now\s*\(/u],
  ['implicit current date', /\bnew\s+Date\s*\(\s*\)/u],
  ['ambient Math.random', /\bMath\.random\s*\(/u],
  ['ambient random UUID', /\brandomUUID\s*\(/u],
  ['fetch client', /\bfetch\s*\(/u],
  ['XMLHttpRequest client', /\bnew\s+XMLHttpRequest\b/u],
  ['WebSocket client', /\bnew\s+WebSocket\b/u],
  ['EventSource client', /\bnew\s+EventSource\b/u]
];
const failures = [];
let files = 0;
for await (const path of glob('tests/**/*.{ts,mjs,json,md}')) {
  const source = await readFile(path, 'utf8');
  files += 1;
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) failures.push(`${path} uses ${label}`);
  }
}
if (files === 0) failures.push('No test or fixture sources were inspected.');
if (failures.length > 0) {
  console.error('Test policy check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Test policy check passed for ${files} deterministic, network-free files.`);
