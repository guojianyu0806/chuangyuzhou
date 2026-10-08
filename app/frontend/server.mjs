// This working copy uses the competition backend. Never start the personal
// workbench's 4173 static server or accept its HOST/PORT/DATA_DIR environment.
await import(new URL('../start.mjs', import.meta.url).href);
