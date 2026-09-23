/* Re-run migrations + seed (idempotent). Usage: npm run seed */
require('./db');
console.log('[movixa] Database ready.');
process.exit(0);
