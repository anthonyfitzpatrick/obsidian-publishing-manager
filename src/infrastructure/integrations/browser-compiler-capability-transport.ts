/**
 * Uses synchronous browser CustomEvents as a neutral local discovery/request bus. The adapter does
 * not inspect another plugin instance or import its code. Providers must explicitly answer the
 * public event contract during the dispatch; absence therefore fails closed on desktop/mobile.
 */
import type {
  CompilerCapabilityTransport,
  CompilerExportRequest,
  CompilerTimerPort
} from '../../application/integrations/manuscript-compiler-integration';
import {
  COMPILER_MAX_ACKNOWLEDGEMENT_BYTES,
  COMPILER_MAX_DESCRIPTOR_BYTES,
  COMPILER_MAX_RESULT_BYTES
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
    let acceptingResponses = true;
    const detail: DiscoveryDetail = {
      requester: 'publishing-manager',
      respond: (value) => {
        if (!acceptingResponses || responses.length >= 2) return;
        // Provider values are untrusted. A JSON round trip rejects cyclic/prototyped data and
        // prevents an unbounded value from crossing into the application negotiation service.
        responses.push(boundedDataClone(value, COMPILER_MAX_DESCRIPTOR_BYTES));
      }
    };
    try {
      window.dispatchEvent(new CustomEvent<DiscoveryDetail>(COMPILER_DISCOVERY_EVENT, { detail }));
    } catch {
      return [{ invalidProviderResponse: true }];
    } finally {
      acceptingResponses = false;
    }
    return responses;
  }

  public async request(payload: CompilerExportRequest): Promise<unknown> {
    const responses: unknown[] = [];
    let acceptingResponses = true;
    const detail: RequestDetail = {
      requester: 'publishing-manager',
      payload: structuredClone(payload),
      respond: (value) => {
        if (!acceptingResponses || responses.length >= 2) return;
        responses.push(boundedDataClone(value, COMPILER_MAX_ACKNOWLEDGEMENT_BYTES));
      }
    };
    try {
      window.dispatchEvent(new CustomEvent<RequestDetail>(COMPILER_REQUEST_EVENT, { detail }));
    } catch {
      throw new Error('Compiler returned invalid or oversized local acknowledgement data.');
    } finally {
      acceptingResponses = false;
    }
    if (responses.length === 0) throw new Error('Compiler did not acknowledge the local request.');
    if (responses.length > 1) throw new Error('More than one compiler acknowledged the request.');
    return responses[0];
  }

  /** Receives data-only completion evidence; application validation remains the trust boundary. */
  public subscribeResults(listener: (payload: unknown) => void): () => void {
    const receive = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      try {
        listener(boundedDataClone(event.detail, COMPILER_MAX_RESULT_BYTES));
      } catch {
        listener({ invalidProviderResponse: true });
      }
    };
    window.addEventListener(COMPILER_RESULT_EVENT, receive);
    return () => window.removeEventListener(COMPILER_RESULT_EVENT, receive);
  }
}

/** Copies only bounded JSON data so browser events cannot convey live provider objects. */
function boundedDataClone(value: unknown, maximumBytes: number): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > maximumBytes)
    throw new Error('Provider response is not bounded contract data.');
  return JSON.parse(serialized) as unknown;
}

/** Owns browser timers in infrastructure so request control follows the active host window API. */
export class BrowserCompilerTimer implements CompilerTimerPort {
  public setTimeout(action: () => void, milliseconds: number): number {
    return window.setTimeout(action, milliseconds);
  }
  public clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') window.clearTimeout(handle);
  }
  public setInterval(action: () => void, milliseconds: number): number {
    return window.setInterval(action, milliseconds);
  }
  public clearInterval(handle: unknown): void {
    if (typeof handle === 'number') window.clearInterval(handle);
  }
}
