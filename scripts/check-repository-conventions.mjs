import { readFile } from 'node:fs/promises';

const requirements = new Map([
  ['CONTRIBUTING.md', ['## Before coding', '## Commit messages', '## Pull requests']],
  [
    'RELEASING.md',
    ['## Version synchronization', '## Release checklist', '## Failure and rollback']
  ],
  ['CHANGELOG.md', ['## [Unreleased]']],
  [
    '.gitea/ISSUE_TEMPLATE/bug.md',
    ['name: Bug report', '## Reproduction', '## Acceptance criteria']
  ],
  [
    '.gitea/ISSUE_TEMPLATE/feature.md',
    ['name: Feature or change proposal', '## Scope', '## Acceptance criteria']
  ],
  ['.gitea/ISSUE_TEMPLATE/config.yml', ['blank_issues_enabled: false']],
  ['.gitea/PULL_REQUEST_TEMPLATE.md', ['## Outcome', '## Verification', '## Risk review']]
]);

const failures = [];
for (const [path, requiredContent] of requirements) {
  let content;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    failures.push(`${path} is missing`);
    continue;
  }

  for (const expected of requiredContent) {
    if (!content.includes(expected)) failures.push(`${path} must contain ${expected}`);
  }
}

// The product intentionally owns one Obsidian ribbon entry. Commands and Dashboard launcher
// callbacks remain equivalent routes, but a future view must not silently add rail clutter again.
const ribbonSources = [
  'src/ui/views/register-publishing-views.ts',
  'src/ui/views/template-library-view.ts',
  'src/ui/views/publishing-export-view.ts',
  'src/ui/views/diagnostics-view.ts',
  'src/ui/views/manuscript-compiler-integration-view.ts'
];
const ribbonRegistrations = [];
for (const path of ribbonSources) {
  const content = await readFile(path, 'utf8');
  for (const match of content.matchAll(/addRibbonIcon\s*\(/gu))
    ribbonRegistrations.push(`${path}:${match.index}`);
}
if (ribbonRegistrations.length !== 1)
  failures.push(
    `Publishing Manager must register exactly one ribbon icon; found ${ribbonRegistrations.length}`
  );
if (!ribbonRegistrations[0]?.startsWith('src/ui/views/register-publishing-views.ts:'))
  failures.push('The single ribbon icon must open the Publishing Dashboard');

if (failures.length > 0) {
  console.error('Repository convention check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Repository convention check passed.');
