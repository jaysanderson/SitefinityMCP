#!/usr/bin/env node
/**
 * Diagnostic probe (run on the host with the secrets):
 *   fly ssh console -a sitefinity-mcp-eftm2 -C "node src/probe.js"
 * Discovers which ARAG capabilities the configured key/KB expose.
 */
import { loadConfig } from "./config.js";

const c = loadConfig();
const base = `https://${c.aragRegion}.rag.progress.cloud/api/v1/kb/${c.aragKbId}`;
const H = { "X-NUCLIA-SERVICEACCOUNT": `Bearer ${c.aragKey}`, "content-type": "application/json", accept: "application/json" };

async function probe(label, method, path, body) {
  try {
    const r = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    console.log(`\n## ${label}  ${method} ${path}  -> ${r.status}`);
    console.log(t.slice(0, 700));
  } catch (e) {
    console.log(`\n## ${label}  ERROR ${e.message}`);
  }
}

await probe("graph nodes", "POST", "/graph/nodes", { query: { prop: "node" }, top_k: 30 });
await probe("graph paths", "POST", "/graph", { query: { prop: "path" }, top_k: 20 });
await probe("entities (legacy)", "GET", "/entitiesgroups");
console.log("\n--- done ---");
