/** CLI entrypoint: apply database migrations. Usage: `npm run migrate`. */
import { runMigrations } from '../src/db/migrate';

await runMigrations();
process.exit(0);
