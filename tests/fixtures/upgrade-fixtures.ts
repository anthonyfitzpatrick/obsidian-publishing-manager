export type UpgradeFixtureMode = 'migrate' | 'current' | 'read-only' | 'resume';

export interface UpgradeFixture {
  readonly id: string;
  readonly sourceSchema: number;
  readonly targetSchema: number;
  readonly expectedMode: UpgradeFixtureMode;
  readonly source: Readonly<Record<string, unknown>>;
  readonly expectedPreservedKeys: readonly string[];
}

export const UPGRADE_FIXTURES = [
  {
    id: 'previous-schema-book',
    sourceSchema: 0,
    targetSchema: 1,
    expectedMode: 'migrate',
    source: {
      'pm-id': 'pm-book-upgrade-0001',
      'pm-type': 'book',
      'pm-schema': 0,
      workingTitle: 'The Copper Meridian',
      'fixture-unknown-safe-key': 'preserve me'
    },
    expectedPreservedKeys: ['pm-id', 'pm-type', 'fixture-unknown-safe-key']
  },
  {
    id: 'current-schema-book',
    sourceSchema: 1,
    targetSchema: 1,
    expectedMode: 'current',
    source: {
      'pm-id': 'pm-book-upgrade-0002',
      'pm-type': 'book',
      'pm-schema': 1,
      title: 'The Paper Observatory'
    },
    expectedPreservedKeys: ['pm-id', 'pm-type', 'title']
  },
  {
    id: 'future-schema-book',
    sourceSchema: 99,
    targetSchema: 1,
    expectedMode: 'read-only',
    source: {
      'pm-id': 'pm-book-upgrade-0003',
      'pm-type': 'book',
      'pm-schema': 99,
      title: 'A Future Fictional Record',
      'future-field': { meaning: 'unknown but safe' }
    },
    expectedPreservedKeys: ['pm-id', 'pm-type', 'title', 'future-field']
  },
  {
    id: 'interrupted-migration-journal',
    sourceSchema: 0,
    targetSchema: 1,
    expectedMode: 'resume',
    source: {
      migrationId: 'fixture-migration-0001',
      completedRecordIds: ['pm-book-upgrade-0001'],
      pendingRecordIds: ['pm-book-upgrade-0002'],
      checkpoint: 1
    },
    expectedPreservedKeys: ['migrationId', 'completedRecordIds', 'pendingRecordIds']
  }
] as const satisfies readonly UpgradeFixture[];
