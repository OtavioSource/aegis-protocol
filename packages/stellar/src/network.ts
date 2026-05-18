/**
 * Configuração de network para Stellar (testnet/mainnet).
 *
 * Resolve URLs do Horizon e Soroban RPC + Network Passphrase a partir
 * da env. Tudo carregado uma única vez no boot.
 */

import { Networks } from '@stellar/stellar-sdk';

export type NetworkKind = 'testnet' | 'mainnet';

export interface NetworkConfig {
  kind: NetworkKind;
  horizonUrl: string;
  sorobanRpcUrl: string;
  passphrase: string;
  stellarExpertBase: string;
  friendbotUrl?: string;
}

export function resolveNetwork(
  kind: NetworkKind,
  overrides?: Partial<Omit<NetworkConfig, 'kind' | 'passphrase'>>,
): NetworkConfig {
  if (kind === 'mainnet') {
    return {
      kind,
      horizonUrl: overrides?.horizonUrl ?? 'https://horizon.stellar.org',
      sorobanRpcUrl:
        overrides?.sorobanRpcUrl ?? 'https://soroban-rpc.mainnet.stellar.gateway.fm',
      passphrase: Networks.PUBLIC,
      stellarExpertBase: 'https://stellar.expert/explorer/public',
    };
  }

  return {
    kind,
    horizonUrl: overrides?.horizonUrl ?? 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: overrides?.sorobanRpcUrl ?? 'https://soroban-testnet.stellar.org',
    passphrase: Networks.TESTNET,
    stellarExpertBase: 'https://stellar.expert/explorer/testnet',
    friendbotUrl: 'https://friendbot.stellar.org',
  };
}
