import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, arch, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

/**
 * Runs the documented M9 budgets on the actual release host and its filesystem. The generated
 * vault is disposable, fictional, partitioned, and never opened over a network. This complements
 * deterministic CI: it records the machine rather than pretending all hosts have identical cost.
 */
const root = await mkdtemp(join(tmpdir(), 'publishing-manager-reference-'));
const samples = [];
try {
  const catalog = createCatalogIndex();
  const partitions = createSalesPartitionHeaders();
  await writeFile(join(root, 'catalog-index.json'), JSON.stringify(catalog), 'utf8');
  await writeFile(join(root, 'sales-index.json'), JSON.stringify(partitions), 'utf8');
  await Promise.all(
    partitions.map((partition) =>
      writeFile(join(root, `${partition.id}.md`), partition.rows, 'utf8')
    )
  );

  await measure('cold catalog usable', 5, 2_000, async () => {
    const source = await readFile(join(root, 'catalog-index.json'), 'utf8');
    return JSON.parse(source).books.length;
  });
  const warmCatalog = JSON.parse(await readFile(join(root, 'catalog-index.json'), 'utf8'));
  await measure('warm dashboard first render model', 9, 1_000, async () => {
    const editions = new Map();
    for (const item of warmCatalog.editions)
      editions.set(item.bookId, (editions.get(item.bookId) ?? 0) + 1);
    return warmCatalog.books.slice(0, 50).map((book) => editions.get(book.id) ?? 0);
  });
  await measure('warm typical book open', 9, 500, async () =>
    warmCatalog.tasks.filter(({ bookId }) => bookId === 'book-0042').slice(0, 50)
  );
  await measure('cached catalog filter', 9, 100, async () =>
    warmCatalog.books.filter(({ title }) => title.includes('99')).slice(0, 50)
  );
  await measure('single changed-record projection', 9, 100, async () => {
    const item = warmCatalog.tasks[42];
    return item === undefined ? undefined : { ...item, status: 'done' };
  });
  const warmSales = JSON.parse(await readFile(join(root, 'sales-index.json'), 'utf8'));
  await measure('direct sales-entry duplicate partition lookup', 9, 250, async () =>
    warmSales.find(({ id }) => id === 'sales-partition-0042')
  );
  await measure('warm target sales aggregate', 9, 250, async () =>
    warmSales.reduce(
      (result, item) => ({
        lines: result.lines + item.lineCount,
        units: result.units + item.units,
        returns: result.returns + item.returns
      }),
      { lines: 0, units: 0, returns: 0 }
    )
  );
  await measure('first sales chart/table page', 9, 1_000, async () => {
    const source = await readFile(join(root, 'sales-partition-0042.md'), 'utf8');
    return source.split('\n', 50);
  });
  await measure(
    'managed partition discovery',
    7,
    2_000,
    async () => (await readdir(root)).filter((name) => name.startsWith('sales-partition-')).length
  );

  const failures = samples.filter(({ p95, budgetMs }) => p95 > budgetMs);
  const report = {
    generatedAt: new Date().toISOString(),
    host: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      cpu: cpus()[0]?.model ?? 'Unknown',
      logicalCpus: cpus().length,
      memoryMiB: Math.round(totalmem() / 1024 / 1024),
      node: process.version
    },
    scale: { books: 1_000, editions: 10_000, tasks: 50_000, salesLines: 1_000_000 },
    samples,
    peakHeapMiB: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)),
    passed: failures.length === 0
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}

async function measure(name, iterations, budgetMs, operation) {
  await operation();
  const durations = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await operation();
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  samples.push({
    name,
    budgetMs,
    p50: rounded(percentile(durations, 0.5)),
    p95: rounded(percentile(durations, 0.95))
  });
}

function createCatalogIndex() {
  const books = Array.from({ length: 1_000 }, (_, index) => ({
    id: `book-${String(index).padStart(4, '0')}`,
    title: `Fictional book ${index}`
  }));
  const editions = Array.from({ length: 10_000 }, (_, index) => ({
    id: `edition-${index}`,
    bookId: `book-${String(index % 1_000).padStart(4, '0')}`
  }));
  const tasks = Array.from({ length: 50_000 }, (_, index) => ({
    id: `task-${index}`,
    bookId: `book-${String(index % 1_000).padStart(4, '0')}`,
    status: index % 3
  }));
  return { books, editions, tasks };
}

function createSalesPartitionHeaders() {
  return Array.from({ length: 1_000 }, (_, partitionIndex) => {
    const rows = [];
    let units = 0;
    let returns = 0;
    for (let row = 0; row < 1_000; row += 1) {
      const index = partitionIndex * 1_000 + row;
      const rowUnits = (index % 5) + 1;
      const rowReturns = index % 19 === 0 ? 1 : 0;
      units += rowUnits;
      returns += rowReturns;
      rows.push(`${index},${rowUnits},${rowReturns}`);
    }
    return {
      id: `sales-partition-${String(partitionIndex).padStart(4, '0')}`,
      lineCount: 1_000,
      units,
      returns,
      rows: rows.join('\n')
    };
  });
}

function percentile(values, fraction) {
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;
}

function rounded(value) {
  return Number(value.toFixed(2));
}
