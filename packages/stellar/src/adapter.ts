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
import { type Horizon, Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

import { deriveAegisSigner } from './aegis-signer.js';
import { findAnchorAssetIssuer, resolveAnchorToml } from './anchor-toml.js';
import { centsToAssetString, resolveAsset } from './assets.js';
import { createHorizonServer } from './horizon.js';
import { loadTreasuryKey } from './keypair.js';
import {
  buildPaymentEnvelope,
  buildWalletSetupTransaction,
  cosignMatchingEnvelope,
} from './multisig.js';
import type { NetworkConfig, NetworkKind } from './network.js';
import { resolveNetwork } from './network.js';
import { executePayment, extractHorizonError } from './payment.js';
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
  /**
   * Secret key Stellar da conta operacional do Aegis (S...). Sempre vem de env var.
   * Usada como admin do Soroban audit, source/sponsor de setup de carteira e
   * facilitator x402 — NÃO custodia fundos de usuário (modelo não-custodial).
   */
  treasurySecret: string;
  /** Domain do anchor SEP-1 (ex: "testanchor.stellar.org"). */
  anchorDomain: string;
  /**
   * Seed-raiz (64 hex) para derivar a aegis key (co-signer) por company.
   * Opcional no boot; obrigatória para co-assinar pagamentos (ADR 0007 §8).
   */
  aegisSignerRootSecret?: string;
}

export class StellarSettlementAdapter implements SettlementAdapter {
  readonly chain = ChainType.STELLAR;

  private readonly networkConfig: NetworkConfig;
  private readonly horizon: Horizon.Server;
  private readonly treasuryKeypair: Keypair;
  private readonly anchorDomain: string;
  private readonly aegisSignerRootSecret?: string;

  constructor(options: StellarSettlementAdapterOptions) {
    this.networkConfig = resolveNetwork(options.network, {
      horizonUrl: options.horizonUrl,
    });
    this.horizon = createHorizonServer(this.networkConfig);
    this.treasuryKeypair = loadTreasuryKey(options.treasurySecret).keypair;
    this.anchorDomain = options.anchorDomain;
    this.aegisSignerRootSecret = options.aegisSignerRootSecret;
  }

  get treasuryPublicKey(): string {
    return this.treasuryKeypair.publicKey();
  }

  /** Network ativa (testnet/mainnet) — para callers que precisam montar URLs/links. */
  get network(): NetworkKind {
    return this.networkConfig.kind;
  }

  // ============ Não-custodial multisig (ADR 0007) ============

  /** Deriva a keypair do co-signer do Aegis para uma company (HKDF). */
  deriveAegisSignerForCompany(companyId: string): Keypair {
    if (!this.aegisSignerRootSecret) {
      throw new Error(
        'AEGIS_SIGNER_ROOT_SECRET não configurado — necessário para derivar a aegis key e co-assinar.',
      );
    }
    return deriveAegisSigner(this.aegisSignerRootSecret, companyId);
  }

  /** Pubkey do co-signer do Aegis para uma company (para persistir na Wallet). */
  aegisSignerPubKeyForCompany(companyId: string): string {
    return this.deriveAegisSignerForCompany(companyId).publicKey();
  }

  /** True se a conta já existe on-chain (decide createOwnerAccount no setup). */
  async accountExists(address: string): Promise<boolean> {
    try {
      await this.horizon.loadAccount(address);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Monta a tx de setup multisig de uma carteira (signers + thresholds +
   * sponsoring CAP-33), já assinada pelo sponsor (conta operacional do Aegis).
   * Retorna o XDR para o **dono** assinar client-side antes de submeter.
   */
  async buildWalletSetup(params: {
    ownerAddress: string;
    createOwnerAccount: boolean;
    companyId: string;
    agentSignerPubKeys: string[];
    openUsdcTrustline: boolean;
  }): Promise<{ setupXdr: string; xlmSponsored: string; aegisSignerPubKey: string }> {
    const aegisKp = this.deriveAegisSignerForCompany(params.companyId);
    const usdcAsset = params.openUsdcTrustline
      ? await resolveAsset('USDC', this.networkConfig.kind, this.anchorDomain)
      : undefined;
    const { transaction, xlmSponsored } = await buildWalletSetupTransaction({
      horizon: this.horizon,
      network: this.networkConfig,
      sponsorKeypair: this.treasuryKeypair,
      ownerAddress: params.ownerAddress,
      createOwnerAccount: params.createOwnerAccount,
      aegisSignerPubKey: aegisKp.publicKey(),
      agentSignerPubKeys: params.agentSignerPubKeys,
      usdcAsset,
    });
    return {
      setupXdr: transaction.toXDR(),
      xlmSponsored,
      aegisSignerPubKey: aegisKp.publicKey(),
    };
  }

  /**
   * Submete uma tx já totalmente assinada (sem adicionar assinatura). Usado para
   * o setup de carteira (já vem sponsor-assinado + dono-assinado).
   */
  async submitSignedXdr(xdr: string): Promise<{ txHash: string; ledger: number }> {
    let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
    try {
      tx = TransactionBuilder.fromXDR(xdr, this.networkConfig.passphrase);
    } catch (err) {
      throw new Error(`Invalid transaction XDR: ${(err as Error).message}`);
    }
    try {
      const result = await this.horizon.submitTransaction(tx);
      return { txHash: result.hash, ledger: result.ledger };
    } catch (err) {
      throw new Error(extractHorizonError(err));
    }
  }

  /**
   * Constrói o envelope canônico de pagamento (XDR não-assinado) a partir da
   * carteira do dono. Source = `walletAddress`; o Aegis NÃO assina aqui.
   */
  async buildPaymentEnvelope(params: {
    walletAddress: string;
    destinationPublicKey: string;
    amountCents: number | bigint;
    /** Asset code do pagamento (USDC no MVP; outros via path payment é follow-up). */
    assetCode: string;
    memoHash: Uint8Array;
    timeoutSecs?: number;
  }): Promise<string> {
    const asset = await resolveAsset(params.assetCode, this.networkConfig.kind, this.anchorDomain);
    return buildPaymentEnvelope({
      horizon: this.horizon,
      network: this.networkConfig,
      walletAddress: params.walletAddress,
      destination: params.destinationPublicKey,
      asset,
      amount: centsToAssetString(params.amountCents),
      memoHash: params.memoHash,
      timeoutSecs: params.timeoutSecs,
    });
  }

  /**
   * Co-assina (com a aegis key da company) o envelope que o agente devolveu,
   * exigindo igualdade ao envelope emitido (hash), e submete on-chain.
   */
  async cosignSpendRequestEnvelope(params: {
    companyId: string;
    expectedEnvelopeXdr: string;
    signedXdr: string;
    expectedAgentSignerPubKey: string;
  }): Promise<{ txHash: string; ledger: number }> {
    const aegisKeypair = this.deriveAegisSignerForCompany(params.companyId);
    return cosignMatchingEnvelope({
      horizon: this.horizon,
      networkPassphrase: this.networkConfig.passphrase,
      aegisKeypair,
      expectedEnvelopeXdr: params.expectedEnvelopeXdr,
      signedXdr: params.signedXdr,
      expectedAgentSignerPubKey: params.expectedAgentSignerPubKey,
      // Aegis paga a fee (fee-bump) → carteira do dono não precisa de XLM.
      feeSourceKeypair: this.treasuryKeypair,
    });
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

  /**
   * Assina uma transação Stellar pré-montada (XDR base64) com a chave da
   * treasury e submete ao Horizon.
   *
   * Usado no off-ramp Etherfuse: o anchor devolve uma `burnTransaction`
   * (source = treasury, sequence já fixada no momento da order) que a
   * treasury só precisa assinar e submeter. Deve ser submetida prontamente
   * — qualquer outra tx da treasury invalidaria a sequence.
   */
  async signAndSubmitXdr(xdr: string): Promise<{ txHash: string; ledger: number }> {
    let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
    try {
      tx = TransactionBuilder.fromXDR(xdr, this.networkConfig.passphrase);
    } catch (err) {
      throw new Error(`Invalid transaction XDR: ${(err as Error).message}`);
    }
    tx.sign(this.treasuryKeypair);
    try {
      const result = await this.horizon.submitTransaction(tx);
      return { txHash: result.hash, ledger: result.ledger };
    } catch (err) {
      throw new Error(extractHorizonError(err));
    }
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
