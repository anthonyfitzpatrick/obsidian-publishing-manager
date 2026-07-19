/** Records successful canonical mutations without changing the underlying repository contract. */
import type {
  LoadedManagedRecord,
  ManagedRecordPatch,
  ManagedRecordRepositoryPort,
  NewManagedRecord
} from '../storage/record-storage-ports';
import type { VaultPath } from '../../domain/storage/vault-path';
import type { HistoryProjectService } from './history-project-service';

export class HistoryRecordingRepository implements ManagedRecordRepositoryPort {
  public constructor(
    private readonly inner: ManagedRecordRepositoryPort,
    private readonly history: HistoryProjectService
  ) {}
  public load(path: VaultPath): Promise<LoadedManagedRecord> {
    return this.inner.load(path);
  }
  public async create(path: VaultPath, record: NewManagedRecord): Promise<LoadedManagedRecord> {
    const created = await this.inner.create(path, record);
    await this.history.capture('created', undefined, created);
    return created;
  }
  public async save(
    loaded: LoadedManagedRecord,
    patch: ManagedRecordPatch,
    updatedAt: string
  ): Promise<LoadedManagedRecord> {
    const saved = await this.inner.save(loaded, patch, updatedAt);
    if (saved.sourceRevision !== loaded.sourceRevision)
      await this.history.capture('updated', loaded, saved);
    return saved;
  }
  public async setArchivedAt(
    loaded: LoadedManagedRecord,
    archivedAt: string | undefined,
    updatedAt: string
  ): Promise<LoadedManagedRecord> {
    const saved = await this.inner.setArchivedAt(loaded, archivedAt, updatedAt);
    if (saved.sourceRevision !== loaded.sourceRevision)
      await this.history.capture(archivedAt === undefined ? 'restored' : 'archived', loaded, saved);
    return saved;
  }
}
