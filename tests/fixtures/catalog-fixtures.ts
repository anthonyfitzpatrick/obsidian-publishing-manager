export interface FixtureProfile {
  readonly bookCount: number;
  readonly editionCount: number;
  readonly taskCount: number;
}

export interface FixtureBook {
  readonly id: string;
  readonly schema: 1;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FixtureEdition {
  readonly id: string;
  readonly schema: 1;
  readonly bookId: string;
  readonly label: string;
  readonly assetPath?: string;
}

export interface FixtureTask {
  readonly id: string;
  readonly schema: 1;
  readonly bookId: string;
  readonly title: string;
  readonly status: 'todo' | 'doing' | 'done';
  readonly dependsOn?: string;
}

export interface CatalogFixture {
  readonly profile: FixtureProfileName;
  readonly books: readonly FixtureBook[];
  readonly editions: readonly FixtureEdition[];
  readonly tasks: readonly FixtureTask[];
}

export const FIXTURE_PROFILES = {
  small: { bookCount: 25, editionCount: 100, taskCount: 250 },
  targetScale: { bookCount: 1_000, editionCount: 10_000, taskCount: 50_000 }
} as const satisfies Record<string, FixtureProfile>;

export type FixtureProfileName = keyof typeof FIXTURE_PROFILES;

const FIXED_TIMESTAMP = '2026-01-15T12:00:00.000Z';
const FICTIONAL_BOOK_STEMS = [
  'Harbour of Glass',
  'The Juniper Signal',
  'Lanterns Beyond Orison',
  'A Map of Quiet Stars',
  'The Clockmaker of Brindle Bay'
] as const;
const TASK_STATUSES = ['todo', 'doing', 'done'] as const;

function padded(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function bookId(index: number): string {
  return `pm-book-${padded(index + 1, 4)}`;
}

function taskId(index: number): string {
  return `pm-task-${padded(index + 1, 5)}`;
}

export function createCatalogFixture(profile: FixtureProfileName): CatalogFixture {
  const counts = FIXTURE_PROFILES[profile];
  const books: FixtureBook[] = [];
  const editions: FixtureEdition[] = [];
  const tasks: FixtureTask[] = [];

  for (let index = 0; index < counts.bookCount; index += 1) {
    const stem = FICTIONAL_BOOK_STEMS[index % FICTIONAL_BOOK_STEMS.length] ?? 'Fixture Book';
    books.push({
      id: bookId(index),
      schema: 1,
      title: `${stem} ${padded(index + 1, 4)}`,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP
    });
  }

  for (let index = 0; index < counts.editionCount; index += 1) {
    const ownerIndex = index % counts.bookCount;
    const editionNumber = Math.floor(index / counts.bookCount) + 1;
    editions.push({
      id: `pm-edition-${padded(index + 1, 5)}`,
      schema: 1,
      bookId: bookId(ownerIndex),
      label: `Fictional edition ${editionNumber}`,
      ...(editionNumber % 4 === 0
        ? { assetPath: `Fixtures/Assets/cover-${padded(ownerIndex + 1, 4)}.png` }
        : {})
    });
  }

  for (let index = 0; index < counts.taskCount; index += 1) {
    const ownerIndex = index % counts.bookCount;
    const taskNumber = Math.floor(index / counts.bookCount) + 1;
    const previousTaskIndex = index - counts.bookCount;
    tasks.push({
      id: taskId(index),
      schema: 1,
      bookId: bookId(ownerIndex),
      title: `Fictional publishing task ${padded(taskNumber, 3)}`,
      status: TASK_STATUSES[index % TASK_STATUSES.length] ?? 'todo',
      ...(taskNumber > 1 && taskNumber % 3 === 0 ? { dependsOn: taskId(previousTaskIndex) } : {})
    });
  }

  return { profile, books, editions, tasks };
}
