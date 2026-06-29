/**
 * Minimal, dependency-free Anthropic Messages API client with an agentic
 * tool-use loop. Uses Node's built-in fetch — the official SDK would require
 * `npm install`, which this project forbids, so raw HTTP is the right call here.
 *
 * The loop exposes the MCP server's own tools to Claude as Anthropic tools, so
 * the assistant answers questions by actually querying the live Sitefinity API.
 *
 * Model: claude-opus-4-8 (default), adaptive thinking, effort=medium.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "AnthropicError";
    this.status = status;
    this.body = body;
  }
}

async function callMessages({ apiKey, model, system, messages, tools, maxTokens, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        tools,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new AnthropicError(`Anthropic request timed out after ${timeoutMs}ms`);
    }
    throw new AnthropicError(`Network error contacting Anthropic: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    let body = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    const msg = body?.error?.message || `${res.status} ${res.statusText}`;
    throw new AnthropicError(`Anthropic API error: ${msg}`, res.status, body);
  }
  return JSON.parse(text);
}

/**
 * Run the agentic tool-use loop until the model stops calling tools.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.system
 * @param {Array}  opts.messages  conversation so far ({role, content} entries)
 * @param {Array}  opts.tools     Anthropic tool definitions
 * @param {(name:string, input:object)=>Promise<{content:Array,isError?:boolean}>} opts.executeTool
 * @returns {Promise<{text:string, trace:Array, stop:string}>}
 */
export async function runAgentLoop({
  apiKey,
  model,
  system,
  messages,
  tools,
  executeTool,
  maxIterations = 8,
  maxTokens = 4096,
  timeoutMs = 90000,
}) {
  const convo = messages.slice();
  const trace = [];

  for (let i = 0; i < maxIterations; i++) {
    const resp = await callMessages({ apiKey, model, system, messages: convo, tools, maxTokens, timeoutMs });

    if (resp.stop_reason === "refusal") {
      return { text: "I'm not able to help with that request.", trace, stop: "refusal" };
    }

    // Preserve the full assistant content (incl. thinking + tool_use blocks)
    // so it replays correctly on the next iteration of this same-model loop.
    convo.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason === "tool_use") {
      const toolUses = resp.content.filter((b) => b.type === "tool_use");
      const results = [];
      for (const tu of toolUses) {
        const entry = { name: tu.name, input: tu.input, ok: true };
        let resultText = "";
        let isError = false;
        try {
          const r = await executeTool(tu.name, tu.input);
          resultText = r?.content?.[0]?.text ?? "";
          isError = !!r?.isError;
        } catch (err) {
          resultText = `Error: ${err?.message || err}`;
          isError = true;
        }
        entry.ok = !isError;
        trace.push(entry);
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: resultText,
          is_error: isError,
        });
      }
      convo.push({ role: "user", content: results });
      continue;
    }

    // end_turn / max_tokens / stop_sequence → return the text.
    const textBlocks = resp.content.filter((b) => b.type === "text").map((b) => b.text);
    let text = textBlocks.join("\n").trim();
    if (resp.stop_reason === "max_tokens" && text) text += " …";
    if (!text) text = "(No text response.)";
    return { text, trace, stop: resp.stop_reason };
  }

  return {
    text: "I gathered a lot but hit the tool-call limit before wrapping up. Try narrowing the question.",
    trace,
    stop: "max_iterations",
  };
}
