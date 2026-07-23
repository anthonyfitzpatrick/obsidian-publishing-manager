/** Immutable TPL-001 starter templates; callers must copy one before any user modification. */
import { validateTemplate, type PublishingTemplate } from './publishing-template';

const variable = (
  name: string,
  label: string,
  required: boolean,
  type: 'boolean' | 'date' | 'integer' | 'number' | 'string' = 'string',
  defaultValue?: unknown
) => ({
  name,
  label,
  type,
  required,
  ...(defaultValue === undefined ? {} : { default: defaultValue })
});

export const BUNDLED_PUBLISHING_TEMPLATES: readonly PublishingTemplate[] = (
  [
    {
      templateId: 'pm-bundled-book-basic-v1',
      kind: 'book',
      name: 'Basic book project',
      description:
        'Minimal planned book identity with language and an optional publisher.',
      version: 1,
      applicability: { scope: 'new-book' },
      defaults: {
        title: '{{title}}',
        'primary-language': '{{language}}',
        status: 'planned',
        publisher: '{{publisher}}'
      },
      requiredFields: ['title', 'primary-language', 'status'],
      variables: [
        variable('title', 'Book title', true),
        variable('language', 'Primary language', true, 'string', 'en'),
        variable('publisher', 'Publisher', false)
      ]
    },
    {
      templateId: 'pm-bundled-edition-basic-v1',
      kind: 'edition',
      name: 'Basic edition',
      version: 1,
      applicability: { scope: 'book' },
      defaults: {
        'book-id': '{{bookId}}',
        type: '{{editionType}}',
        medium: '{{medium}}',
        revision: 1,
        status: 'active'
      },
      requiredFields: ['book-id', 'type', 'medium', 'revision', 'status'],
      variables: [
        variable('bookId', 'Book ID', true),
        variable('editionType', 'Edition type', true, 'string', 'ebook'),
        variable('medium', 'Medium', true, 'string', 'digital')
      ]
    },
    {
      templateId: 'pm-bundled-task-basic-v1',
      kind: 'task',
      name: 'Workflow task',
      version: 1,
      applicability: { scope: 'workflow-stage' },
      defaults: {
        'book-id': '{{bookId}}',
        'workflow-id': '{{workflowId}}',
        'stage-id': '{{stageId}}',
        title: '{{title}}',
        status: 'todo',
        priority: 'normal',
        required: true,
        checklist: { items: [] }
      },
      requiredFields: [
        'book-id',
        'workflow-id',
        'stage-id',
        'title',
        'status',
        'priority',
        'required',
        'checklist'
      ],
      variables: [
        variable('bookId', 'Book ID', true),
        variable('workflowId', 'Workflow ID', true),
        variable('stageId', 'Stage ID', true),
        variable('title', 'Task title', true)
      ]
    },
    {
      templateId: 'pm-bundled-platform-target-v1',
      kind: 'platform',
      name: 'Distribution target',
      version: 1,
      applicability: { scope: 'edition-territory' },
      defaults: {
        'edition-id': '{{editionId}}',
        'profile-id': '{{profileId}}',
        platform: '{{platform}}',
        territory: '{{territory}}',
        'publication-location': '{{publicationLocation}}',
        intent: true,
        checklist: { items: [] },
        'metadata-ready': false,
        'assets-ready': false,
        'pricing-ready': false,
        'review-state': 'not-reviewed',
        'publication-state': 'not-started',
        'profile-version': 1
      },
      requiredFields: ['edition-id', 'profile-id', 'platform', 'territory', 'publication-location'],
      variables: [
        variable('editionId', 'Edition ID', true),
        variable('profileId', 'Platform profile ID', true),
        variable('platform', 'Platform', true),
        variable('territory', 'Territory', true),
        variable('publicationLocation', 'Publication location', true)
      ]
    },
    {
      templateId: 'pm-bundled-metadata-basic-v1',
      kind: 'metadata',
      name: 'Book metadata baseline',
      version: 1,
      applicability: { scope: 'book' },
      defaults: {
        'book-id': '{{bookId}}',
        scope: 'book',
        values: { language: '{{language}}' },
        'bisac-version': '{{bisacVersion}}',
        'thema-version': '{{themaVersion}}'
      },
      requiredFields: ['book-id', 'scope', 'values', 'bisac-version', 'thema-version'],
      variables: [
        variable('bookId', 'Book ID', true),
        variable('language', 'Language', true, 'string', 'en'),
        variable('bisacVersion', 'BISAC version/evidence', true, 'string', 'manual-unlicensed'),
        variable('themaVersion', 'Thema version', true, 'string', '1.6')
      ]
    },
    {
      templateId: 'pm-bundled-launch-standard-v1',
      kind: 'launch',
      name: 'Standard publication launch',
      version: 1,
      applicability: { scope: 'book-or-edition' },
      defaults: {
        'book-id': '{{bookId}}',
        'publication-date': '{{publicationDate}}',
        'template-id': 'pm-launch-standard',
        'template-version': 1,
        'reflow-mode': 'future-incomplete',
        milestones: { items: [] },
        'critical-path': []
      },
      requiredFields: [
        'book-id',
        'publication-date',
        'template-id',
        'template-version',
        'reflow-mode',
        'milestones',
        'critical-path'
      ],
      variables: [
        variable('bookId', 'Book ID', true),
        variable('publicationDate', 'Publication date', true, 'date')
      ]
    },
    {
      templateId: 'pm-bundled-price-basic-v1',
      kind: 'pricing',
      name: 'Territory price',
      version: 1,
      applicability: { scope: 'edition-platform-territory' },
      defaults: {
        'edition-id': '{{editionId}}',
        platform: '{{platform}}',
        territory: '{{territory}}',
        currency: '{{currency}}',
        amount: '{{amount}}',
        'tax-included': false,
        'effective-from': '{{effectiveFrom}}',
        source: 'Template preview; user review required'
      },
      requiredFields: [
        'edition-id',
        'platform',
        'territory',
        'currency',
        'amount',
        'tax-included',
        'effective-from',
        'source'
      ],
      variables: [
        variable('editionId', 'Edition ID', true),
        variable('platform', 'Platform', true),
        variable('territory', 'Territory', true),
        variable('currency', 'Currency', true),
        variable('amount', 'Amount', true, 'string'),
        variable('effectiveFrom', 'Effective from', true, 'date')
      ]
    },
    {
      templateId: 'pm-bundled-checklist-basic-v1',
      kind: 'checklist',
      name: 'Reusable checklist',
      version: 1,
      applicability: { scope: 'task-or-platform' },
      defaults: {
        label: '{{label}}',
        items: [
          { id: 'review-inputs', label: 'Review inputs', done: false },
          { id: 'record-evidence', label: 'Record evidence', done: false }
        ]
      },
      requiredFields: ['label', 'items'],
      variables: [variable('label', 'Checklist label', true)]
    }
  ] satisfies readonly PublishingTemplate[]
).map(validateTemplate);

export function bundledTemplate(templateId: string): PublishingTemplate | undefined {
  return BUNDLED_PUBLISHING_TEMPLATES.find((template) => template.templateId === templateId);
}
