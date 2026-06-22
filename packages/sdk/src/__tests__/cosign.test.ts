import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-base';
import { describe, expect, it, vi } from 'vitest';

import { AegisClient } from '../client.js';
import { signEnvelope } from '../signer.js';

const API_KEY = 'cr_test_AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BASE_URL = 'https://aegis-test.example';
const PASSPHRASE = Networks.TESTNET;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Monta um envelope de pagamento não-assinado (como o Aegis emitiria). */
function buildEnvelope(source: string, destination: string): string {
  const account = new Account(source, '0');
  const tx = new TransactionBuilder(account, {
    fee: '200',
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '1' }))
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

describe('fluxo two-phase (cosign)', () => {
  it('pay() assina o envelope e co-assina automaticamente quando há agentSignerSecret', async () => {
    const agent = Keypair.random();
    const source = Keypair.random().publicKey();
    const destination = Keypair.random().publicKey();
    const envelopeXdr = buildEnvelope(source, destination);

    let cosignBody: { signedXdr?: string } | null = null;
    let cosignUrl = '';

    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/spend-requests')) {
        return json(201, {
          id: 'sr-1',
          status: 'AWAITING_AGENT_SIGNATURE',
          decision: 'APPROVED',
          envelopeXdr,
          networkPassphrase: PASSPHRASE,
          txHash: null,
        });
      }
      // /cosign
      cosignUrl = url;
      cosignBody = JSON.parse(String(init?.body)) as { signedXdr?: string };
      return json(200, {
        id: 'sr-1',
        status: 'EXECUTED',
        decision: 'APPROVED',
        txHash: 'abc123',
      });
    });

    const client = new AegisClient({
      apiKey: API_KEY,
      agentSignerSecret: agent.secret(),
      baseUrl: BASE_URL,
      fetch: mockFetch as unknown as typeof fetch,
    });

    const result = await client.pay({
      vendorId: 'v1',
      amountCents: 100,
      asset: 'USDC',
      actionType: 'api-call',
    });

    // Chamou /cosign e retornou EXECUTED
    expect(cosignUrl).toContain('/spend-requests/sr-1/cosign');
    expect(result.status).toBe('EXECUTED');
    expect(result.txHash).toBe('abc123');

    // O signedXdr enviado contém a assinatura válida do agente
    expect(cosignBody?.signedXdr).toBeTruthy();
    const signed = TransactionBuilder.fromXDR(cosignBody!.signedXdr!, PASSPHRASE);
    const hash = signed.hash();
    const hasAgentSig = signed.signatures.some((s) => {
      try {
        return agent.verify(hash, s.signature());
      } catch {
        return false;
      }
    });
    expect(hasAgentSig).toBe(true);
  });

  it('pay() retorna AWAITING_AGENT_SIGNATURE quando não há agentSignerSecret', async () => {
    const envelopeXdr = buildEnvelope(Keypair.random().publicKey(), Keypair.random().publicKey());
    const mockFetch = vi.fn(async () =>
      json(201, {
        id: 'sr-2',
        status: 'AWAITING_AGENT_SIGNATURE',
        decision: 'APPROVED',
        envelopeXdr,
        networkPassphrase: PASSPHRASE,
      }),
    );
    const client = new AegisClient({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: mockFetch as unknown as typeof fetch,
    });
    const result = await client.pay({
      vendorId: 'v1',
      amountCents: 100,
      asset: 'USDC',
      actionType: 'api-call',
    });
    expect(result.status).toBe('AWAITING_AGENT_SIGNATURE');
    expect(mockFetch).toHaveBeenCalledTimes(1); // não chamou /cosign
  });

  it('signEnvelope produz um XDR com a assinatura do agente', () => {
    const agent = Keypair.random();
    const envelopeXdr = buildEnvelope(Keypair.random().publicKey(), Keypair.random().publicKey());
    const signedXdr = signEnvelope(envelopeXdr, PASSPHRASE, agent.secret());
    const signed = TransactionBuilder.fromXDR(signedXdr, PASSPHRASE);
    expect(signed.signatures.length).toBe(1);
    expect(agent.verify(signed.hash(), signed.signatures[0]!.signature())).toBe(true);
  });
});
