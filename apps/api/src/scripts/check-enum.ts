import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const r = (await p.$queryRawUnsafe(
  `SELECT enumlabel FROM pg_enum WHERE enumtypid = '"EventType"'::regtype ORDER BY enumsortorder`,
)) as { enumlabel: string }[];
console.log('EventType values no Neon:');
r.forEach((x) => console.log('  -', x.enumlabel));
const hasNew = r.some((x) => x.enumlabel === 'PAYMENT_FAILED');
console.log(hasNew ? '\n✓ PAYMENT_FAILED presente' : '\n✗ PAYMENT_FAILED AUSENTE');
await p.$disconnect();
