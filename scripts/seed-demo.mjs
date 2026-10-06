import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { StoreDatabase } from '../database.mjs';
import { migrateDatabase } from './migrate.mjs';

if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_SEED !== '1') {
  throw new Error('Demo seeding is disabled. Set ALLOW_DEMO_SEED=1 in a non-production environment to continue.');
}
if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
  throw new Error('Demo seeding only supports the local SQLite database; refusing to write demo products to PostgreSQL.');
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const databasePath = resolve(process.env.DATABASE_PATH || `${root}/data/store.sqlite`);
if (!existsSync(databasePath)) {
  throw new Error('Store database not found. Start the app once to initialize its schema, then seed demo data.');
}

const db = new StoreDatabase({ dialect: 'sqlite', sqlite: new DatabaseSync(databasePath) });
try {
  if (!await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'products'").get()) {
    throw new Error('Products table not found. Start the app once to initialize its schema, then seed demo data.');
  }
  await migrateDatabase(db);

  const carpetImage = 'https://images.unsplash.com/photo-1600166898405-da9535204843?auto=format&fit=crop&w=1000&q=85';
  const samples = [
    ['[DEMO] Saffron Stripe Dhurrie', 'Dhurrie', 'Cotton', 'Saffron / ivory', '4 × 6 ft', 3490, 5],
    ['[DEMO] Monsoon Garden Flatweave', 'Flatweave', 'Cotton blend', 'Indigo / moss', '5 × 7 ft', 5290, 3],
    ['[DEMO] Sandstone Geo Kilim', 'Kilim', 'Wool blend', 'Terracotta / sand', '5 × 8 ft', 7890, 4],
    ['[DEMO] Neem Leaf Handloom', 'Handloom', 'Cotton', 'Leaf green / cream', '4 × 6 ft', 3890, 6],
    ['[DEMO] Gulmohar Medallion', 'Traditional', 'Wool blend', 'Rust / rose', '6 × 9 ft', 11990, 2],
    ['[DEMO] Riverstone Line Runner', 'Runner', 'Cotton', 'Stone / charcoal', '2.5 × 8 ft', 3190, 7],
    ['[DEMO] Jamun Night Flatweave', 'Flatweave', 'Cotton blend', 'Plum / indigo', '5 × 7 ft', 6490, 3],
    ['[DEMO] Marigold Grid Dhurrie', 'Dhurrie', 'Cotton', 'Marigold / ivory', '4 × 6 ft', 3690, 5],
    ['[DEMO] Charbagh Garden Rug', 'Traditional', 'Wool blend', 'Forest / brick', '6 × 9 ft', 12990, 2],
    ['[DEMO] Kashi Blockprint Runner', 'Runner', 'Cotton', 'Blue / natural', '2.5 × 8 ft', 2890, 8],
    ['[DEMO] Clay Court Flatweave', 'Flatweave', 'Jute blend', 'Clay / oat', '5 × 7 ft', 5790, 3],
    ['[DEMO] Gulabi Phool Dhurrie', 'Dhurrie', 'Cotton', 'Pink / cream', '4 × 6 ft', 3990, 4],
    ['[DEMO] Pebble Path Kilim', 'Kilim', 'Wool blend', 'Olive / pebble', '5 × 8 ft', 8190, 3],
    ['[DEMO] Indigo Courtyard Rug', 'Traditional', 'Wool blend', 'Indigo / ochre', '6 × 9 ft', 13990, 2],
    ['[DEMO] Bela Blossom Flatweave', 'Flatweave', 'Cotton', 'Ivory / sage', '5 × 7 ft', 5490, 5],
    ['[DEMO] Sunset Steps Runner', 'Runner', 'Cotton blend', 'Coral / sand', '2.5 × 8 ft', 3390, 6],
    ['[DEMO] Bagh-e-Banaras Kilim', 'Kilim', 'Wool blend', 'Moss / saffron', '5 × 8 ft', 8990, 3],
    ['[DEMO] Chanderi Check Dhurrie', 'Dhurrie', 'Cotton', 'Blue / ivory', '4 × 6 ft', 3590, 7],
    ['[DEMO] Terracotta Arch Rug', 'Contemporary', 'Wool blend', 'Terracotta / cream', '6 × 9 ft', 10990, 2],
    ['[DEMO] Morning Neem Runner', 'Runner', 'Cotton', 'Sage / natural', '2.5 × 8 ft', 3090, 5],
    ['[DEMO] Peeli Kiran Flatweave', 'Flatweave', 'Cotton', 'Yellow / cream', '5 × 7 ft', 4990, 4],
    ['[DEMO] Dusk Petal Kilim', 'Kilim', 'Wool blend', 'Plum / rust', '5 × 8 ft', 8590, 3],
    ['[DEMO] Nadi Kinara Dhurrie', 'Dhurrie', 'Cotton', 'Blue / natural', '4 × 6 ft', 3790, 6],
    ['[DEMO] Little Monsoon Play Rug', 'Kids', 'Cotton blend', 'Teal / coral', '4 × 6 ft', 4290, 4]
  ];
  let added = 0;
  await db.transaction(async (transaction) => {
    const insert = transaction.prepare(`INSERT INTO products
      (name, description, category, material, color, size, price, stock, image_url, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
    const find = transaction.prepare('SELECT id FROM products WHERE name = ? AND is_demo = 1');
    for (const [name, category, material, color, size, price, stock] of samples) {
      if (await find.get(name)) continue;
      await insert.run(name, 'Development sample only. Not for sale. Replace with verified item details before launch.', category, material, color, size, price, stock, carpetImage);
      added += 1;
    }
    await transaction.prepare("UPDATE products SET image_url = ? WHERE is_demo = 1 AND name LIKE '[DEMO] %'").run(carpetImage);
  });
  console.log(`${added} demo carpets added; ${samples.length} clearly labeled demo items are available in development.`);
} finally {
  await db.close();
}