import type { SpendRequestStatus, PolicyDecision, Currency } from '@command-rail/shared';

export type CommandRailOptions = {
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
 * CommandRail SDK — lightweight HTTP client for AI agents.
 *
 * @example
 * const rail = new CommandRail({
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
export class CommandRail {
  private readonly options: CommandRailOptions;

  constructor(options: CommandRailOptions) {
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
      throw new Error(`CommandRail API error ${response.status}: ${JSON.stringify(error)}`);
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
}
