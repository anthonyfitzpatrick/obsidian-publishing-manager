export type MalformedFixtureCategory =
  | 'invalid-yaml'
  | 'duplicate-id'
  | 'dependency-cycle'
  | 'unsafe-path'
  | 'unsafe-markup'
  | 'oversized-value';

export interface MalformedFixture {
  readonly id: string;
  readonly category: MalformedFixtureCategory;
  readonly sources: readonly string[];
  readonly expectedDiagnostic: string;
}

const duplicateRecord = (title: string): string => `---
pm-id: pm-book-duplicate
pm-type: book
pm-schema: 1
title: ${title}
---
Fictional fixture content.`;

export const MALFORMED_FIXTURES = [
  {
    id: 'invalid-yaml-sequence',
    category: 'invalid-yaml',
    sources: ['---\npm-id: [unterminated\n---\nFictional fixture content.'],
    expectedDiagnostic: 'Frontmatter cannot be parsed.'
  },
  {
    id: 'duplicate-record-id',
    category: 'duplicate-id',
    sources: [duplicateRecord('First fictional book'), duplicateRecord('Second fictional book')],
    expectedDiagnostic: 'Managed record ID is duplicated.'
  },
  {
    id: 'two-task-cycle',
    category: 'dependency-cycle',
    sources: ['pm-task-a depends-on pm-task-b', 'pm-task-b depends-on pm-task-a'],
    expectedDiagnostic: 'Task dependency cycle detected: pm-task-a → pm-task-b → pm-task-a.'
  },
  {
    id: 'asset-path-traversal',
    category: 'unsafe-path',
    sources: ['asset-path: ../../Outside-The-Vault/manuscript.docx'],
    expectedDiagnostic: 'Asset path must remain inside the vault.'
  },
  {
    id: 'hostile-markdown',
    category: 'unsafe-markup',
    sources: ['title: <script>fictionalAlert()</script>'],
    expectedDiagnostic: 'Untrusted markup must render as text.'
  },
  {
    id: 'oversized-summary',
    category: 'oversized-value',
    sources: [`summary: ${'x'.repeat(8_192)}`],
    expectedDiagnostic: 'Summary exceeds the supported fixture limit.'
  }
] as const satisfies readonly MalformedFixture[];
