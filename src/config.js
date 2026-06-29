/**
 * Runtime configuration, sourced from environment variables.
 *
 * Only SITEFINITY_BASE_URL has a hard default (the EFTM2 demo instance) so the
 * server is runnable out of the box. Everything else matches a stock Sitefinity
 * install (service name "default", anonymous read access).
 */

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function loadConfig(env = process.env) {
  const baseUrl =
    env.SITEFINITY_BASE_URL?.trim() || "https://sta.eftm2.cloud.sitefinity.com";

  const authMode = (env.SITEFINITY_AUTH_MODE?.trim() || "anonymous").toLowerCase();
  if (authMode !== "anonymous" && authMode !== "password") {
    throw new Error(
      `SITEFINITY_AUTH_MODE must be "anonymous" or "password", got "${authMode}".`
    );
  }
  if (authMode === "password" && (!env.SITEFINITY_USERNAME || !env.SITEFINITY_PASSWORD)) {
    throw new Error(
      'SITEFINITY_AUTH_MODE="password" requires SITEFINITY_USERNAME and SITEFINITY_PASSWORD.'
    );
  }

  const timeoutMs = Number(env.SITEFINITY_TIMEOUT_MS ?? "30000");

  return {
    baseUrl: stripTrailingSlash(baseUrl),
    serviceName: env.SITEFINITY_SERVICE_NAME?.trim() || "default",
    authMode,
    username: env.SITEFINITY_USERNAME?.trim(),
    password: env.SITEFINITY_PASSWORD,
    clientId: env.SITEFINITY_CLIENT_ID?.trim() || "sitefinity",
    clientSecret: env.SITEFINITY_CLIENT_SECRET,
    defaultCulture: env.SITEFINITY_DEFAULT_CULTURE?.trim() || undefined,
    defaultSiteId: env.SITEFINITY_SITE_ID?.trim() || undefined,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 30000,

    // Transport / hosting
    transport: (env.MCP_TRANSPORT?.trim() || "http").toLowerCase(), // "http" | "stdio"
    host: env.HOST?.trim() || "0.0.0.0",
    port: Number(env.PORT ?? "8080"),

    // Optional AI assistant (powered by the Anthropic API). The key is a
    // server-side secret — never expose it to the browser.
    apiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    model: env.ANTHROPIC_MODEL?.trim() || "claude-opus-4-8",

    // Optional Progress Agentic RAG (ARAG) integration. Key is a server-side
    // secret; region + KB id are plain config.
    aragKey: env.ARAG_API_KEY?.trim() || undefined,
    aragRegion: env.ARAG_REGION?.trim() || "aws-us-east-2-1",
    aragKbId: env.ARAG_KB_ID?.trim() || undefined,
  };
}
