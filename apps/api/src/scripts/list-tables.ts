import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' ORDER BY table_name
  `;
  console.log('\nTabelas em "public" no Neon:');
  for (const t of tables) console.log('  -', t.table_name);
  console.log('\nTotal:', tables.length);

  const enums = await prisma.$queryRaw<Array<{ typname: string }>>`
    SELECT typname FROM pg_type
    WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace
    ORDER BY typname
  `;
  console.log('\nEnums em "public":');
  for (const e of enums) console.log('  -', e.typname);
  console.log('\nTotal:', enums.length);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
