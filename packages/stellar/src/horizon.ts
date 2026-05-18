/**
 * Singleton do Horizon Server.
 *
 * Stellar SDK guarda HTTP client interno; reuso da instância evita
 * reconectar a cada request.
 */

import { Horizon } from '@stellar/stellar-sdk';

import type { NetworkConfig } from './network.js';

export function createHorizonServer(network: NetworkConfig): Horizon.Server {
  return new Horizon.Server(network.horizonUrl);
}
