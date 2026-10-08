// CLI wrapper around the same refresh the dashboard button uses
// (server/src/catalog-refresh.ts), so both paths validate identically.
import { refreshAppCatalog, defaultCatalogPathForCli } from "../dist/src/catalog-refresh.js";

const { entries, fetchedAt } = await refreshAppCatalog();
console.log(`Saved ${entries} local app mappings to ${defaultCatalogPathForCli()} at ${fetchedAt}`);
