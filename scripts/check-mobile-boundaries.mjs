import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

/**
 * Enforces the mobile contracts that source inspection can prove on every build. Physical iOS and
 * Android evidence remains separate because a desktop build process cannot truthfully emulate an
 * Obsidian mobile host, operating-system keyboard, memory pressure, or lifecycle suspension.
 */
const violations = [];
let reviewedTables = 0;

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (manifest.isDesktopOnly !== false)
  violations.push('manifest.json: isDesktopOnly must remain explicitly false');

for (const file of await collectTypeScriptFiles(path.resolve('src/ui'))) await auditTables(file);

const styles = await readFile('styles.css', 'utf8');
for (const [label, marker] of [
  ['container-query reflow', '@container (max-width: 800px)'],
  ['safe-area accommodation', 'env(safe-area-inset-bottom)'],
  ['virtual-keyboard scroll clearance', 'scroll-padding-block-end: calc(40vh'],
  ['reachable form actions', '.pm-form > .pm-action-row'],
  ['sticky narrow form actions', 'position: sticky'],
  ['bounded mobile textarea', 'max-height: 40vh'],
  ['labelled table-card projection', '.pm-mobile-table :is(th, td)::before'],
  ['mobile tab picker', '.pm-mobile-tab-picker select'],
  ['single-column workflow board', 'grid-auto-flow: row']
])
  if (!styles.includes(marker)) violations.push(`styles.css: missing ${label}`);

for (const [file, markers] of [
  [
    'src/ui/views/book-workspace-view.ts',
    [
      "document.addEventListener('visibilitychange', this.cancelWhenHidden)",
      'this.cancelInterruptibleWork()',
      'this.activeCancellations.add(token)'
    ]
  ]
]) {
  const source = await readFile(file, 'utf8');
  for (const marker of markers)
    if (!source.includes(marker)) violations.push(`${file}: missing lifecycle boundary ${marker}`);
}

if (violations.length > 0) {
  process.stderr.write(`Mobile boundary violations detected:\n${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Mobile boundary check passed: mobile manifest, responsive/keyboard/lifecycle contracts, and ${reviewedTables} semantic tables reviewed.\n`
  );
}

/** Requires every semantic table to provide either a labelled card projection or dedicated cards. */
async function auditTables(file) {
  const content = await readFile(file, 'utf8');
  const relative = path.relative(process.cwd(), file);
  const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true);

  function visit(node) {
    if (ts.isCallExpression(node) && createdTag(node) === 'table') {
      reviewedTables += 1;
      const classes = classText(node.arguments[1]);
      if (!classes.includes('pm-mobile-table') && !classes.includes('pm-price-table'))
        violations.push(
          `${relative}:${line(source, node)} table needs pm-mobile-table or a dedicated mobile-card projection`
        );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

function createdTag(node) {
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'createEl')
    return;
  const tag = node.arguments[0];
  return tag !== undefined && ts.isStringLiteral(tag) ? tag.text : undefined;
}

function classText(options) {
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return '';
  for (const member of options.properties)
    if (
      ts.isPropertyAssignment(member) &&
      ts.isIdentifier(member.name) &&
      member.name.text === 'cls' &&
      ts.isStringLiteral(member.initializer)
    )
      return member.initializer.text;
  return '';
}

function line(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

async function collectTypeScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectTypeScriptFiles(target)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(target);
  }
  return files;
}
