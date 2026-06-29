#!/usr/bin/env node
/**
 * Sitefinity MCP server — entry point.
 *
 * Read/query tools for the Sitefinity CMS REST (OData) Web Services API,
 * generated from the live service $metadata. Zero npm dependencies.
 *
 * Transport is selected via MCP_TRANSPORT: "http" (default, for hosting) or
 * "stdio" (for local MCP clients).
 */

import { loadConfig } from "./config.js";
import { SitefinityClient } from "./sitefinity.js";
import { buildTools } from "./tools.js";
import { McpHandler } from "./mcp.js";
import { startHttpServer } from "./http.js";
import { startStdioServer } from "./stdio.js";
import { createChatHandler } from "./chat.js";

async function main() {
  const config = loadConfig();
  const client = new SitefinityClient(config);

  // Generate the tool surface from the live API (falls back gracefully if the
  // service is briefly unreachable at startup).
  const toolset = await buildTools(client);
  const handler = new McpHandler(toolset);

  const chat = config.apiKey ? createChatHandler(toolset, config) : null;

  console.error(
    `[sitefinity-mcp] generated ${toolset.tools.length} tools; ` +
      `discovered content types from ${client.serviceRoot} (auth: ${config.authMode}; ` +
      `AI assistant: ${chat ? "enabled (" + config.model + ")" : "disabled"}).`
  );

  if (config.transport === "stdio") {
    startStdioServer(handler);
  } else {
    startHttpServer(handler, {
      host: config.host,
      port: config.port,
      serviceRoot: client.serviceRoot,
      chat,
    });
  }
}

main().catch((err) => {
  console.error("[sitefinity-mcp] fatal:", err?.message || err);
  process.exit(1);
});
