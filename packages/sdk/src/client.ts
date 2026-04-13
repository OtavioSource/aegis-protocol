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

  /**
   * Pay a vendor via a Solana Pay URI.
   *
   * Parses the URI, extracts the vendor, amount, and reference, then submits
   * a governed SpendRequest through the Aegis policy engine. If auto-approved,
   * the SPL token transfer is executed immediately.
   *
   * This is the agent-side API for Solana Pay vendor invoices:
   *   vendor generates QR → agent calls aegis.pay(uri) → policy evaluates →
   *   transfer executes on-chain (with cNFT audit receipt)
   *
   * @param uri - Solana Pay URI (solana:<recipient>?amount=...&spl-token=...&label=...&message=...)
   * @param options.actionType - override action type (default: 'vendor_invoice')
   * @param options.reason - override spend reason (default: parsed from URI message/label)
   *
   * @example
   * const result = await aegis.pay('solana:So11...?amount=25&label=OpenAI&message=GPT-4+credits');
   * if (result.status === 'EXECUTED') {
   *   console.log('Paid! TX:', result.txSignature);
   * }
   */
  async pay(
    uri: string,
    options: { actionType?: string; reason?: string } = {},
  ): Promise<SpendRequestResponse> {
    const parsed = parseSolanaPayUri(uri);

    const vendor = parsed.label ?? parsed.recipient;
    const reason =
      options.reason ??
      parsed.message ??
      `Solana Pay invoice from ${vendor} for ${parsed.amount} USDC`;

    const result = await this.requestSpend({
      actionType: options.actionType ?? 'vendor_invoice',
      vendor,
      amount: parsed.amount,
      reason,
      ...(parsed.reference ? { reference: parsed.reference } : {}),
      metadata: {
        solanaPay: true,
        recipient: parsed.recipient,
        splTokenMint: parsed.splTokenMint,
        reference: parsed.reference,
        uri,
      },
    });

    if (result.status === 'APPROVED') {
      return this.execute(result.id);
    }

    return result;
  }
}

/**
 * parseSolanaPayUri() — parse a Solana Pay URI without heavy dependencies.
 *
 * Implements the Solana Pay URI spec (SIMD-0057):
 *   solana:<recipient>?amount=<amount>&spl-token=<mint>&reference=<ref>&label=<label>&message=<msg>
 *
 * Kept internal to the SDK to avoid importing @aegis/solana (heavy Node.js deps).
 */
function parseSolanaPayUri(uri: string): {
  recipient: string;
  amount: number;
  splTokenMint: string | null;
  reference: string | null;
  label: string | null;
  message: string | null;
} {
  if (!uri.startsWith('solana:')) {
    throw new Error(`Invalid Solana Pay URI: must start with 'solana:'`);
  }

  const withoutScheme = uri.slice('solana:'.length);
  const questionMark = withoutScheme.indexOf('?');
  const recipient = questionMark === -1 ? withoutScheme : withoutScheme.slice(0, questionMark);
  const queryString = questionMark === -1 ? '' : withoutScheme.slice(questionMark);
  const params = new URLSearchParams(queryString);

  const amountStr = params.get('amount');
  if (!amountStr) throw new Error('Solana Pay URI missing required amount parameter');
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) throw new Error(`Invalid amount in Solana Pay URI: ${amountStr}`);

  return {
    recipient,
    amount,
    splTokenMint: params.get('spl-token'),
    reference: params.get('reference'),
    label: params.get('label'),
    message: params.get('message'),
  };
}
