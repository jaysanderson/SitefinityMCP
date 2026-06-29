/**
 * Transport-agnostic MCP (JSON-RPC 2.0) request handler.
 *
 * Implements the subset of the Model Context Protocol needed for a tools-only
 * server: initialize, tools/list, tools/call, ping. No SDK — just JSON-RPC.
 */

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "sitefinity-mcp", version: "1.0.0" };

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message, data) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message, ...(data !== undefined ? { data } : {}) },
});

// Standard JSON-RPC error codes.
const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INTERNAL = -32603;

export class McpHandler {
  /** @param {{tools: Array, call: Function}} toolset */
  constructor(toolset) {
    this.toolset = toolset;
  }

  /**
   * Handle one parsed JSON-RPC message.
   * @returns a JSON-RPC response object, or null for notifications (no reply).
   */
  async handleMessage(msg) {
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return rpcError(msg?.id, ERR_INVALID_REQUEST, "Invalid JSON-RPC request");
    }

    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    try {
      switch (method) {
        case "initialize":
          return rpcResult(id, {
            protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
          });

        case "notifications/initialized":
        case "notifications/cancelled":
          return null; // notifications: no response

        case "ping":
          return rpcResult(id, {});

        case "tools/list":
          return rpcResult(id, { tools: this.toolset.tools });

        case "tools/call": {
          const name = params?.name;
          const args = params?.arguments || {};
          if (!name) return rpcError(id, ERR_INVALID_REQUEST, "Missing tool name");
          const result = await this.toolset.call(name, args);
          return rpcResult(id, result);
        }

        default:
          if (isNotification) return null;
          return rpcError(id, ERR_METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (err) {
      if (isNotification) return null;
      return rpcError(id, ERR_INTERNAL, err?.message || "Internal error");
    }
  }

  /** Handle a raw request body (string). Supports single + batch messages. */
  async handleRaw(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: 200, body: rpcError(null, ERR_PARSE, "Parse error") };
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return { status: 200, body: rpcError(null, ERR_INVALID_REQUEST, "Empty batch") };
      }
      const responses = [];
      for (const m of parsed) {
        const r = await this.handleMessage(m);
        if (r !== null) responses.push(r);
      }
      // All-notifications batch → 202 with no body.
      return responses.length ? { status: 200, body: responses } : { status: 202, body: null };
    }

    const r = await this.handleMessage(parsed);
    return r === null ? { status: 202, body: null } : { status: 200, body: r };
  }
}

export { PROTOCOL_VERSION, SERVER_INFO };
