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

  return async function handleChat(rawMessages) {
    const messages = (Array.isArray(rawMessages) ? rawMessages : [])
      .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      throw new Error("Expected a non-empty conversation ending with a user message.");
    }

    return runAgentLoop({
      apiKey: config.apiKey,
      model: config.model,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      executeTool: (name, input) => toolset.call(name, input),
    });
  };
}
