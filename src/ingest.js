#!/usr/bin/env node
/**
 * One-shot ingestion: pull text content from the live Sitefinity site (via the
 * same client the MCP server uses) and index it into the Progress Agentic RAG
 * Knowledge Box as text resources.
 *
 * Run it on the host that holds the secrets (so the key never leaves the box):
 *   fly ssh console -a sitefinity-mcp-eftm2 -C "node src/ingest.js"
 *
 * Requires env: ARAG_API_KEY, ARAG_KB_ID, ARAG_REGION (+ SITEFINITY_BASE_URL).
 */

import { loadConfig } from "./config.js";
import { SitefinityClient } from "./sitefinity.js";
import { AragClient } from "./arag.js";

// Content types worth indexing (text-bearing). Missing types are skipped.
const TYPES = [
  "newsitems", "blogposts", "events", "listitems", "corporatefooditems",
  "testimonials", "people", "productservices", "locations", "rates", "sliders",
];

const SKIP_FIELDS = new Set([
  "Id", "UrlName", "ItemDefaultUrl", "Provider", "SystemSourceKey", "IncludeInSitemap",
  "AllowComments", "LastModified", "DateCreated", "OpenGraphTitle", "OpenGraphDescription",
  "MetaTitle", "MetaDescription",
]);

const strip = (s) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

function buildBody(item) {
  const lines = [];
  for (const [k, v] of Object.entries(item)) {
    if (k.startsWith("@") || SKIP_FIELDS.has(k)) continue;
    if (typeof v !== "string" || !v.trim()) continue;
    const text = strip(v);
    if (text) lines.push(`${k}: ${text}`);
  }
  return lines.join("\n\n");
}

async function main() {
  const config = loadConfig();
  if (!config.aragKey || !config.aragKbId) {
    console.error("Missing ARAG_API_KEY or ARAG_KB_ID — nothing to ingest into.");
    process.exit(1);
  }
  const sf = new SitefinityClient(config);
  const arag = new AragClient({ apiKey: config.aragKey, region: config.aragRegion, kbId: config.aragKbId });

  console.log(`Ingesting Sitefinity content into ARAG KB ${config.aragKbId} (${config.aragRegion})\n`);
  let total = 0, errors = 0;

  for (const type of TYPES) {
    let data;
    try {
      data = await sf.get(type, { top: 100, orderby: ["LastModified desc"] });
    } catch (e) {
      console.log(`· ${type}: skipped (${e.message})`);
      continue;
    }
    const items = Array.isArray(data?.value) ? data.value : [];
    if (!items.length) { console.log(`· ${type}: 0 items`); continue; }

    let n = 0;
    for (const item of items) {
      const id = item.Id;
      const title = strip(item.Title || item.Name || item.UrlName || id || type);
      const body = buildBody(item);
      if (!body) continue;
      const slug = `${type}-${id}`;
      const origin = item.ItemDefaultUrl ? { url: config.baseUrl + item.ItemDefaultUrl } : undefined;
      try {
        await arag.ingestText({
          slug,
          title,
          body,
          format: "PLAIN",
          metadata: { classifications: [{ labelset: "content_type", label: type }] },
          origin,
        });
        n++; total++;
      } catch (e) {
        if (e.status === 409) { n++; continue; } // already exists — fine
        errors++;
        if (errors <= 5) console.log(`  ! ${slug}: ${e.message}`);
      }
    }
    console.log(`· ${type}: ${n}/${items.length} ingested`);
  }

  console.log(`\nDone. ${total} resources ingested${errors ? `, ${errors} errors` : ""}. ` +
    `NucliaDB will process & embed them in the background (status pending → processed).`);
}

main().catch((e) => { console.error("Ingestion failed:", e?.message || e); process.exit(1); });
