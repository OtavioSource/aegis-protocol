import { buildServer } from './server.js';

const PORT = Number(process.env.VENDOR_MOCK_PORT ?? '4001');
const VENDOR_WALLET_PUBLIC_KEY = process.env.VENDOR_WALLET_PUBLIC_KEY ?? '';
const AEGIS_FACILITATOR_URL = process.env.AEGIS_FACILITATOR_URL ?? 'http://localhost:4000';
const ASSET_IDENTIFIER =
  process.env.VENDOR_MOCK_ASSET_IDENTIFIER ??
  'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const PRICE_CENTS = Number(process.env.VENDOR_MOCK_RESOURCE_PRICE_CENTS ?? '5');

const app = buildServer({
  vendorWalletPublicKey: VENDOR_WALLET_PUBLIC_KEY,
  facilitatorUrl: AEGIS_FACILITATOR_URL,
  assetIdentifier: ASSET_IDENTIFIER,
  priceCents: PRICE_CENTS,
  logger: true,
});

app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Vendor mock listening on ${address}`);
  console.log(`  GET /resource → 402 (x402-compliant, payTo: ${VENDOR_WALLET_PUBLIC_KEY})`);
  console.log(`  GET /resource + X-PAYMENT: <signed> → verify via ${AEGIS_FACILITATOR_URL}`);
});
