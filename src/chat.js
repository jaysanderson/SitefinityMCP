/**
 * Chat handler: bridges the web UI's "Assistant" to Claude, exposing the MCP
 * server's own tools so the model answers from live Sitefinity data.
 */

import { runAgentLoop } from "./anthropic.js";

const SYSTEM_PROMPT = `You are the Sitefinity MCP Assistant, embedded in a live explorer for a Progress Sitefinity CMS instance.

You have read-only tools that query the site's REST (OData) API: list and describe content types, query items with OData filters, free-text search, count items, fetch related data, and inspect the service schema. The site exposes ~39 content types (news, blogs, events, images, documents, plus custom dynamic types).

Guidelines:
- Answer from real data: call the tools rather than guessing. Any number, title, or fact you cite should come from a tool result.
- Be concise and friendly. Lead with the answer; add brief supporting detail.
- If a user asks what you can do, briefly describe the kinds of content you can explore and offer an example question.
- When you query, prefer small result sets ($top) and select only the fields you need.
- If a tool errors, explain what happened plainly and suggest a next step.`;

export function createChatHandler(toolset, config) {
  const tools = toolset.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
  const serviceRoot = `${config.baseUrl}/api/${config.serviceName}`;

  return async function handleChat(rawMessages, onEvent) {
    const messages = (Array.isArray(rawMessages) ? rawMessages : [])
      .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      throw new Error("Expected a non-empty conversation ending with a user message.");
    }

    // Collect the sources behind this turn's answer (ARAG + structured).
    const sources = [];
    const seen = new Set();
    const executeTool = async (name, input) => {
      if (onEvent) onEvent({ type: "tool", name });
      const r = await toolset.call(name, input);
      try { collectChatSources(sources, seen, name, input, r, serviceRoot, config.baseUrl); } catch { /* best effort */ }
      if (onEvent) onEvent({ type: "tool_result", name, ok: !r?.isError });
      return r;
    };

    const result = await runAgentLoop({
      apiKey: config.apiKey,
      model: config.model,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      executeTool,
      maxIterations: 16,
      onDelta: onEvent ? (text) => onEvent({ type: "delta", text }) : undefined,
    });
    return { ...result, sources: sources.slice(0, 10) };
  };
}

function collectChatSources(sources, seen, name, input, r, serviceRoot, baseUrl) {
  let data;
  try { data = JSON.parse(r?.content?.[0]?.text ?? ""); } catch { return; }
  const add = (key, v) => { if (!key || seen.has(key)) return; seen.add(key); sources.push(v); };

  if (name === "sitefinity_grounded_answer" && Array.isArray(data?.sources)) {
    for (const s of data.sources) {
      const type = s.slug ? s.slug.split("-")[0] : null;
      add("g:" + (s.id || s.title), { title: s.title, type, via: "rag" });
    }
  } else if (name === "sitefinity_semantic_search" && Array.isArray(data?.results)) {
    for (const s of data.results) add("s:" + s.title, { title: s.title, via: "rag" });
  } else if (Array.isArray(data?.value)) {
    const type = input?.type;
    for (const it of data.value) {
      if (!it || typeof it !== "object") continue;
      const id = it.Id;
      const title = it.Title || it.Name || it.UrlName || id;
      if (!title) continue;
      const url = it.ItemDefaultUrl ? baseUrl + it.ItemDefaultUrl : type && id ? `${serviceRoot}/${type}(${id})` : null;
      add((type || "") + ":" + (id || title), {
        title: String(title).replace(/<[^>]*>/g, "").trim().slice(0, 140),
        type, url, via: "odata",
      });
    }
  }
}
