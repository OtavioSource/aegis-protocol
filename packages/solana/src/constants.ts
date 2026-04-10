import { PublicKey } from '@solana/web3.js';

// Devnet USDC mint (Circle's official devnet USDC)
export const DevnetUsdcMint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

export const DEVNET_RPC_URL = process.env['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com';

export const SOLANA_EXPLORER_BASE = 'https://explorer.solana.com';

export function explorerTxUrl(signature: string, cluster: 'devnet' | 'mainnet-beta' = 'devnet'): string {
  return `${SOLANA_EXPLORER_BASE}/tx/${signature}?cluster=${cluster}`;
}

export function explorerAddressUrl(address: string, cluster: 'devnet' | 'mainnet-beta' = 'devnet'): string {
  return `${SOLANA_EXPLORER_BASE}/address/${address}?cluster=${cluster}`;
}
