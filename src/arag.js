/**
 * Dependency-free client for Progress Agentic RAG (ARAG / NucliaDB).
 *
 * Base:  https://{region}.rag.progress.cloud/api/v1/kb/{kbId}
 * Auth:  X-NUCLIA-SERVICEACCOUNT: Bearer <key>  (canonical, server-to-server)
 *        falls back to X-STF-NUAKEY: Bearer <key>  (NUA keys)
 *
 * Exposes the subset the MCP server needs: semantic search (/find), grounded
 * answers (/ask, synchronous + cited), knowledge-graph search (/graph), and
 * text ingestion (/resources).  Built on Node's global fetch — no npm.
 */

export class AragError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "AragError";
    this.status = status;
    this.body = body;
  }
}

export class AragClient {
  constructor({ apiKey, region, kbId, timeoutMs = 60000 }) {
    this.apiKey = apiKey;
    this.region = region;
    this.kbId = kbId;
    this.timeoutMs = timeoutMs;
    this.base = `https://${region}.rag.progress.cloud/api/v1/kb/${kbId}`;
    this._authHeader = "X-NUCLIA-SERVICEACCOUNT"; // sticky after first success
  }

  async _req(method, path, { body, headers = {}, authHeader } = {}) {
    const url = `${this.base}${path}`;
    const tryHeaders = authHeader
      ? [authHeader]
      : [this._authHeader, this._authHeader === "X-NUCLIA-SERVICEACCOUNT" ? "X-STF-NUAKEY" : "X-NUCLIA-SERVICEACCOUNT"];

    let lastErr;
    for (const ah of tryHeaders) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: {
            [ah]: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
            accept: "application/json",
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        if (err && err.name === "AbortError") throw new AragError(`ARAG request timed out: ${url}`);
        throw new AragError(`Network error contacting ARAG: ${err?.message || err}`);
      } finally {
        clearTimeout(timer);
      }

      const text = await res.text();
      if (res.status === 401 || res.status === 403) {
        lastErr = new AragError(`ARAG auth failed (${res.status}) using ${ah}`, res.status, safeJson(text));
        continue; // try the other auth header
      }
      if (!res.ok) {
        throw new AragError(`ARAG ${res.status} for ${method} ${path}`, res.status, safeJson(text));
      }
      this._authHeader = ah; // remember what worked
      return safeJson(text);
    }
    throw lastErr || new AragError("ARAG request failed");
  }

  /** Semantic search → ranked paragraphs with their source resources. */
  async find(query, { top = 8, filters } = {}) {
    const body = { query, top_k: top };
    if (filters) body.filter_expression = filters;
    const raw = await this._req("POST", "/find", { body });
    return { paragraphs: extractParagraphs(raw, top), raw };
  }

  /** Grounded, cited answer (synchronous). */
  async ask(question, { ragStrategies, filters } = {}) {
    const body = { query: question, citations: "default", show: ["basic", "values"] };
    if (ragStrategies) body.rag_strategies = ragStrategies;
    if (filters) body.filter_expression = filters;
    const raw = await this._req("POST", "/ask", { body, headers: { "x-synchronous": "true" } });
    const answer = raw?.answer ?? "";
    return {
      answer,
      sources: extractSources(raw),
      relations: extractRelations(raw),
      citations: raw?.citations ?? null,
      grounded: !!(answer && !/not enough data/i.test(answer)),
      raw,
    };
  }

  /** Knowledge-graph search around a query/entity. */
  async graph(query, { top = 40 } = {}) {
    const raw = await this._req("POST", "/graph", { body: { query, top_k: top } });
    return raw;
  }

  /** Create a text resource (ingestion). */
  async ingestText({ slug, title, body, metadata, format = "PLAIN", origin } = {}) {
    const payload = {
      title: title || slug,
      slug,
      texts: { content: { body: body || "", format } },
    };
    if (metadata) payload.usermetadata = { classifications: [], ...metadata };
    if (origin) payload.origin = origin;
    return this._req("POST", "/resources", { body: payload });
  }

  /** Lightweight reachability/auth probe. */
  async ping() {
    // /ask with a trivial query is the most reliable "is everything wired" check.
    return this.ask("ping");
  }
}

function safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

/** Best-effort flatten of NucliaDB find results into ranked paragraphs. */
function extractParagraphs(raw, limit) {
  const out = [];
  const resources = raw?.resources || {};
  for (const [rid, r] of Object.entries(resources)) {
    const fields = r?.fields || {};
    for (const f of Object.values(fields)) {
      const paras = f?.paragraphs || {};
      for (const p of Object.values(paras)) {
        out.push({
          resourceId: rid,
          title: r?.title || rid,
          text: (p?.text || "").trim(),
          score: p?.score ?? 0,
        });
      }
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Best-effort entity relations (triplets) from an /ask payload. */
function extractRelations(raw) {
  const out = [];
  const rel = raw?.relations;
  // Nuclia shape: { entities: { "<entity>": { related_to: [{entity, relation, ...}] } } }
  const entities = rel?.entities || {};
  for (const [from, info] of Object.entries(entities)) {
    for (const r of info?.related_to || []) {
      out.push({ from, label: r?.relation || r?.relation_label || "related", to: r?.entity || r?.to || "" });
      if (out.length >= 60) return out;
    }
  }
  return out;
}

/** Best-effort source list (resource-level) from an /ask or /find payload. */
function extractSources(raw) {
  const resources = raw?.retrieval_results?.resources || raw?.resources || {};
  const seen = new Set();
  const sources = [];
  for (const [rid, r] of Object.entries(resources)) {
    if (seen.has(rid)) continue;
    seen.add(rid);
    sources.push({
      id: rid,
      title: r?.title || rid,
      slug: r?.slug || null,
      summary: r?.summary || null,
    });
  }
  return sources;
}
