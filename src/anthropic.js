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
 * Streaming variant of callMessages: parses the Anthropic SSE stream, invokes
 * onDelta(text) for each text chunk, and returns the assembled message
 * ({ content, stop_reason }) so the agent loop can continue / replay it.
 */
async function callMessagesStream({ apiKey, model, system, messages, tools, maxTokens, timeoutMs }, onDelta) {
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
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        tools,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") throw new AnthropicError(`Anthropic request timed out after ${timeoutMs}ms`);
    throw new AnthropicError(`Network error contacting Anthropic: ${err?.message || err}`);
  }

  if (!res.ok) {
    const text = await res.text();
    clearTimeout(timer);
    let body = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    throw new AnthropicError(`Anthropic API error: ${body?.error?.message || res.status}`, res.status, body);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const blocks = {};
  let stopReason = null;
  let streamErr = null;

  const handle = (ev, data) => {
    if (ev === "error") { streamErr = data?.error?.message || "stream error"; return; }
    if (ev === "content_block_start") {
      const b = { ...(data.content_block || {}) };
      if (b.type === "tool_use") b._json = "";
      if (b.type === "text") b.text = b.text || "";
      if (b.type === "thinking") b.thinking = b.thinking || "";
      blocks[data.index] = b;
    } else if (ev === "content_block_delta") {
      const b = blocks[data.index]; if (!b) return;
      const d = data.delta || {};
      if (d.type === "text_delta") { b.text = (b.text || "") + d.text; if (onDelta) onDelta(d.text); }
      else if (d.type === "input_json_delta") { b._json = (b._json || "") + d.partial_json; }
      else if (d.type === "thinking_delta") { b.thinking = (b.thinking || "") + d.thinking; }
      else if (d.type === "signature_delta") { b.signature = d.signature; }
    } else if (ev === "content_block_stop") {
      const b = blocks[data.index];
      if (b && b.type === "tool_use") { try { b.input = JSON.parse(b._json || "{}"); } catch { b.input = {}; } delete b._json; }
    } else if (ev === "message_delta") {
      if (data.delta && data.delta.stop_reason) stopReason = data.delta.stop_reason;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let ev = null;
        let dataStr = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
        }
        if (!ev || !dataStr) continue;
        let data;
        try { data = JSON.parse(dataStr); } catch { continue; }
        handle(ev, data);
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (streamErr) throw new AnthropicError(`Anthropic stream error: ${streamErr}`);

  const content = Object.keys(blocks)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => { const { _json, ...rest } = blocks[i]; return rest; });
  return { content, stop_reason: stopReason };
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
  onDelta,
  maxIterations = 8,
  maxTokens = 4096,
  timeoutMs = 90000,
}) {
  const convo = messages.slice();
  const trace = [];
  const useStream = typeof onDelta === "function";

  for (let i = 0; i < maxIterations; i++) {
    const resp = useStream
      ? await callMessagesStream({ apiKey, model, system, messages: convo, tools, maxTokens, timeoutMs }, onDelta)
      : await callMessages({ apiKey, model, system, messages: convo, tools, maxTokens, timeoutMs });

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
