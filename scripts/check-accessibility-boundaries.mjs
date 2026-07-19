import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

/**
 * AST and CSS regression gate for the accessibility contracts that can be proven without a human
 * or assistive-technology session. Manual keyboard, screen-reader, zoom, and theme evidence remains
 * required because static inspection cannot establish the complete rendered experience.
 */
const violations = [];
let explicitButtonCount = 0;
let knownClickTargetCount = 0;
for (const file of await collectTypeScriptFiles(path.resolve('src/ui'))) auditUiFile(file);

const styles = await readFile('styles.css', 'utf8');
for (const [label, marker] of [
  ['44px direct controls', "input:not([type='checkbox'], [type='radio'])"],
  ['44px checkbox/radio labels', "label:has(input[type='checkbox'])"],
  ['visible focus for links and summaries', 'a, summary, [tabindex]'],
  ['narrow-pane reflow', '@container (max-width: 800px)'],
  ['reduced motion', '@media (prefers-reduced-motion: reduce)'],
  ['animation reduction', 'animation-duration: 0.01ms !important'],
  ['text-labelled state contract', 'State banners pair icons and text']
])
  if (!styles.includes(marker)) violations.push(`styles.css: missing ${label}`);
for (const [label, pattern] of [
  ['focus removal', /outline\s*:\s*none/iu],
  ['fixed raw colour', /#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/iu],
  ['unreviewed keyframe animation', /@keyframes\b/iu]
])
  if (pattern.test(styles)) violations.push(`styles.css: ${label}`);

const workspace = await readFile('src/ui/views/book-workspace-view.ts', 'utf8');
for (const marker of [
  "role: 'tabpanel'",
  "'aria-controls': 'pm-book-workspace-panel'",
  "'aria-labelledby': `pm-book-tab-${this.activeTab}`",
  "this.selectTab(next, 'tab')"
])
  if (!workspace.includes(marker))
    violations.push(`src/ui/views/book-workspace-view.ts: missing ${marker}`);

for (const modal of ['src/ui/dialogs/create-book-modal.ts', 'src/ui/dialogs/edit-book-modal.ts']) {
  const source = await readFile(modal, 'utf8');
  for (const marker of ["'aria-live': 'assertive'", "tabindex: '-1'", 'error.focus()'])
    if (!source.includes(marker)) violations.push(`${modal}: missing error-summary ${marker}`);
}

if (violations.length > 0) {
  process.stderr.write(`Accessibility boundary violations detected:\n${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Accessibility boundary check passed: ${explicitButtonCount} explicit-type buttons and ${knownClickTargetCount} statically resolved click targets reviewed.\n`
  );
}

async function auditUiFile(file) {
  const content = await readFile(file, 'utf8');
  const relative = path.relative(process.cwd(), file);
  const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true);
  const createdTags = new Map();

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const tag = createdTag(node.initializer);
      if (tag !== undefined) createdTags.set(node.name.text, tag);
    }
    if (ts.isCallExpression(node)) {
      const tag = createdTag(node);
      if (tag === 'button') {
        explicitButtonCount += 1;
        if (!hasButtonType(node.arguments[1]))
          violations.push(`${relative}:${line(source, node)} button requires an explicit type`);
      }
      if (isPositiveTabindex(node))
        violations.push(
          `${relative}:${line(source, node)} positive tabindex changes reading order`
        );
      const clickReceiver = eventReceiver(node, 'click');
      if (clickReceiver !== undefined) {
        const tagName = createdTags.get(clickReceiver);
        if (tagName !== undefined) {
          knownClickTargetCount += 1;
          if (!['a', 'button', 'input', 'select', 'summary'].includes(tagName))
            violations.push(
              `${relative}:${line(source, node)} click handler is attached to non-interactive ${tagName}`
            );
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

function createdTag(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
  const method = node.expression.name.text;
  if (method === 'createDiv') return 'div';
  if (method === 'createSpan') return 'span';
  if (method !== 'createEl') return;
  const first = node.arguments[0];
  return first !== undefined && ts.isStringLiteral(first) ? first.text : undefined;
}

function hasButtonType(options) {
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return false;
  const attr = property(options, 'attr');
  const direct = property(options, 'type');
  return (
    (attr !== undefined &&
      ts.isObjectLiteralExpression(attr) &&
      property(attr, 'type') !== undefined) ||
    direct !== undefined
  );
}

function isPositiveTabindex(call) {
  if (createdTag(call) === undefined) return false;
  const options = call.arguments[1];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return false;
  const attr = property(options, 'attr');
  if (attr === undefined || !ts.isObjectLiteralExpression(attr)) return false;
  const value = property(attr, 'tabindex');
  return value !== undefined && ts.isStringLiteral(value) && Number(value.text) > 0;
}

function property(object, name) {
  for (const member of object.properties)
    if (
      ts.isPropertyAssignment(member) &&
      ((ts.isIdentifier(member.name) && member.name.text === name) ||
        (ts.isStringLiteral(member.name) && member.name.text === name))
    )
      return member.initializer;
}

function eventReceiver(call, eventName) {
  if (!ts.isPropertyAccessExpression(call.expression)) return;
  if (call.expression.name.text !== 'addEventListener') return;
  const event = call.arguments[0];
  if (event === undefined || !ts.isStringLiteral(event) || event.text !== eventName) return;
  return ts.isIdentifier(call.expression.expression) ? call.expression.expression.text : undefined;
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
