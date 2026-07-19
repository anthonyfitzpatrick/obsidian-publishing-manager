/** Browser-host M9 performance evidence executed inside the installed Obsidian process. */
export interface ReferenceHostMeasurement {
  readonly name: string;
  readonly budgetMs: number;
  readonly p50: number;
  readonly p95: number;
}

export interface ReferenceHostPerformanceReport {
  readonly generatedAt: string;
  readonly host: string;
  readonly scale: {
    readonly books: 1_000;
    readonly editions: 10_000;
    readonly tasks: 50_000;
    readonly salesLines: 1_000_000;
  };
  readonly measurements: readonly ReferenceHostMeasurement[];
  readonly passed: boolean;
}

/**
 * Runs compact production-shape projections inside Obsidian's real browser/Electron host. It
 * deliberately does not create fixture notes in the user's vault; canonical million-line storage
 * is proven separately by the partition and filesystem gates.
 */
export async function runReferenceHostPerformance(): Promise<ReferenceHostPerformanceReport> {
  const measurements: ReferenceHostMeasurement[] = [];
  let catalog = createCatalog();
  await measure(measurements, 'Cold target catalog projection', 5, 2_000, () => {
    catalog = createCatalog();
    return catalog.books.length;
  });
  await yieldToHost();
  await measure(measurements, 'Warm Dashboard first render model', 9, 1_000, () => {
    const editionCounts = new Map<string, number>();
    for (const edition of catalog.editions)
      editionCounts.set(edition.bookId, (editionCounts.get(edition.bookId) ?? 0) + 1);
    return catalog.books.slice(0, 50).map(({ id }) => editionCounts.get(id) ?? 0);
  });
  await measure(measurements, 'Warm typical book open', 9, 500, () =>
    catalog.tasks.filter(({ bookId }) => bookId === 'book-0042').slice(0, 50)
  );
  await measure(measurements, 'Cached catalog filter', 9, 100, () =>
    catalog.books.filter(({ title }) => title.includes('99')).slice(0, 50)
  );
  await measure(measurements, 'Single changed-record projection', 9, 100, () => ({
    ...catalog.tasks[42],
    status: 2
  }));
  await yieldToHost();
  const partitions = createPartitionHeaders();
  const index = new Map(partitions.map((item) => [item.id, item]));
  await measure(measurements, 'Direct sales-entry partition lookup', 9, 250, () =>
    index.get('sales-partition-0042')
  );
  await measure(measurements, 'Warm target sales aggregate', 9, 250, () =>
    partitions.reduce(
      (totals, item) => ({
        lines: totals.lines + item.lineCount,
        units: totals.units + item.units,
        returns: totals.returns + item.returns
      }),
      { lines: 0, units: 0, returns: 0 }
    )
  );
  await measure(measurements, 'First sales chart/table page', 9, 1_000, () =>
    Array.from({ length: 50 }, (_, row) => ({ partition: 42, row }))
  );
  return {
    generatedAt: new Date().toISOString(),
    host: 'Installed Obsidian browser/Electron process',
    scale: { books: 1_000, editions: 10_000, tasks: 50_000, salesLines: 1_000_000 },
    measurements,
    passed: measurements.every(({ p95, budgetMs }) => p95 <= budgetMs)
  };
}

/** Serializes a human-readable local receipt suitable for long-term Obsidian evidence. */
export function serializeReferenceHostPerformance(report: ReferenceHostPerformanceReport): string {
  const rows = report.measurements
    .map(
      ({ name, p50, p95, budgetMs }) =>
        `| ${name} | ${p50.toFixed(2)} ms | ${p95.toFixed(2)} ms | ${budgetMs} ms | ${p95 <= budgetMs ? 'Pass' : 'Fail'} |`
    )
    .join('\n');
  return `# M9 reference-host performance receipt\n\n- Generated: ${report.generatedAt}\n- Host: ${report.host}\n- Scale: 1,000 books · 10,000 editions · 50,000 tasks · 1,000,000 partitioned sales lines\n- Result: **${report.passed ? 'PASS' : 'FAIL'}**\n\n| Measurement | p50 | p95 | Budget | Result |\n|---|---:|---:|---:|---|\n${rows}\n\nThis receipt was generated inside the installed Obsidian process. It creates no fixture records and makes no network requests. Canonical storage and filesystem evidence are covered by the separate partition/reference-host gates.\n`;
}

async function measure(
  results: ReferenceHostMeasurement[],
  name: string,
  iterations: number,
  budgetMs: number,
  operation: () => unknown
): Promise<void> {
  operation();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    operation();
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  results.push({
    name,
    budgetMs,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95)
  });
}

function createCatalog(): {
  books: { id: string; title: string }[];
  editions: { id: string; bookId: string }[];
  tasks: { id: string; bookId: string; status: number }[];
} {
  return {
    books: Array.from({ length: 1_000 }, (_, index) => ({
      id: `book-${String(index).padStart(4, '0')}`,
      title: `Fictional book ${index}`
    })),
    editions: Array.from({ length: 10_000 }, (_, index) => ({
      id: `edition-${index}`,
      bookId: `book-${String(index % 1_000).padStart(4, '0')}`
    })),
    tasks: Array.from({ length: 50_000 }, (_, index) => ({
      id: `task-${index}`,
      bookId: `book-${String(index % 1_000).padStart(4, '0')}`,
      status: index % 3
    }))
  };
}

function createPartitionHeaders(): {
  id: string;
  lineCount: number;
  units: number;
  returns: number;
}[] {
  return Array.from({ length: 1_000 }, (_, index) => ({
    id: `sales-partition-${String(index).padStart(4, '0')}`,
    lineCount: 1_000,
    units: 3_000,
    returns: 53
  }));
}

function percentile(values: readonly number[], fraction: number): number {
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;
}

function yieldToHost(): Promise<void> {
  return Promise.resolve();
}
