/**
 * MCP stdio transport — newline-delimited JSON-RPC over stdin/stdout.
 *
 * Lets the same server run as a local MCP server (e.g. for Claude Desktop)
 * with no network exposure. stdout carries protocol; logs go to stderr.
 */

export function startStdioServer(handler) {
  let buffer = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) void handleLine(line);
    }
  });

  process.stdin.on("end", () => process.exit(0));

  async function handleLine(line) {
    const { body } = await handler.handleRaw(line);
    if (body !== null && body !== undefined) {
      process.stdout.write(JSON.stringify(body) + "\n");
    }
  }

  console.error("[sitefinity-mcp] stdio transport ready.");
}
