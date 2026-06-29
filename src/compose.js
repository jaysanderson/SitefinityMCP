/**
 * Generative-UI handler: given a short brief, Claude uses the MCP tools to pull
 * REAL content from the site and returns a structured "experience spec" (JSON)
 * that the React front-end assembles into a live microsite.
 *
 * This is the "art of the possible" centerpiece: natural language + live CMS
 * data (via MCP) + AI → a rendered digital experience.
 */

import { runAgentLoop } from "./anthropic.js";

const SYSTEM_PROMPT = `You are an Experience Composer for a Progress Sitefinity CMS. Given a short brief, you design a polished web experience populated with REAL content from the site. A React renderer turns your output into a live microsite, so your output must be valid, complete JSON.

Workflow:
1. Use the read tools to gather real content relevant to the brief — list/describe types, query items, search, count. Be efficient: 1–4 well-chosen calls, select only the fields you need, keep result sets small (top 6–12).
2. Then output the experience as a SINGLE JSON object and NOTHING else.

JSON schema (use ONLY these section types):
{
  "title": "short experience name",
  "tagline": "one sentence",
  "theme": { "accent": "#RRGGBB", "mood": "warm" | "cool" | "bold" | "editorial" },
  "sections": [ /* 3 to 6 sections, ordered */ ]
}
Sections:
- { "type": "hero", "kicker": "string", "heading": "string", "sub": "string", "cta": "string" }
- { "type": "stats", "items": [ { "value": "string", "label": "string" } ] }            // 2–4
- { "type": "grid", "heading": "string", "sub": "string?", "items": [ { "title": "string", "summary": "string", "meta": "string?", "tag": "string?" } ] }   // 3–9
- { "type": "gallery", "heading": "string", "items": [ { "title": "string", "image": "url?", "caption": "string?" } ] }
- { "type": "feature", "heading": "string", "body": "string", "points": ["string"] }
- { "type": "list", "heading": "string", "items": [ { "title": "string", "meta": "string?" } ] }
- { "type": "quote", "text": "string", "attribution": "string?" }

Rules:
- Every title/summary/value/count MUST come from real tool results — never invent content. Use count tools for any number you cite.
- When you query items, ALWAYS include "Id" in $select (and "ItemDefaultUrl" when the type has it) so the experience can cite and link its sources.
- Strip HTML from content; keep summaries under ~160 characters.
- Choose section types that fit the brief AND the data you actually found.
- Pick an accent hex that suits the mood.
- Output ONLY the JSON object — no prose, no markdown, no code fences.`;

/** Collect the real content records a tool call returned, as grounding sources. */
function collectSources(sources, seen, input, resultObj, serviceRoot, baseUrl) {
  let data;
  try {
    data = JSON.parse(resultObj?.content?.[0]?.text ?? "");
  } catch {
    return;
  }
  if (!data || !Array.isArray(data.value)) return;
  const type = input?.type;
  for (const it of data.value) {
    if (!it || typeof it !== "object") continue;
    const id = it.Id || null;
    const rawTitle = it.Title || it.Name || it.UrlName || id || "(untitled)";
    const key = `${type || ""}:${id || rawTitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      type: type || null,
      id,
      title: String(rawTitle).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 140),
      date: it.PublicationDate || it.LastModified || it.DateCreated || null,
      siteUrl: it.ItemDefaultUrl ? baseUrl + it.ItemDefaultUrl : null,
      apiUrl: type && id ? `${serviceRoot}/${type}(${id})` : null,
    });
    if (sources.length >= 40) return;
  }
}

function parseSpec(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export function createComposeHandler(toolset, config) {
  const tools = toolset.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
  const serviceRoot = `${config.baseUrl}/api/${config.serviceName}`;

  return async function compose(brief) {
    const b = String(brief || "").slice(0, 600).trim();
    if (!b) throw new Error("Provide a brief for the experience.");

    // Capture the real records each tool call returned, as grounding sources.
    const sources = [];
    const seen = new Set();
    const executeTool = async (name, input) => {
      const r = await toolset.call(name, input);
      try {
        collectSources(sources, seen, input, r, serviceRoot, config.baseUrl);
      } catch {
        /* non-fatal: sources are best-effort */
      }
      return r;
    };

    const result = await runAgentLoop({
      apiKey: config.apiKey,
      model: config.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Brief: ${b}` }],
      tools,
      executeTool,
      maxTokens: 8000,
      maxIterations: 10,
    });

    const spec = parseSpec(result.text);
    if (!spec || !Array.isArray(spec.sections)) {
      throw new Error("The composer didn't return a valid experience. Try rephrasing the brief.");
    }
    return { spec, trace: result.trace, sources };
  };
}
