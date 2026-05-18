import type { ChainType } from './enums.js';
import type { AssetCode } from './types.js';

/**
 * `SettlementAdapter` — Extension Point para suportar múltiplas chains no futuro
 * sem reescrever o núcleo do produto.
 *
 * No MVP, apenas a implementação Stellar existe (`@aegis/stellar`). Solana,
 * Base, etc., entram conforme demanda — apenas implementando esta interface.
 *
 * Decisão D4 e ADR-0001.
 */
export interface SettlementAdapter {
  readonly chain: ChainType;

  /**
   * Cria a wallet do vendor com 0 XLM próprio e abre trustline para o asset
   * preferido — tudo sponsoreado pela Aegis treasury via CAP-33.
   *
   * Ver `docs/05-zero-friction-onboarding.md`.
   */
  sponsorVendor(params: SponsorVendorParams): Promise<SponsorVendorResult>;

  /**
   * Executa pagamento da treasury para a wallet do vendor.
   *
   * Ramifica internamente:
   * - Se `destAssetCode === USDC`: operação `Payment` direta.
   * - Caso contrário: `PathPaymentStrictReceive` convertendo USDC →
   *   destAssetCode via DEX nativa (RF11, ver `docs/04 §6`).
   */
  executePayment(params: ExecutePaymentParams): Promise<ExecutePaymentResult>;

  /**
   * Saldo atual da treasury para um asset específico (consulta em tempo real
   * via Horizon; pode ter cache curto).
   */
  getTreasuryBalance(assetCode: AssetCode): Promise<TreasuryBalance>;
}

export interface SponsorVendorParams {
  /** Public key da wallet do vendor (G... na Stellar). */
  vendorPublicKey: string;
  /** Chave secreta do vendor — necessária para assinar ChangeTrust no Modo AEGIS. */
  vendorSecretKey: string;
  /** Asset code que o vendor prefere receber (USDC default; EURC/BRL/ARS aceitos). */
  preferredAssetCode: AssetCode;
}

export interface SponsorVendorResult {
  /** Hash da transação atomic de sponsoring (4 operações). */
  txHash: string;
  /** Quantidade de XLM travada em reserves na treasury (recuperável). */
  xlmLocked: string;
}

export interface ExecutePaymentParams {
  /** Public key da wallet do vendor. */
  destinationPublicKey: string;
  /** Valor a transferir, em centavos USD (engine valida limites). */
  amountCents: number;
  /** Asset que o vendor recebe (USDC, EURC, BRL, etc.). */
  destAssetCode: AssetCode;
  /**
   * Slippage tolerance para Path Payment (0 a 1; default 0.01 = 1%).
   * Ignorado quando `destAssetCode === USDC`.
   */
  slippageTolerance?: number;
  /**
   * Hash de 32 bytes a anexar como `Memo.hash` na operação Stellar.
   * Aegis usa para incluir `sha256(spendRequestId)`.
   */
  memoHash?: Uint8Array;
}

export interface ExecutePaymentResult {
  /** Hash da transação Stellar (linkável no Stellar Expert). */
  txHash: string;
  /** Número do ledger em que a tx confirmou. */
  ledger: number;
}

export interface TreasuryBalance {
  assetCode: AssetCode;
  /** Saldo formatado como string decimal (precisão 7 para assets Stellar). */
  amount: string;
  /** Saldo em centavos (apenas para assets com paridade USD-like; null caso contrário). */
  amountCents: number | null;
}
