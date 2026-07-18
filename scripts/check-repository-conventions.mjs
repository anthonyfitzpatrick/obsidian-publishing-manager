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

if (failures.length > 0) {
  console.error('Repository convention check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Repository convention check passed.');
