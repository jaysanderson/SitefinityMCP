/**
 * MCP Streamable HTTP transport (stateless) using only Node's built-in http.
 *
 * Endpoints:
 *   POST /mcp     — JSON-RPC request(s); responds with application/json.
 *   GET  /mcp     — 405 (this server does not push server-initiated SSE).
 *   GET  /health  — liveness probe (used by Fly health checks).
 *   GET  /        — human-readable info page.
 *
 * Stateless: no Mcp-Session-Id is required, so any MCP HTTP client can connect.
 */

import http from "node:http";

const MAX_BODY = 5 * 1024 * 1024; // 5 MB

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, obj) {
  const body = obj === null ? "" : JSON.stringify(obj);
  send(
    res,
    status,
    {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Authorization, Accept",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
    body
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Start the HTTP server.
 * @param {import('./mcp.js').McpHandler} handler
 * @param {{host:string, port:number, serviceRoot:string}} opts
 */
export function startHttpServer(handler, opts) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return json(res, 204, null);
    }

    if (req.method === "GET" && (path === "/health" || path === "/healthz")) {
      return json(res, 200, { status: "ok", server: "sitefinity-mcp" });
    }

    if (req.method === "GET" && path === "/") {
      const info = {
        server: "sitefinity-mcp",
        description: "MCP server for the Sitefinity CMS REST (OData) API.",
        serviceRoot: opts.serviceRoot,
        mcpEndpoint: "/mcp",
        transport: "streamable-http (stateless)",
        usage: "POST JSON-RPC 2.0 messages to /mcp",
      };
      return json(res, 200, info);
    }

    if (path === "/mcp") {
      if (req.method === "GET") {
        // No server-initiated stream in stateless mode.
        return json(res, 405, { error: "Method Not Allowed. Use POST for JSON-RPC." });
      }
      if (req.method !== "POST") {
        return json(res, 405, { error: "Method Not Allowed" });
      }
      let text;
      try {
        text = await readBody(req);
      } catch (err) {
        return json(res, 413, { error: err.message });
      }
      const { status, body } = await handler.handleRaw(text);
      return json(res, status, body);
    }

    return json(res, 404, { error: "Not found" });
  });

  server.listen(opts.port, opts.host, () => {
    console.error(
      `[sitefinity-mcp] HTTP transport listening on http://${opts.host}:${opts.port}/mcp ` +
        `(service root: ${opts.serviceRoot})`
    );
  });

  return server;
}
