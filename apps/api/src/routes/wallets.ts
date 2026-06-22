/**
 * Rotas de Wallet (carteira não-custodial multisig — ADR 0007).
 *
 * Onboarding em 3 passos:
 *   1. POST /v1/wallets            — cria a carteira (PROVISIONING) + deriva a
 *                                    aegis key da company. O dono fornece a
 *                                    master pubkey (gerada client-side no modo
 *                                    GENERATED, ou trazida no modo EXTERNAL).
 *   2. POST /v1/wallets/:id/setup  — monta a tx de setup (signers + thresholds
 *                                    + sponsoring), já assinada pelo sponsor.
 *                                    Devolve o XDR para o DONO assinar.
 *   3. POST /v1/wallets/:id/setup/submit — recebe o XDR assinado pelo dono e
 *                                    submete on-chain → carteira ACTIVE.
 *
 * GET /v1/wallets, GET /v1/wallets/:id — listagem/detalhe.
 */

import { AgentStatus, WalletStatus } from '@prisma/client';
import { OwnerKeyMode } from '@aegis/shared';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';

/** Pubkey Stellar (Ed25519, StrKey "G..." base32, 56 chars). */
const STELLAR_PUBKEY = /^G[A-Z2-7]{55}$/;

const CreateWalletBody = z.object({
  label: z.string().min(1).max(120),
  ownerKeyMode: z.nativeEnum(OwnerKeyMode),
  /** Master pubkey do dono (= endereço da conta). Secret nunca é enviada. */
  address: z.string().regex(STELLAR_PUBKEY, 'address deve ser uma pubkey Stellar (G... 56 chars)'),
});

const SetupBody = z.object({
  /** Abrir trustline USDC no setup (default true). */
  openUsdcTrustline: z.boolean().default(true),
});

const SubmitBody = z.object({
  signedXdr: z.string().min(1),
});

function publicWallet(w: {
  id: string;
  label: string;
  network: string;
  address: string;
  ownerKeyMode: string;
  aegisSignerPubKey: string;
  status: string;
  setupTxHash: string | null;
  createdAt: Date;
}) {
  return {
    id: w.id,
    label: w.label,
    network: w.network,
    address: w.address,
    ownerKeyMode: w.ownerKeyMode,
    aegisSignerPubKey: w.aegisSignerPubKey,
    status: w.status,
    setupTxHash: w.setupTxHash,
    createdAt: w.createdAt,
  };
}

const walletsRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ----- CREATE -----
  app.post('/v1/wallets', async (request, reply) => {
    const { companyId } = request.requireAuth();
    const body = CreateWalletBody.parse(request.body);

    // Deriva a aegis key (co-signer) da company — só a pubkey é persistida.
    const aegisSignerPubKey = app.stellar.aegisSignerPubKeyForCompany(companyId);

    const existing = await app.prisma.wallet.findFirst({
      where: { companyId, address: body.address },
    });
    if (existing) {
      throw new ConflictError(`Já existe uma carteira com este endereço nesta company.`);
    }

    const created = await app.prisma.wallet.create({
      data: {
        companyId,
        label: body.label,
        address: body.address,
        ownerKeyMode: body.ownerKeyMode,
        aegisSignerPubKey,
        status: WalletStatus.PROVISIONING,
      },
    });
    reply.code(201);
    return publicWallet(created);
  });

  // ----- LIST -----
  app.get('/v1/wallets', async (request) => {
    const { companyId } = request.requireAuth();
    const wallets = await app.prisma.wallet.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return { data: wallets.map(publicWallet) };
  });

  // ----- GET BY ID -----
  app.get<{ Params: { id: string } }>('/v1/wallets/:id', async (request) => {
    const { companyId } = request.requireAuth();
    const found = await app.prisma.wallet.findFirst({
      where: { id: request.params.id, companyId },
    });
    if (!found) throw new NotFoundError(`Wallet ${request.params.id} not found`);
    return publicWallet(found);
  });

  // ----- SETUP (monta a tx de setup; dono assina depois) -----
  app.post<{ Params: { id: string } }>('/v1/wallets/:id/setup', async (request) => {
    const { companyId } = request.requireAuth();
    const body = SetupBody.parse(request.body ?? {});

    const wallet = await app.prisma.wallet.findFirst({
      where: { id: request.params.id, companyId },
    });
    if (!wallet) throw new NotFoundError(`Wallet ${request.params.id} not found`);
    if (wallet.status === WalletStatus.ACTIVE) {
      throw new ConflictError(`Wallet ${wallet.id} já está ACTIVE.`);
    }

    // Agentes ativos atribuídos a esta carteira, com chave de assinatura.
    const agents = await app.prisma.agent.findMany({
      where: { companyId, walletId: wallet.id, status: AgentStatus.ACTIVE },
    });
    const agentSignerPubKeys = agents
      .map((a) => a.signerPubKey)
      .filter((k): k is string => !!k);
    if (agentSignerPubKeys.length === 0) {
      throw new ValidationError(
        'Atribua ao menos um agente (com signerPubKey) a esta carteira antes do setup.',
      );
    }

    // Conta nova (modo GENERATED) ou já existente (EXTERNAL) → decide on-chain.
    const exists = await app.stellar.accountExists(wallet.address);

    const { setupXdr, xlmSponsored } = await app.stellar.buildWalletSetup({
      ownerAddress: wallet.address,
      createOwnerAccount: !exists,
      companyId,
      agentSignerPubKeys,
      openUsdcTrustline: body.openUsdcTrustline,
    });

    return {
      walletId: wallet.id,
      setupXdr,
      xlmSponsored,
      createOwnerAccount: !exists,
      signers: agentSignerPubKeys.length + 1, // agentes + aegis (master já existe)
    };
  });

  // ----- SETUP SUBMIT (dono assinou; submete on-chain) -----
  app.post<{ Params: { id: string } }>(
    '/v1/wallets/:id/setup/submit',
    async (request) => {
      const { companyId } = request.requireAuth();
      const body = SubmitBody.parse(request.body);

      const wallet = await app.prisma.wallet.findFirst({
        where: { id: request.params.id, companyId },
      });
      if (!wallet) throw new NotFoundError(`Wallet ${request.params.id} not found`);
      if (wallet.status === WalletStatus.ACTIVE) {
        throw new ConflictError(`Wallet ${wallet.id} já está ACTIVE.`);
      }

      const { txHash } = await app.stellar.submitSignedXdr(body.signedXdr);

      const updated = await app.prisma.wallet.update({
        where: { id: wallet.id },
        data: { status: WalletStatus.ACTIVE, setupTxHash: txHash },
      });
      return publicWallet(updated);
    },
  );
};

export default walletsRoute;
