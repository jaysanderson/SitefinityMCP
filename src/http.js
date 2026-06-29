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

import { tryServeStatic } from "./static.js";

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

    if (req.method === "GET" && (path === "/api/info" || path === "/info")) {
      const info = {
        server: "sitefinity-mcp",
        description: "MCP server for the Sitefinity CMS REST (OData) API.",
        serviceRoot: opts.serviceRoot,
        mcpEndpoint: "/mcp",
        transport: "streamable-http (stateless)",
        usage: "POST JSON-RPC 2.0 messages to /mcp",
        aiEnabled: !!opts.chat,
        ragEnabled: !!opts.rag,
      };
      return json(res, 200, info);
    }

    // Atlas — enriched content-type map with live counts (no AI required).
    if (req.method === "GET" && path === "/api/atlas") {
      if (!opts.atlas) return json(res, 503, { error: "Atlas unavailable" });
      try {
        return json(res, 200, await opts.atlas());
      } catch (err) {
        return json(res, 500, { error: err?.message || "Atlas error" });
      }
    }

    // Compose — generative experience spec from a brief (needs AI).
    if (path === "/api/compose") {
      if (req.method !== "POST") return json(res, 405, { error: "Method Not Allowed" });
      if (!opts.compose) {
        return json(res, 503, { error: "Generative composer needs ANTHROPIC_API_KEY." });
      }
      let payload;
      try {
        payload = JSON.parse((await readBody(req)) || "{}");
      } catch {
        return json(res, 400, { error: "Invalid JSON body" });
      }
      try {
        const result = await opts.compose(payload.brief);
        return json(res, 200, result);
      } catch (err) {
        const status = err?.status && err.status >= 400 && err.status < 600 ? 502 : 500;
        return json(res, status, { error: err?.message || "Composer error" });
      }
    }

    // Knowledge graph (entities + co-occurrence edges).
    if (req.method === "GET" && path === "/api/rag/graph") {
      if (!opts.rag) return json(res, 503, { error: "Agentic RAG is not configured." });
      try {
        return json(res, 200, await opts.rag.graph());
      } catch (err) {
        return json(res, 500, { error: err?.message || "Graph error" });
      }
    }

    // RAG Lab — Investigate (streamed multi-source fan-out).
    if (path === "/api/rag/investigate") {
      if (req.method !== "POST") return json(res, 405, { error: "Method Not Allowed" });
      if (!opts.rag) return json(res, 503, { error: "Agentic RAG is not configured." });
      let payload;
      try { payload = JSON.parse((await readBody(req)) || "{}"); } catch { return json(res, 400, { error: "Invalid JSON body" }); }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
      });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      try {
        const result = await opts.rag.investigate(payload.question, (stage) => send({ type: "stage", ...stage }));
        send({ type: "done", ...result });
      } catch (err) {
        send({ type: "error", error: err?.message || "Investigate error" });
      }
      return res.end();
    }

    // RAG Lab — grounded ask + semantic-vs-keyword compare.
    if (path === "/api/rag/ask" || path === "/api/rag/compare") {
      if (req.method !== "POST") return json(res, 405, { error: "Method Not Allowed" });
      if (!opts.rag) return json(res, 503, { error: "Agentic RAG is not configured." });
      let payload;
      try {
        payload = JSON.parse((await readBody(req)) || "{}");
      } catch {
        return json(res, 400, { error: "Invalid JSON body" });
      }
      try {
        const out = path.endsWith("/ask")
          ? await opts.rag.ask(payload.question)
          : await opts.rag.compare(payload.query);
        return json(res, 200, out);
      } catch (err) {
        const status = err?.status && err.status >= 400 && err.status < 600 ? 502 : 500;
        return json(res, status, { error: err?.message || "RAG error" });
      }
    }

    // AI assistant — streaming (SSE): live tool calls + token deltas.
    if (path === "/api/chat/stream") {
      if (req.method !== "POST") return json(res, 405, { error: "Method Not Allowed" });
      if (!opts.chat) return json(res, 503, { error: "AI assistant is not configured." });
      let payload;
      try {
        payload = JSON.parse((await readBody(req)) || "{}");
      } catch {
        return json(res, 400, { error: "Invalid JSON body" });
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
      });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      try {
        const result = await opts.chat(payload.messages, (evt) => send(evt), { effort: payload.fast ? "low" : "medium" });
        send({ type: "done", reply: result.text, sources: result.sources, stop: result.stop });
      } catch (err) {
        send({ type: "error", error: err?.message || "Assistant error" });
      }
      return res.end();
    }

    // AI assistant — agentic chat over the MCP tools (non-streaming fallback).
    if (path === "/api/chat") {
      if (req.method !== "POST") return json(res, 405, { error: "Method Not Allowed" });
      if (!opts.chat) {
        return json(res, 503, { error: "AI assistant is not configured. Set ANTHROPIC_API_KEY." });
      }
      let payload;
      try {
        payload = JSON.parse(await readBody(req) || "{}");
      } catch {
        return json(res, 400, { error: "Invalid JSON body" });
      }
      try {
        const result = await opts.chat(payload.messages);
        return json(res, 200, { reply: result.text, trace: result.trace, stop: result.stop, sources: result.sources || [] });
      } catch (err) {
        const status = err?.status && err.status >= 400 && err.status < 600 ? 502 : 500;
        return json(res, status, { error: err?.message || "Assistant error" });
      }
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

    // Everything else: serve the bundled web UI from public/.
    if (req.method === "GET" || req.method === "HEAD") {
      const asset = await tryServeStatic(path);
      if (asset) {
        res.writeHead(asset.status, asset.headers);
        return res.end(req.method === "HEAD" ? undefined : asset.body);
      }
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
