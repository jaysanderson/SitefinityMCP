/* ============================================================
   Sitefinity MCP Explorer — client app (vanilla ES module)
   Talks to the same origin's /mcp endpoint over JSON-RPC 2.0.
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const k of kids) node.append(k?.nodeType ? k : document.createTextNode(k ?? ""));
  return node;
};

// ---- State -----------------------------------------------------------------
const state = { tools: [], types: [], info: null, rpcId: 0, wire: [] };

// ---- MCP / JSON-RPC client -------------------------------------------------
async function rpc(method, params) {
  const id = ++state.rpcId;
  const request = { jsonrpc: "2.0", id, method, params };
  const started = performance.now();
  let response, error;
  try {
    const res = await fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
    });
    response = await res.json();
    if (response.error) error = response.error;
  } catch (e) {
    error = { message: e.message };
  }
  logWire(method, request, response ?? { error }, performance.now() - started, !!error);
  if (error) throw new Error(error.message || "RPC error");
  return response.result;
}

async function callTool(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text ?? "";
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { data, isError: !!result?.isError, text };
}

// ---- Wire log --------------------------------------------------------------
function logWire(method, req, res, ms, isErr) {
  state.wire.unshift({ method, req, res, ms: Math.round(ms), isErr });
  if (state.wire.length > 60) state.wire.pop();
  $("#wireCount").textContent = String(state.wire.length);
  renderWire();
}
function renderWire() {
  const body = $("#wireBody");
  body.innerHTML = "";
  if (!state.wire.length) { body.append(el("div", { className: "empty" }, "No traffic yet.")); return; }
  for (const w of state.wire) {
    const head = el("div", { className: "we-head" + (w.isErr ? " we-err" : "") });
    head.append(el("span", { className: "we-method" }, `→ ${w.method}`));
    head.append(el("span", { className: "we-time" }, `${w.ms} ms`));
    const entry = el("div", { className: "wire-entry" });
    entry.append(head);
    entry.append(el("pre", {}, jsonHighlight(w.req)));
    entry.append(el("pre", {}, jsonHighlight(w.res)));
    body.append(entry);
  }
}

// ---- JSON highlighting -----------------------------------------------------
function escapeHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function jsonHighlight(obj) {
  const json = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  const span = document.createElement("span");
  span.innerHTML = escapeHtml(json)
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?/g, (m, _g, _g2, colon) =>
      colon ? `<span class="k">${m.slice(0, -colon.length)}</span>${colon}` : `<span class="s">${m}</span>`)
    .replace(/\b(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, '<span class="n">$1</span>')
    .replace(/\b(true|false)\b/g, '<span class="b">$1</span>')
    .replace(/\bnull\b/g, '<span class="nul">null</span>');
  return span;
}

// ---- Init ------------------------------------------------------------------
async function init() {
  wireUpChrome();
  try {
    const initRes = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "sitefinity-mcp-web", version: "1.0.0" },
    });
    setStatus("online", "Online");
    state.protocol = initRes.protocolVersion;

    const [tl, types] = await Promise.all([
      rpc("tools/list"),
      callTool("sitefinity_list_content_types", {}),
      fetch("/api/info").then((r) => r.json()).then((i) => (state.info = i)).catch(() => {}),
    ]);
    state.tools = tl.tools || [];
    state.types = (types.data?.contentTypes || []).slice();

    renderStats();
    renderToolGrid();
    renderTypeGrid();
    populateTypeSelects();
    renderPlayground();
    renderAbout();
  } catch (e) {
    setStatus("offline", "Offline");
    console.error(e);
  }
}

function setStatus(kind, label) {
  const s = $("#status");
  s.className = `status status--${kind}`;
  $(".status-label", s).textContent = label;
}

// ---- Dashboard -------------------------------------------------------------
function renderStats() {
  $("#stat-tools").textContent = state.tools.length;
  $("#stat-types").textContent = state.types.length;
  $("#stat-protocol").textContent = state.protocol || "—";
  $("#stat-service").textContent = state.info?.serviceRoot || "—";
}

function renderToolGrid() {
  const grid = $("#toolGrid");
  grid.innerHTML = "";
  for (const t of state.tools) {
    const card = el("button", { className: "tool-card", type: "button" });
    card.append(el("div", { className: "tc-name" }, t.name));
    card.append(el("div", { className: "tc-title" }, t.title || t.name));
    card.append(el("div", { className: "tc-desc" }, t.description || ""));
    card.addEventListener("click", () => openPlaygroundFor(t.name));
    grid.append(card);
  }
}

// ---- Content Library -------------------------------------------------------
function renderTypeGrid() {
  const grid = $("#typeGrid");
  grid.innerHTML = "";
  for (const t of state.types) {
    const card = el("button", { className: "type-card", type: "button" });
    card.dataset.name = t.type;
    card.append(el("div", { className: "tn" }, t.type));
    const meta = el("div", { className: "tmeta" });
    meta.append(el("span", {}, ""), Object.assign(document.createElement("span"), { innerHTML: `<b>${t.fields.length}</b> fields` }));
    meta.append(Object.assign(document.createElement("span"), { innerHTML: `<b>${t.relations.length}</b> relations` }));
    card.append(meta);
    card.addEventListener("click", () => openTypeModal(t.type));
    grid.append(card);
  }
}

$("#typeFilter").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  for (const card of $$(".type-card")) {
    card.classList.toggle("is-hidden", !card.dataset.name.toLowerCase().includes(q));
  }
});

async function openTypeModal(typeName) {
  const modal = $("#modal");
  $("#modal-title").textContent = typeName;
  const body = $("#modal-body");
  body.innerHTML = "";
  body.append(loadingRow("Loading schema & sample…"));
  openModal();

  try {
    const [desc, sample] = await Promise.all([
      callTool("sitefinity_describe_type", { type: typeName }),
      callTool("sitefinity_query_items", { type: typeName, top: 8 }),
    ]);
    body.innerHTML = "";

    const d = desc.data;
    // Fields table
    body.append(el("div", { className: "subhead" }, `Fields (${d.properties?.length || 0})`));
    const wrap = el("div", { className: "table-wrap" });
    const table = el("table", { className: "grid" });
    table.append(rowEl("th", ["Field", "Type", "Nullable"]));
    for (const p of d.properties || []) table.append(rowEl("td", [p.name, p.type, p.nullable ? "yes" : "no"]));
    wrap.append(table);
    body.append(wrap);

    // Relations
    if (d.navigationProperties?.length) {
      body.append(el("div", { className: "subhead" }, `Relations / expandable ($expand)`));
      const chips = el("div", { className: "chips" });
      for (const n of d.navigationProperties) chips.append(el("span", { className: "chip nav" }, `${n.name}${n.collection ? " []" : ""}`));
      body.append(chips);
    }

    // Sample
    const items = sample.data?.value || [];
    body.append(el("div", { className: "subhead" }, `Sample items (${items.length})`));
    if (items.length) body.append(recordCards(items, typeName));
    else body.append(el("div", { className: "empty" }, "No items returned."));

    // Quick action
    const act = el("div", { className: "actions" });
    const btn = el("button", { className: "btn btn--primary" }, "Open in Query Builder");
    btn.addEventListener("click", () => { closeModal(); $("#q-type").value = typeName; switchView("query"); });
    act.append(btn);
    body.append(act);
  } catch (e) {
    body.innerHTML = "";
    body.append(el("div", { className: "empty" }, "Error: " + e.message));
  }
}

// ---- Query builder ---------------------------------------------------------
function populateTypeSelects() {
  for (const id of ["#q-type", "#s-type"]) {
    const sel = $(id);
    sel.innerHTML = "";
    for (const t of state.types) sel.append(el("option", { value: t.type }, t.type));
  }
  const def = state.types.find((t) => t.type === "newsitems") ? "newsitems" : state.types[0]?.type;
  if (def) { $("#q-type").value = def; $("#s-type").value = def; }
}

const csv = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);

$("#q-run").addEventListener("click", async () => {
  const args = { type: $("#q-type").value };
  const filter = $("#q-filter").value.trim(); if (filter) args.filter = filter;
  const select = csv($("#q-select").value); if (select.length) args.select = select;
  const orderby = csv($("#q-orderby").value); if (orderby.length) args.orderby = orderby;
  const top = Number($("#q-top").value); if (top) args.top = top;
  const skip = Number($("#q-skip").value); if (skip) args.skip = skip;
  const expand = csv($("#q-expand").value); if (expand.length) args.expand = expand;
  if ($("#q-count").checked) args.count = true;
  await runInto("#q-results", "#q-meta", "sitefinity_query_items", args);
});

$("#s-run").addEventListener("click", async () => {
  const args = { type: $("#s-type").value, term: $("#s-term").value.trim() };
  const fields = csv($("#s-fields").value); if (fields.length) args.fields = fields;
  const top = Number($("#s-top").value); if (top) args.top = top;
  if (!args.term) { $("#s-meta").innerHTML = '<span class="err">Enter a search term.</span>'; return; }
  await runInto("#s-results", "#s-meta", "sitefinity_search_items", args);
});

async function runInto(resultsSel, metaSel, tool, args) {
  const meta = $(metaSel), results = $(resultsSel);
  meta.innerHTML = '<span class="spinner"></span>';
  results.innerHTML = "";
  const t0 = performance.now();
  try {
    const { data, isError } = await callTool(tool, args);
    const ms = Math.round(performance.now() - t0);
    if (isError) { meta.innerHTML = `<span class="err">Error</span> · ${ms} ms`; results.append(el("pre", { className: "json" }, jsonHighlight(data))); return; }
    const items = Array.isArray(data?.value) ? data.value : null;
    const count = data?.["@odata.count"];
    meta.innerHTML = `<span class="ok">OK</span> · ${items ? items.length + " items" : "1 result"}${count != null ? " · " + count + " total" : ""} · ${ms} ms`;
    renderResults(results, data, items, args.type);
  } catch (e) {
    meta.innerHTML = `<span class="err">${e.message}</span>`;
  }
}

// ---- Results rendering -----------------------------------------------------
function renderResults(container, data, items, typeName) {
  container.innerHTML = "";
  if (!items) { container.append(el("pre", { className: "json" }, jsonHighlight(data))); return; }
  if (!items.length) { container.append(el("div", { className: "empty" }, "No items matched.")); return; }

  const head = el("div", { className: "results-head" });
  const group = el("div", { className: "toggle-group" });
  const views = { Cards: () => recordCards(items, typeName), Table: () => recordTable(items), JSON: () => el("pre", { className: "json" }, jsonHighlight(data)) };
  const panel = el("div");
  Object.keys(views).forEach((name, i) => {
    const b = el("button", { className: i === 0 ? "is-active" : "" }, name);
    b.addEventListener("click", () => { $$(".toggle-group button", head).forEach((x) => x.classList.remove("is-active")); b.classList.add("is-active"); panel.innerHTML = ""; panel.append(views[name]()); });
    group.append(b);
  });
  head.append(group);
  container.append(head, panel);
  panel.append(views.Cards());
}

function stripHtml(s) { return String(s).replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim(); }
function firstOf(obj, keys) { for (const k of keys) if (obj[k] != null && obj[k] !== "") return obj[k]; return null; }
function looksLikeImage(v) { return typeof v === "string" && /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(v); }

function recordCards(items, typeName) {
  const cards = el("div", { className: "cards" });
  for (const it of items) {
    const card = el("div", { className: "rec" });
    const thumbVal = firstOf(it, ["ThumbnailUrl", "Url", "MediaUrl"]) || Object.values(it).find(looksLikeImage);
    if ((typeName === "images" || looksLikeImage(thumbVal)) && looksLikeImage(thumbVal)) {
      const img = el("img", { className: "rec-thumb", src: thumbVal, loading: "lazy", alt: "" });
      img.addEventListener("error", () => img.remove());
      card.append(img);
    }
    const title = firstOf(it, ["Title", "Name", "UrlName"]) || it.Id || "(untitled)";
    card.append(el("div", { className: "rec-title" }, stripHtml(title)));
    const date = firstOf(it, ["PublicationDate", "LastModified", "DateCreated"]);
    if (date) card.append(el("div", { className: "rec-date" }, String(date).replace("T", " ").replace("Z", "")));
    const desc = firstOf(it, ["Summary", "MetaDescription", "Description", "Content"]);
    if (desc) card.append(el("div", { className: "rec-desc" }, stripHtml(desc).slice(0, 240)));
    if (it.Id) card.append(el("div", { className: "rec-kv" }, "id: " + it.Id));
    cards.append(card);
  }
  return cards;
}

function recordTable(items) {
  const cols = [...new Set(items.flatMap((i) => Object.keys(i)))].filter((c) => !c.startsWith("@")).slice(0, 9);
  const wrap = el("div", { className: "table-wrap" });
  const table = el("table", { className: "grid" });
  table.append(rowEl("th", cols));
  for (const it of items) table.append(rowEl("td", cols.map((c) => fmtCell(it[c]))));
  wrap.append(table);
  return wrap;
}
function fmtCell(v) {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return stripHtml(String(v)).slice(0, 120);
}

// ---- Playground ------------------------------------------------------------
function renderPlayground() {
  const root = $("#playground");
  root.innerHTML = "";
  for (const tool of state.tools) root.append(buildToolPanel(tool));
}

function buildToolPanel(tool) {
  const panel = el("div", { className: "pg-tool" });
  panel.dataset.name = tool.name;

  const head = el("div", { className: "pg-head" });
  const left = el("div");
  left.append(el("div", { className: "pg-name" }, tool.name));
  left.append(el("div", { className: "pg-desc" }, tool.description || ""));
  head.append(left, el("div", { className: "pg-caret" }, "▶"));
  head.addEventListener("click", () => panel.classList.toggle("is-open"));

  const body = el("div", { className: "pg-body" });
  const props = tool.inputSchema?.properties || {};
  const required = tool.inputSchema?.required || [];
  const fields = el("div", { className: "pg-fields" });
  const inputs = {};

  for (const [key, schema] of Object.entries(props)) {
    const label = el("label");
    label.append(el("span", { className: required.includes(key) ? "req" : "" }, key + typeHint(schema)));
    const input = buildInput(schema);
    inputs[key] = { input, schema };
    label.append(input);
    fields.append(label);
  }
  if (!Object.keys(props).length) fields.append(el("div", { className: "muted" }, "No parameters."));
  body.append(fields);

  const runBtn = el("button", { className: "btn btn--primary" }, "Run " + tool.name);
  body.append(runBtn);

  const split = el("div", { className: "pg-split" });
  const reqBox = el("div"); reqBox.append(el("h4", {}, "Request"));
  const reqPre = el("pre", { className: "json" }, ""); reqBox.append(reqPre);
  const resBox = el("div"); resBox.append(el("h4", {}, "Response"));
  const resPre = el("pre", { className: "json" }, ""); resBox.append(resPre);
  split.append(reqBox, resBox);
  body.append(split);

  runBtn.addEventListener("click", async () => {
    const args = collectArgs(inputs);
    reqPre.innerHTML = ""; reqPre.append(jsonHighlight({ name: tool.name, arguments: args }));
    resPre.innerHTML = ""; resPre.append(el("span", { className: "spinner" }));
    runBtn.disabled = true;
    try {
      const { text } = await callTool(tool.name, args);
      resPre.innerHTML = ""; resPre.append(jsonHighlight(text));
    } catch (e) {
      resPre.innerHTML = ""; resPre.append("Error: " + e.message);
    } finally { runBtn.disabled = false; }
  });

  panel.append(head, body);
  return panel;
}

function typeHint(schema) {
  if (schema.enum) return "";
  if (schema.type === "array") return "  (csv)";
  if (schema.type === "integer" || schema.type === "number") return "  (number)";
  if (schema.type === "boolean") return "";
  return "";
}
function buildInput(schema) {
  if (schema.enum) {
    const sel = el("select", { className: "input" });
    sel.append(el("option", { value: "" }, "— select —"));
    for (const opt of schema.enum) sel.append(el("option", { value: opt }, opt));
    return sel;
  }
  if (schema.type === "boolean") { const i = el("input", { type: "checkbox" }); i.style.width = "auto"; return i; }
  const input = el("input", { className: "input", placeholder: schema.description?.slice(0, 60) || "" });
  if (schema.type === "integer" || schema.type === "number") input.type = "number";
  return input;
}
function collectArgs(inputs) {
  const args = {};
  for (const [key, { input, schema }] of Object.entries(inputs)) {
    if (schema.type === "boolean") { if (input.checked) args[key] = true; continue; }
    const v = input.value.trim();
    if (!v) continue;
    if (schema.type === "array") args[key] = csv(v);
    else if (schema.type === "integer" || schema.type === "number") args[key] = Number(v);
    else args[key] = v;
  }
  return args;
}

function openPlaygroundFor(name) {
  switchView("playground");
  const panel = $$(".pg-tool").find((p) => p.dataset.name === name);
  if (panel) { panel.classList.add("is-open"); panel.scrollIntoView({ behavior: "smooth", block: "center" }); }
}

// ---- About -----------------------------------------------------------------
function renderAbout() {
  $("#about").innerHTML = `
    <h3>What is this?</h3>
    <p class="muted">A live, zero-dependency <strong>Model Context Protocol</strong> server for the
    Progress Sitefinity CMS REST (OData) API. This explorer page is served by the very same Node
    process that answers MCP requests at <code>/mcp</code>.</p>
    <h3>How it works</h3>
    <ul>
      <li>The tool surface is <strong>generated from the live service</strong> — parsed from the OData <code>$metadata</code>.</li>
      <li>Every panel issues real <code>tools/call</code> JSON-RPC requests (watch them in the <strong>Wire log</strong>).</li>
      <li>No npm dependencies, no build step — plain Node built-ins and vanilla JS.</li>
    </ul>
    <h3>Connect your own MCP client</h3>
    <p class="muted">Point any Streamable-HTTP MCP client at:</p>
    <pre class="json">${escapeHtml(location.origin + "/mcp")}</pre>
    <p class="muted">Service root: <code>${escapeHtml(state.info?.serviceRoot || "")}</code> ·
    Protocol: <code>${escapeHtml(state.protocol || "")}</code> ·
    <a href="https://github.com/jaysanderson/SitefinityMCP" target="_blank" rel="noopener">Source on GitHub ↗</a></p>`;
}

// ---- Chrome (tabs, modal, wire) -------------------------------------------
function switchView(name) {
  $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === name));
  $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === "view-" + name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function wireUpChrome() {
  $$(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));
  $("#wireToggle").addEventListener("click", () => { $("#wire").classList.add("is-open"); $("#wireBackdrop").classList.add("is-open"); });
  const closeWire = () => { $("#wire").classList.remove("is-open"); $("#wireBackdrop").classList.remove("is-open"); };
  $("#wireClose").addEventListener("click", closeWire);
  $("#wireBackdrop").addEventListener("click", closeWire);
  $("#wireClear").addEventListener("click", () => { state.wire = []; $("#wireCount").textContent = "0"; renderWire(); });
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); closeWire(); } });
}
function openModal() { $("#modal").classList.add("is-open"); }
function closeModal() { $("#modal").classList.remove("is-open"); }

// ---- Small DOM helpers -----------------------------------------------------
function rowEl(cell, values) {
  const tr = el("tr");
  for (const v of values) tr.append(el(cell, { title: typeof v === "string" ? v : "" }, v));
  return tr;
}
function loadingRow(text) { const d = el("div", { className: "empty" }); d.append(el("span", { className: "spinner" }), " " + text); return d; }

init();
