/**
 * Uses synchronous browser CustomEvents as a neutral local discovery/request bus. The adapter does
 * not inspect another plugin instance or import its code. Providers must explicitly answer the
 * public event contract during the dispatch; absence therefore fails closed on desktop/mobile.
 */
import type {
  CompilerCapabilityTransport,
  CompilerExportRequest
} from '../../application/integrations/manuscript-compiler-integration';

export const COMPILER_DISCOVERY_EVENT = 'publishing-manager:compiler:discover:v1';
export const COMPILER_REQUEST_EVENT = 'publishing-manager:compiler:request:v1';
export const COMPILER_RESULT_EVENT = 'publishing-manager:compiler:result:v1';

interface DiscoveryDetail {
  readonly requester: 'publishing-manager';
  respond(value: unknown): void;
}
interface RequestDetail {
  readonly requester: 'publishing-manager';
  readonly payload: CompilerExportRequest;
  respond(value: unknown): void;
}

export class BrowserCompilerCapabilityTransport implements CompilerCapabilityTransport {
  public async discover(): Promise<readonly unknown[]> {
    const responses: unknown[] = [];
    const detail: DiscoveryDetail = {
      requester: 'publishing-manager',
      respond: (value) => responses.push(structuredClone(value))
    };
    window.dispatchEvent(new CustomEvent<DiscoveryDetail>(COMPILER_DISCOVERY_EVENT, { detail }));
    return responses;
  }

  public async request(payload: CompilerExportRequest): Promise<unknown> {
    const responses: unknown[] = [];
    const detail: RequestDetail = {
      requester: 'publishing-manager',
      payload: structuredClone(payload),
      respond: (value) => responses.push(structuredClone(value))
    };
    window.dispatchEvent(new CustomEvent<RequestDetail>(COMPILER_REQUEST_EVENT, { detail }));
    if (responses.length === 0) throw new Error('Compiler did not acknowledge the local request.');
    if (responses.length > 1) throw new Error('More than one compiler acknowledged the request.');
    return responses[0];
  }

  /** Receives data-only completion evidence; application validation remains the trust boundary. */
  public subscribeResults(listener: (payload: unknown) => void): () => void {
    const receive = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      listener(structuredClone(event.detail));
    };
    window.addEventListener(COMPILER_RESULT_EVENT, receive);
    return () => window.removeEventListener(COMPILER_RESULT_EVENT, receive);
  }
}
