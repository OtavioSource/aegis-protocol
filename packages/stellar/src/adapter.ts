/**
 * StellarSettlementAdapter — implementação concreta do `SettlementAdapter`
 * (Extension Point chain-agnóstico definido em `@aegis/shared`).
 *
 * Composição:
 * - Carrega keypair da treasury no constructor (fail-fast).
 * - Resolve assets via TOML do anchor (cache embutido em anchor-toml.ts).
 * - Delega operações on-chain para `sponsorVendor` e `executePayment`.
 *
 * Uso típico em apps/api:
 *   const stellar = new StellarSettlementAdapter({
 *     network: 'testnet',
 *     treasurySecret: env.TREASURY_SECRET,
 *     anchorDomain: env.SEP24_ANCHOR_HOME_DOMAIN,
 *   });
 *   app.decorate('stellar', stellar);
 */

import type {
  AssetCode,
  ExecutePaymentParams as AdapterExecutePaymentParams,
  ExecutePaymentResult as AdapterExecutePaymentResult,
  SettlementAdapter,
  SponsorVendorParams as AdapterSponsorVendorParams,
  SponsorVendorResult as AdapterSponsorVendorResult,
  TreasuryBalance,
} from '@aegis/shared';
import { ChainType } from '@aegis/shared';
import { type Horizon, Keypair } from '@stellar/stellar-sdk';

import { findAnchorAssetIssuer, resolveAnchorToml } from './anchor-toml.js';
import { resolveAsset } from './assets.js';
import { createHorizonServer } from './horizon.js';
import { loadTreasuryKey } from './keypair.js';
import type { NetworkConfig, NetworkKind } from './network.js';
import { resolveNetwork } from './network.js';
import { executePayment } from './payment.js';
import { authenticateWithAnchor } from './sep10.js';
import {
  isTerminalSep24Status,
  type Sep24DepositResponse,
  type Sep24Transaction,
  sep24GetTransaction,
  sep24InitiateDeposit,
} from './sep24.js';
import { sponsorVendor } from './sponsoring.js';

export interface StellarSettlementAdapterOptions {
  network: NetworkKind;
  horizonUrl?: string;
  /** Secret key Stellar da treasury (S...). Sempre vem de env var. */
  treasurySecret: string;
  /** Domain do anchor SEP-1 (ex: "testanchor.stellar.org"). */
  anchorDomain: string;
}

export class StellarSettlementAdapter implements SettlementAdapter {
  readonly chain = ChainType.STELLAR;

  private readonly networkConfig: NetworkConfig;
  private readonly horizon: Horizon.Server;
  private readonly treasuryKeypair: Keypair;
  private readonly anchorDomain: string;

  constructor(options: StellarSettlementAdapterOptions) {
    this.networkConfig = resolveNetwork(options.network, {
      horizonUrl: options.horizonUrl,
    });
    this.horizon = createHorizonServer(this.networkConfig);
    this.treasuryKeypair = loadTreasuryKey(options.treasurySecret).keypair;
    this.anchorDomain = options.anchorDomain;
  }

  get treasuryPublicKey(): string {
    return this.treasuryKeypair.publicKey();
  }

  async sponsorVendor(
    params: AdapterSponsorVendorParams,
  ): Promise<AdapterSponsorVendorResult> {
    let vendorKeypair: Keypair;
    try {
      vendorKeypair = Keypair.fromSecret(params.vendorSecretKey);
    } catch (err) {
      throw new Error(`Invalid vendorSecretKey: ${(err as Error).message}`);
    }
    if (vendorKeypair.publicKey() !== params.vendorPublicKey) {
      throw new Error('vendorPublicKey does not match the public key derived from vendorSecretKey');
    }
    const asset = await resolveAsset(
      params.preferredAssetCode,
      this.networkConfig.kind,
      this.anchorDomain,
    );
    const result = await sponsorVendor({
      horizon: this.horizon,
      network: this.networkConfig,
      treasuryKeypair: this.treasuryKeypair,
      vendorKeypair,
      preferredAsset: asset,
    });
    return { txHash: result.txHash, xlmLocked: result.xlmLocked };
  }

  async executePayment(
    params: AdapterExecutePaymentParams,
  ): Promise<AdapterExecutePaymentResult> {
    const sourceAsset = await resolveAsset('USDC', this.networkConfig.kind, this.anchorDomain);
    const destAsset = await resolveAsset(
      params.destAssetCode,
      this.networkConfig.kind,
      this.anchorDomain,
    );
    const result = await executePayment({
      horizon: this.horizon,
      network: this.networkConfig,
      treasuryKeypair: this.treasuryKeypair,
      destinationPublicKey: params.destinationPublicKey,
      amountCents: params.amountCents,
      sourceAsset,
      destAsset,
      slippageTolerance: params.slippageTolerance,
      memoHash: params.memoHash,
    });
    return { txHash: result.txHash, ledger: result.ledger };
  }

  // ============ SEP-24 (fiat ramp) ============

  /**
   * Inicia um deposit SEP-24 no anchor configurado. Retorna a URL interactive
   * que o admin deve abrir em browser para completar KYC e dados bancários.
   *
   * Cycle:
   * 1. Resolve TOML do anchor (cached) → endpoints SEP-10 + SEP-24 + SIGNING_KEY
   * 2. SEP-10 authenticate (JWT cached por ~23h)
   * 3. POST /transactions/deposit/interactive → recebe id + url
   */
  async initiateDeposit(params: {
    assetCode: string;
    amount?: string;
  }): Promise<Sep24DepositResponse> {
    const ctx = await this.resolveAnchorContext();
    const jwt = await authenticateWithAnchor({
      network: this.networkConfig,
      webAuthEndpoint: ctx.webAuthEndpoint,
      anchorHomeDomain: this.anchorDomain,
      anchorSigningKey: ctx.signingKey,
      treasuryKeypair: this.treasuryKeypair,
    });
    const assetIssuer = await findAnchorAssetIssuer(this.anchorDomain, params.assetCode);
    return await sep24InitiateDeposit({
      transferServer: ctx.transferServer,
      jwt,
      assetCode: params.assetCode,
      assetIssuer: assetIssuer ?? undefined,
      amount: params.amount,
      account: this.treasuryKeypair.publicKey(),
    });
  }

  /**
   * Consulta status de uma transação SEP-24 no anchor.
   * Caller deve verificar `isTerminalSep24Status(result.status)` para decidir
   * se faz polling de novo ou para.
   */
  async pollDepositStatus(transactionId: string): Promise<Sep24Transaction> {
    const ctx = await this.resolveAnchorContext();
    const jwt = await authenticateWithAnchor({
      network: this.networkConfig,
      webAuthEndpoint: ctx.webAuthEndpoint,
      anchorHomeDomain: this.anchorDomain,
      anchorSigningKey: ctx.signingKey,
      treasuryKeypair: this.treasuryKeypair,
    });
    return await sep24GetTransaction({
      transferServer: ctx.transferServer,
      jwt,
      transactionId,
    });
  }

  /** Conveniência: true se status terminal. */
  isTerminalDepositStatus(status: string): boolean {
    return isTerminalSep24Status(status);
  }

  private async resolveAnchorContext(): Promise<{
    transferServer: string;
    webAuthEndpoint: string;
    signingKey: string;
  }> {
    const toml = await resolveAnchorToml(this.anchorDomain);
    const transferServer = toml.TRANSFER_SERVER_SEP0024 ?? toml.TRANSFER_SERVER;
    const webAuthEndpoint = toml.WEB_AUTH_ENDPOINT;
    const signingKey = toml.SIGNING_KEY;
    if (!transferServer || !webAuthEndpoint || !signingKey) {
      throw new Error(
        `Anchor ${this.anchorDomain} missing required TOML fields ` +
          `(TRANSFER_SERVER_SEP0024, WEB_AUTH_ENDPOINT, SIGNING_KEY)`,
      );
    }
    return { transferServer, webAuthEndpoint, signingKey };
  }

  async getTreasuryBalance(assetCode: AssetCode): Promise<TreasuryBalance> {
    const account = await this.horizon.loadAccount(this.treasuryKeypair.publicKey());
    const upper = assetCode.toUpperCase();

    if (upper === 'XLM') {
      const native = account.balances.find((b) => b.asset_type === 'native');
      return {
        assetCode: 'XLM',
        amount: native?.balance ?? '0',
        amountCents: null, // XLM não tem paridade USD direta
      };
    }

    const found = account.balances.find(
      (b) =>
        b.asset_type !== 'native' &&
        'asset_code' in b &&
        (b as { asset_code: string }).asset_code === upper,
    );
    const amount = found?.balance ?? '0';
    return {
      assetCode: upper,
      amount,
      amountCents: assetAmountToCents(amount),
    };
  }
}

/**
 * Converte amount string Stellar ("12.3456789") em centavos USD (1234).
 * Round-half-up para 2 casas decimais (centavos), depois trunca o resto.
 * Precisão suficiente para valores MVP até ~$90 quatrilhões.
 */
function assetAmountToCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}
