/**
 * SEP-24 client — Hosted Deposit / Withdrawal.
 *
 * Fluxo deposit (fiat → USDC):
 *   1. Aegis chama POST <transferServer>/transactions/deposit/interactive
 *      com Authorization: Bearer <SEP-10 JWT> + body { asset_code, amount?, account? }
 *   2. Anchor retorna { id, url, type } — `url` é a página interactive (KYC + dados bancários)
 *   3. Admin abre `url` no browser, completa o fluxo
 *   4. Anchor processa fiat (mock no test-anchor) e envia USDC pra treasury
 *   5. Aegis poll GET <transferServer>/transaction?id=<id> até status terminal
 *
 * Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
 */

export interface Sep24DepositRequest {
  /** URL base do transfer server (ex: `https://testanchor.stellar.org/sep24`). */
  transferServer: string;
  /** JWT obtido via SEP-10. */
  jwt: string;
  /** Asset code a depositar (USDC, EURC, etc.). */
  assetCode: string;
  /** Issuer do asset (opcional; alguns anchors exigem). */
  assetIssuer?: string;
  /** Quantidade sugerida (anchor pode ajustar). */
  amount?: string;
  /** Conta destino (default: derivada do JWT — treasury). */
  account?: string;
  /** Lang preferida ("pt", "en", etc.). */
  lang?: string;
}

export interface Sep24DepositResponse {
  /** ID da transação no anchor (use em pollTransaction). */
  id: string;
  /** URL da página interactive — admin abre no browser. */
  url: string;
  type: 'interactive_customer_info_needed' | string;
}

export async function sep24InitiateDeposit(
  params: Sep24DepositRequest,
): Promise<Sep24DepositResponse> {
  const url = `${stripTrailingSlash(params.transferServer)}/transactions/deposit/interactive`;
  const body: Record<string, string | undefined> = {
    asset_code: params.assetCode,
    asset_issuer: params.assetIssuer,
    amount: params.amount,
    account: params.account,
    lang: params.lang,
  };
  // Remove keys undefined
  const cleanBody = Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.jwt}`,
      'content-type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(cleanBody),
  });
  if (!resp.ok) {
    throw new Error(
      `SEP-24 deposit/interactive failed: HTTP ${resp.status} ${await safeText(resp)}`,
    );
  }
  const data = (await resp.json()) as Sep24DepositResponse;
  if (!data.id || !data.url) {
    throw new Error('SEP-24 deposit response missing id or url');
  }
  return data;
}

// ============================================================================
// poll transaction
// ============================================================================

export type Sep24TransactionStatus =
  | 'incomplete'
  | 'pending_user_transfer_start'
  | 'pending_user_transfer_complete'
  | 'pending_external'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_trust'
  | 'pending_user'
  | 'pending_customer_info_update'
  | 'pending_transaction_info_update'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'no_market'
  | 'too_small'
  | 'too_large'
  | 'error';

/**
 * Estados terminais: anchor não vai mais mexer. Pollar mais é desperdício.
 */
export const TERMINAL_SEP24_STATUSES: ReadonlyArray<Sep24TransactionStatus> = [
  'completed',
  'refunded',
  'expired',
  'no_market',
  'too_small',
  'too_large',
  'error',
];

export function isTerminalSep24Status(s: string): boolean {
  return (TERMINAL_SEP24_STATUSES as readonly string[]).includes(s);
}

export interface Sep24Transaction {
  id: string;
  kind: 'deposit' | 'withdrawal';
  status: Sep24TransactionStatus;
  status_eta?: number;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  /** Hash da tx Stellar quando anchor enviou USDC pra treasury. */
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  started_at?: string;
  completed_at?: string;
  message?: string;
  /** URL interactive (mesmo após init). */
  more_info_url?: string;
}

export interface Sep24PollRequest {
  transferServer: string;
  jwt: string;
  transactionId: string;
}

export async function sep24GetTransaction(
  params: Sep24PollRequest,
): Promise<Sep24Transaction> {
  const url = `${stripTrailingSlash(params.transferServer)}/transaction?id=${encodeURIComponent(
    params.transactionId,
  )}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${params.jwt}`,
      Accept: 'application/json',
    },
  });
  if (!resp.ok) {
    throw new Error(
      `SEP-24 /transaction failed: HTTP ${resp.status} ${await safeText(resp)}`,
    );
  }
  const data = (await resp.json()) as { transaction?: Sep24Transaction };
  if (!data.transaction) {
    throw new Error('SEP-24 /transaction response missing "transaction" field');
  }
  return data.transaction;
}

// ============================================================================
// Helpers internos
// ============================================================================

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 300);
  } catch {
    return '';
  }
}
