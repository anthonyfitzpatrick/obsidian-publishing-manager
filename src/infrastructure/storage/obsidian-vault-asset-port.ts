/** Uses supported Obsidian Vault APIs for arbitrary file evidence and explicit binary reads. */
import { TFile, type Vault } from 'obsidian';
import type {
  ContentFingerprintPort,
  VaultAssetEvidence,
  VaultAssetPort
} from '../../application/storage/record-storage-ports';
import type { VaultPath } from '../../domain/storage/vault-path';

export class ObsidianVaultAssetPort implements VaultAssetPort {
  public constructor(private readonly vault: Vault) {}
  public async inspect(path: VaultPath): Promise<VaultAssetEvidence> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return { exists: false };
    return {
      exists: true,
      modifiedTime: new Date(file.stat.mtime).toISOString(),
      size: file.stat.size
    };
  }
  public async readBinary(path: VaultPath): Promise<ArrayBuffer> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Asset file is missing: ${path}.`);
    return this.vault.readBinary(file);
  }
}

/** Web Crypto is available in supported Obsidian desktop/mobile runtimes and avoids Node APIs. */
export class WebCryptoContentFingerprintPort implements ContentFingerprintPort {
  public async sha256(content: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', content);
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
}
