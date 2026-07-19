/**
 * Registers a public browser-local read provider without accessing Metadata Visuals internals.
 * Consumers must explicitly dispatch the versioned events and receive cloned data-only responses.
 */
import type { MetadataVisualsProviderService } from '../../application/integrations/metadata-visuals-provider';

export const METADATA_VISUALS_DISCOVERY_EVENT = 'publishing-manager:metadata-visuals:discover:v1';
export const METADATA_VISUALS_QUERY_EVENT = 'publishing-manager:metadata-visuals:query:v1';

interface DiscoveryDetail {
  readonly requester: 'metadata-visuals';
  respond(value: unknown): void;
}
interface QueryDetail {
  readonly requester: 'metadata-visuals';
  readonly payload: unknown;
  respond(value: unknown): void;
}

export class BrowserMetadataVisualsProviderTransport {
  public constructor(private readonly provider: MetadataVisualsProviderService) {}

  /** Returns one cleanup callback suitable for Obsidian Plugin.register. */
  public start(): () => void {
    const discover = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const detail = discoveryDetail(event.detail);
      if (detail === undefined) return;
      detail.respond(structuredClone(this.provider.descriptor()));
    };
    const query = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const detail = queryDetail(event.detail);
      if (detail === undefined) return;
      // A current readiness evaluation may complete asynchronously. The event carries only data,
      // and the consumer receives a cloned response after the application service finishes.
      void this.provider
        .handle(detail.payload)
        .then((response) => detail.respond(structuredClone(response)));
    };
    window.addEventListener(METADATA_VISUALS_DISCOVERY_EVENT, discover);
    window.addEventListener(METADATA_VISUALS_QUERY_EVENT, query);
    return () => {
      window.removeEventListener(METADATA_VISUALS_DISCOVERY_EVENT, discover);
      window.removeEventListener(METADATA_VISUALS_QUERY_EVENT, query);
    };
  }
}

function discoveryDetail(value: unknown): DiscoveryDetail | undefined {
  if (
    !isObject(value) ||
    value.requester !== 'metadata-visuals' ||
    typeof value.respond !== 'function'
  )
    return undefined;
  return value as unknown as DiscoveryDetail;
}
function queryDetail(value: unknown): QueryDetail | undefined {
  if (
    !isObject(value) ||
    value.requester !== 'metadata-visuals' ||
    typeof value.respond !== 'function' ||
    !('payload' in value)
  )
    return undefined;
  return value as unknown as QueryDetail;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
