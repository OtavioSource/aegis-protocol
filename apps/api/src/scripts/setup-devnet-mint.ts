/**
 * One-time setup: create a persistent demo token mint on devnet.
 * Run this ONCE and save the output to your .env file.
 *
 * Usage: pnpm tsx src/scripts/setup-devnet-mint.ts
 */
import { generateMintAuthority, fundTreasuryForDemo } from '@aegis/solana';

const authority = generateMintAuthority();
console.log('🔑 Mint Authority generated:');
console.log('   Public Key:', authority.publicKey);
console.log('   Secret (base64):', authority.secretBase64);
console.log('');
console.log('Creating mint and getting initial funding...');

// Create the mint by funding with 0 tokens (just to establish the mint)
const result = await fundTreasuryForDemo({
  // Use authority as treasury temporarily just to create the mint
  treasuryWalletAddress: authority.publicKey,
  treasuryEncryptedSecret: authority.secretBase64,
  amount: 0,
  mintAuthoritySecret: authority.secretBase64,
});

console.log('');
console.log('✅ Demo mint created!');
console.log('   Mint Address:', result.mintAddress);
console.log('');
console.log('Add these to your .env:');
console.log(`DEVNET_DEMO_MINT_ADDRESS=${result.mintAddress}`);
console.log(`DEVNET_DEMO_MINT_AUTHORITY_SECRET=${authority.secretBase64}`);
console.log('');
console.log('Solana Explorer:');
console.log(`  https://explorer.solana.com/address/${result.mintAddress}?cluster=devnet`);
