// Compatibility entry for the copied page. The root entry owns localhost,
// the dedicated port, cookie and runtime directory for this independent copy.
await import(new URL('../start.mjs', import.meta.url).href);
