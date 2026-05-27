import type { ConnectorInput, RawEvidenceBatch } from '../types/connector.types.js';

export abstract class BasePublicEvidenceConnector {
  abstract source: string;
  abstract name: string;
  abstract version: string;

  abstract fetch(input: ConnectorInput): Promise<RawEvidenceBatch>;

  protected async withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
    throw lastError;
  }
}
