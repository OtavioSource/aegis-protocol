import type { SpendRequestStatus, PolicyDecision, Currency } from '@aegis/shared';

export type AegisOptions = {
  apiKey: string;
  baseUrl: string;
  agentId: string;
};

export type SpendRequestOptions = {
  actionType: string;
  vendor: string;
  amount: number;
  currency?: Currency;
  reason: string;
  reference?: string;
  metadata?: Record<string, unknown>;
};

export type SpendRequestResponse = {
  id: string;
  status: SpendRequestStatus;
  policyDecision: PolicyDecision | null;
  decisionReason: string | null;
  txSignature: string | null;
  explorerUrl: string | null;
};

/**
 * Aegis Protocol SDK — lightweight HTTP client for AI agents.
 *
 * @example
 * const rail = new Aegis({
 *   apiKey: 'agent_key_xxx',
 *   baseUrl: 'https://api.commandrail.io',
 *   agentId: 'agt_123',
 * });
 *
 * const result = await rail.requestSpend({
 *   actionType: 'purchase_api_access',
 *   vendor: 'DataVendorX',
 *   amount: 12.00,
 *   reason: 'Enrich leads for April campaign',
 * });
 */
export class Aegis {
  private readonly options: AegisOptions;

  constructor(options: AegisOptions) {
    this.options = options;
  }

  private async fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.options.baseUrl}${path}`;
    const response = await globalThis.fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
        ...init.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(`Aegis Protocol API error ${response.status}: ${JSON.stringify(error)}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Submit a spend request for evaluation.
   * Returns immediately with the policy decision.
   * If decision is REQUIRES_APPROVAL, poll getStatus() or wait for webhook.
   */
  async requestSpend(options: SpendRequestOptions): Promise<SpendRequestResponse> {
    return this.fetch<SpendRequestResponse>('/spend-requests', {
      method: 'POST',
      body: JSON.stringify({
        ...options,
        currency: options.currency ?? 'USDC',
        metadata: options.metadata ?? {},
      }),
    });
  }

  /**
   * Get the current status of a spend request.
   */
  async getStatus(requestId: string): Promise<SpendRequestResponse> {
    return this.fetch<SpendRequestResponse>(`/spend-requests/${requestId}`);
  }

  /**
   * Get the agent's current budget status.
   */
  async getBudgetStatus(): Promise<{
    dailySpent: number;
    dailyLimit: number;
    monthlySpent: number;
    monthlyLimit: number;
    currency: string;
  }> {
    return this.fetch(`/agents/${this.options.agentId}/budget-status`);
  }

  /**
   * Execute an approved spend request — triggers the Solana SPL token transfer.
   *
   * Only works on requests with status === 'APPROVED'.
   * After execution, the response includes txSignature and explorerUrl
   * that link to the real on-chain transaction.
   */
  async execute(requestId: string): Promise<SpendRequestResponse> {
    return this.fetch<SpendRequestResponse>(`/spend-requests/${requestId}/execute`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  /**
   * Submit a spend request and immediately execute it if auto-approved.
   *
   * Convenience method that combines requestSpend() + execute().
   * Returns immediately if the request is REQUIRES_APPROVAL or REJECTED.
   * The caller is responsible for polling getStatus() if REQUIRES_APPROVAL.
   *
   * @example
   * const result = await rail.requestAndExecute({
   *   actionType: 'purchase_api_access',
   *   vendor: 'OpenAI',
   *   amount: 15,
   *   reason: 'GPT-4 for customer support batch',
   * });
   *
   * if (result.status === 'EXECUTED') {
   *   console.log('Transfer complete! TX:', result.txSignature);
   *   console.log('Explorer:', result.explorerUrl);
   * } else if (result.status === 'REQUIRES_APPROVAL') {
   *   console.log('Waiting for human approval. Request ID:', result.id);
   * } else {
   *   console.log('Rejected:', result.decisionReason);
   * }
   */
  async requestAndExecute(options: SpendRequestOptions): Promise<SpendRequestResponse> {
    const result = await this.requestSpend(options);
    if (result.status === 'APPROVED') {
      return this.execute(result.id);
    }
    // REQUIRES_APPROVAL or REJECTED — caller handles
    return result;
  }

  /**
   * Poll for approval on a REQUIRES_APPROVAL request.
   *
   * Polls every intervalMs until status changes from REQUIRES_APPROVAL.
   * Returns the final status (APPROVED, REJECTED, EXECUTED, or FAILED).
   * Throws if timeoutMs is exceeded.
   *
   * After receiving APPROVED, call execute() to trigger the Solana transfer.
   *
   * @example
   * const result = await rail.requestSpend({ ... });
   * if (result.status === 'REQUIRES_APPROVAL') {
   *   console.log('Waiting for approval...');
   *   const final = await rail.waitForApproval(result.id);
   *   if (final.status === 'APPROVED') {
   *     const executed = await rail.execute(final.id);
   *     console.log('TX:', executed.txSignature);
   *   }
   * }
   */
  async waitForApproval(
    requestId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<SpendRequestResponse> {
    const { intervalMs = 3000, timeoutMs = 300_000 } = options;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await this.getStatus(requestId);
      if (status.status !== 'REQUIRES_APPROVAL') return status;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`waitForApproval timed out after ${timeoutMs}ms for request ${requestId}`);
  }
}
