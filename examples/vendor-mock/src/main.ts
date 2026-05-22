import { buildServer } from './server.js';

const PORT = Number(process.env.VENDOR_MOCK_PORT ?? '4001');
const PRICE_CENTS = Number(process.env.VENDOR_MOCK_RESOURCE_PRICE_CENTS ?? '5');
const ASSET = process.env.VENDOR_MOCK_RESOURCE_ASSET ?? 'USDC';

const app = buildServer({ priceCents: PRICE_CENTS, asset: ASSET, logger: true });

app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Vendor mock listening on ${address}`);
  console.log(`  GET /resource → 402 (price: ${PRICE_CENTS} cents ${ASSET})`);
  console.log(`  GET /resource + X-Payment-Proof: <64-hex> → 200`);
});
