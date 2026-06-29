/* ============================================================
   Studio — React showcase of "art of the possible" experiences
   built on the Sitefinity MCP server.

   Loaded as an ES module from a CDN (no build step, no npm) to honour
   the project's zero-dependency constraint while still being real React.

   Two flagship experiences:
     • Compose — natural language → live MCP data → a rendered microsite
     • Atlas   — an interactive constellation of the whole content universe
   ============================================================ */

import { markdownToHtml } from "/md.js";

// React is vendored (loaded via <script> before this module). If that failed for
// any reason (e.g. a cold-start asset hiccup), fall back to a CDN so the UI can
// never render blank.
let React = window.React;
let ReactDOM = window.ReactDOM;
let htmLib = window.htm;
if (!React || !ReactDOM || !htmLib) {
  const [r, rd, h] = await Promise.all([
    React ? null : import("https://esm.sh/react@18.3.1"),
    ReactDOM ? null : import("https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1"),
    htmLib ? null : import("https://esm.sh/htm@3.1.1"),
  ]);
  React = React || r.default;
  ReactDOM = ReactDOM || rd;
  htmLib = htmLib || h.default;
}
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const createRoot = ReactDOM.createRoot;
const html = htmLib.bind(React.createElement);

/* ---------- shared helpers ---------- */
let rpcId = 0;
async function rpc(method, params) {
  const res = await fetch("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
async function callTool(name, args = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  const text = r?.content?.[0]?.text ?? "";
  try { return JSON.parse(text); } catch { return text; }
}
const stripHtml = (s) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const fmtDate = (d) => {
  if (!d) return "";
  const s = String(d);
  // Hide null/default dates leaking from the CMS (0001-01-01, pre-1900).
  if (s.startsWith("0001") || /^00\d\d-/.test(s)) return "";
  const y = parseInt(s.slice(0, 4), 10);
  if (Number.isFinite(y) && y < 1990) return "";
  return s.replace("T", " ").replace("Z", "").slice(0, 16);
};

/* ============================================================
   COMPOSE — generative UI
   ============================================================ */
const PRESETS = [
  { label: "🍔 Menu landing page", brief: "A sleek landing page showcasing our menu / food items, with a hero and a product grid." },
  { label: "📰 Press room", brief: "A modern press room built from our latest news items, newest first." },
  { label: "📅 Events hub", brief: "An events hub highlighting upcoming and recent events with key details." },
  { label: "💬 Testimonials wall", brief: "A testimonials / social-proof wall using real testimonials and a headline stat." },
  { label: "🗺️ Locations directory", brief: "A locations and team directory page from our people and locations content." },
];

const BUILD_PHASES = [
  "Inspecting the content model…",
  "Querying live content via MCP…",
  "Selecting the strongest sections…",
  "Composing the experience…",
  "Rendering…",
];

function Compose({ aiEnabled }) {
  const [brief, setBrief] = useState("");
  const [status, setStatus] = useState("idle"); // idle | composing | done | error
  const [spec, setSpec] = useState(null);
  const [trace, setTrace] = useState([]);
  const [sources, setSources] = useState([]);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (status !== "composing") return;
    setPhase(0);
    const t = setInterval(() => setPhase((p) => Math.min(p + 1, BUILD_PHASES.length - 1)), 2600);
    return () => clearInterval(t);
  }, [status]);

  const run = useCallback(async (b) => {
    const text = (b ?? brief).trim();
    if (!text || status === "composing") return;
    setBrief(text);
    setStatus("composing");
    setError("");
    setSpec(null);
    setTrace([]);
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Compose failed");
      setSpec(data.spec);
      setTrace(data.trace || []);
      setSources(data.sources || []);
      setStatus("done");
    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  }, [brief, status]);

  if (!aiEnabled) {
    return html`<div class="x-empty panel">
      <h3>Composer needs an API key</h3>
      <p class="muted">Set <code>ANTHROPIC_API_KEY</code> on the server to enable generative experiences. The Atlas view works without it.</p>
    </div>`;
  }

  return html`
    <div class="x-compose">
      <div class="x-intro">
        <h3>Describe an experience. Watch it build itself.</h3>
        <p class="muted">Claude reads your brief, pulls real content through the MCP tools, and returns a structured design that React assembles live — proof that whole digital experiences can be generated from a CMS over MCP.</p>
      </div>

      <div class="x-bar">
        <input class="input" placeholder="e.g. a vibrant landing page for our menu…"
          value=${brief} onInput=${(e) => setBrief(e.target.value)}
          onKeyDown=${(e) => e.key === "Enter" && run()} />
        <button class="btn btn--primary" disabled=${status === "composing"} onClick=${() => run()}>
          ${status === "composing" ? "Composing…" : "Compose ✨"}
        </button>
      </div>
      <div class="x-presets">
        ${PRESETS.map((p) => html`<button key=${p.label} class="x-chip" disabled=${status === "composing"} onClick=${() => run(p.brief)}>${p.label}</button>`)}
      </div>

      ${status === "composing" && html`<${BuildLog} phase=${phase} />`}
      ${status === "error" && html`<div class="x-empty panel"><h3>Couldn't compose that</h3><p class="muted">${error}</p></div>`}
      ${status === "done" && spec && html`<${Experience} spec=${spec} trace=${trace} sources=${sources} key=${spec.title || Math.random()} />`}
    </div>`;
}

function BuildLog({ phase }) {
  return html`<div class="x-build panel">
    <div class="x-build-orb"></div>
    <div class="x-build-lines">
      ${BUILD_PHASES.map((p, i) => html`
        <div key=${i} class=${"x-build-line " + (i < phase ? "done" : i === phase ? "active" : "")}>
          <span class="x-build-dot"></span>${p}
        </div>`)}
    </div>
  </div>`;
}

/* ---------- experience renderer ---------- */
function Experience({ spec, trace, sources }) {
  const [shown, setShown] = useState(false);
  const [openSources, setOpenSources] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShown(true), 40); return () => clearTimeout(t); }, []);
  const accent = (spec.theme && spec.theme.accent) || "#10b981";
  const style = { "--xa": accent };
  const srcs = sources || [];

  return html`
    <div class=${"x-exp mood-" + ((spec.theme && spec.theme.mood) || "cool")} style=${style}>
      <div class="x-exp-frame">
        <div class="x-exp-bar"><span></span><span></span><span></span><em>${spec.title || "Generated experience"}</em></div>
        <div class="x-exp-body">
          ${(spec.sections || []).map((s, i) => html`
            <div key=${i} class=${"x-sec " + (shown ? "in" : "")} style=${{ transitionDelay: i * 110 + "ms" }}>
              <${Section} s=${s} />
            </div>`)}
        </div>
      </div>

      <div class="x-ground">
        <div class="x-ground-head">
          ${srcs.length > 0
            ? html`<button class="x-ground-toggle" onClick=${() => setOpenSources((v) => !v)}>
                <span class="x-ground-caret">${openSources ? "▾" : "▸"}</span>
                Grounded on <strong>${srcs.length}</strong> live source${srcs.length === 1 ? "" : "s"}
              </button>`
            : html`<span class="muted">Built live from the Sitefinity MCP</span>`}
          ${trace && trace.length > 0 && html`<div class="x-ground-tools">
            ${trace.map((t, i) => html`<span key=${i} class=${"chip" + (t.ok ? "" : " err")}>${(t.name || "").replace("sitefinity_", "")}</span>`)}
          </div>`}
        </div>
        ${openSources && srcs.length > 0 && html`
          <div class="x-src-grid">
            ${srcs.map((s, i) => html`<${SourceCard} key=${i} s=${s} />`)}
          </div>`}
      </div>
    </div>`;
}

function SourceCard({ s }) {
  const href = s.siteUrl || s.apiUrl || null;
  const inner = html`
    <div class="x-src-top">
      <span class="x-src-type">${s.type || "item"}</span>
      ${s.date && html`<span class="x-src-date">${fmtDate(s.date)}</span>`}
    </div>
    <div class="x-src-title">${s.title}</div>
    ${href && html`<span class="x-src-link">open ↗</span>`}`;
  return href
    ? html`<a class="x-src" href=${href} target="_blank" rel="noopener">${inner}</a>`
    : html`<div class="x-src">${inner}</div>`;
}

function Section({ s }) {
  switch (s.type) {
    case "hero":
      return html`<header class="xs-hero">
        ${s.kicker && html`<div class="xs-kicker">${s.kicker}</div>`}
        <h1>${s.heading}</h1>
        ${s.sub && html`<p>${stripHtml(s.sub)}</p>`}
        ${s.cta && html`<button class="xs-cta">${s.cta}</button>`}
      </header>`;
    case "stats":
      return html`<div class="xs-stats">
        ${(s.items || []).map((it, i) => html`<div key=${i} class="xs-stat"><div class="xs-statv">${it.value}</div><div class="xs-statl">${it.label}</div></div>`)}
      </div>`;
    case "grid":
      return html`<section class="xs-block">
        ${s.heading && html`<h2>${s.heading}</h2>`}
        ${s.sub && html`<p class="xs-sub">${stripHtml(s.sub)}</p>`}
        <div class="xs-grid">
          ${(s.items || []).map((it, i) => html`<article key=${i} class="xs-card" style=${{ animationDelay: i * 60 + "ms" }}>
            ${it.tag && html`<span class="xs-tag">${it.tag}</span>`}
            <h3>${stripHtml(it.title)}</h3>
            ${it.summary && html`<p>${stripHtml(it.summary)}</p>`}
            ${it.meta && html`<div class="xs-meta">${stripHtml(it.meta)}</div>`}
          </article>`)}
        </div>
      </section>`;
    case "gallery":
      return html`<section class="xs-block">
        ${s.heading && html`<h2>${s.heading}</h2>`}
        <div class="xs-gallery">
          ${(s.items || []).map((it, i) => html`<figure key=${i} class="xs-tile">
            ${it.image ? html`<img src=${it.image} loading="lazy" alt="" onError=${(e) => (e.target.style.display = "none")} />` : html`<div class="xs-tile-ph"></div>`}
            <figcaption><strong>${stripHtml(it.title)}</strong>${it.caption && html`<span>${stripHtml(it.caption)}</span>`}</figcaption>
          </figure>`)}
        </div>
      </section>`;
    case "feature":
      return html`<section class="xs-feature">
        <h2>${s.heading}</h2>
        ${s.body && html`<p>${stripHtml(s.body)}</p>`}
        ${Array.isArray(s.points) && s.points.length > 0 && html`<ul>${s.points.map((p, i) => html`<li key=${i}>${stripHtml(p)}</li>`)}</ul>`}
      </section>`;
    case "list":
      return html`<section class="xs-block">
        ${s.heading && html`<h2>${s.heading}</h2>`}
        <div class="xs-list">
          ${(s.items || []).map((it, i) => html`<div key=${i} class="xs-row"><span class="xs-rowt">${stripHtml(it.title)}</span>${it.meta && html`<span class="xs-rowm">${stripHtml(it.meta)}</span>`}</div>`)}
        </div>
      </section>`;
    case "quote":
      return html`<blockquote class="xs-quote"><p>“${stripHtml(s.text)}”</p>${s.attribution && html`<cite>— ${stripHtml(s.attribution)}</cite>`}</blockquote>`;
    default:
      return null;
  }
}

/* ============================================================
   ATLAS — interactive content constellation
   ============================================================ */
const CAT = {
  content: { label: "Content", color: "#10b981", cx: 330, cy: 300 },
  media: { label: "Media", color: "#22d3ee", cx: 730, cy: 235 },
  taxonomy: { label: "Taxonomy", color: "#a78bfa", cx: 765, cy: 470 },
  system: { label: "System", color: "#64748b", cx: 300, cy: 500 },
};
const STAGE_W = 1000, STAGE_H = 600;

function layout(types) {
  const byCat = {};
  for (const t of types) (byCat[t.category] ||= []).push(t);
  const maxCount = Math.max(1, ...types.map((t) => t.count || 0));
  const nodes = [];
  for (const [cat, list] of Object.entries(byCat)) {
    const c = CAT[cat] || CAT.system;
    list.sort((a, b) => (b.count || 0) - (a.count || 0));
    const spread = 60 + list.length * 7;
    list.forEach((t, i) => {
      const ang = i * 2.399963; // golden angle
      const r = spread * Math.sqrt(i / Math.max(1, list.length));
      let x = c.cx + r * Math.cos(ang);
      let y = c.cy + r * Math.sin(ang);
      x = Math.max(46, Math.min(STAGE_W - 46, x));
      y = Math.max(46, Math.min(STAGE_H - 46, y));
      const size = 26 + Math.sqrt((t.count || 0) / maxCount) * 64;
      nodes.push({ ...t, x, y, size, color: c.color, hub: { x: c.cx, y: c.cy } });
    });
  }
  return nodes;
}

function Atlas() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [items, setItems] = useState(null);
  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => {
    fetch("/api/atlas").then((r) => r.json()).then((d) => {
      if (d.error) setError(d.error); else setData(d);
    }).catch((e) => setError(e.message));
  }, []);

  const nodes = useMemo(() => (data ? layout(data.types) : []), [data]);

  const pick = useCallback(async (n) => {
    setSelected(n);
    setItems(null);
    setLoadingItems(true);
    try {
      const r = await callTool("sitefinity_query_items", { type: n.type, top: 6, orderby: ["LastModified desc"] });
      setItems(Array.isArray(r?.value) ? r.value : []);
    } catch {
      setItems([]);
    } finally { setLoadingItems(false); }
  }, []);

  if (error) return html`<div class="x-empty panel"><h3>Atlas unavailable</h3><p class="muted">${error}</p></div>`;
  if (!data) return html`<div class="x-empty panel"><div class="spinner"></div> Mapping the content universe…</div>`;

  return html`
    <div class="x-atlas">
      <div class="x-intro">
        <h3>The content universe — live.</h3>
        <p class="muted">${data.types.length} content types · ${data.total.toLocaleString()} items, sized by live count and grouped by kind. Click any node to pull real items through the MCP on the spot.</p>
      </div>
      <div class="x-atlas-legend">
        ${Object.entries(CAT).map(([k, v]) => html`<span key=${k} class="x-leg"><i style=${{ background: v.color }}></i>${v.label}</span>`)}
      </div>
      <div class=${"x-stage-wrap" + (selected ? " has-panel" : "")}>
        <div class="x-stage" style=${{ aspectRatio: STAGE_W + " / " + STAGE_H }}>
          <svg class="x-links" viewBox=${`0 0 ${STAGE_W} ${STAGE_H}`} preserveAspectRatio="none">
            ${nodes.map((n, i) => html`<line key=${i} x1=${n.hub.x} y1=${n.hub.y} x2=${n.x} y2=${n.y} stroke=${n.color} stroke-opacity="0.18" stroke-width="1" />`)}
            ${Object.values(CAT).map((c, i) => html`<circle key=${i} cx=${c.cx} cy=${c.cy} r="4" fill=${c.color} fill-opacity="0.5" />`)}
          </svg>
          ${nodes.map((n, i) => html`
            <button key=${n.type} class=${"x-node" + (selected && selected.type === n.type ? " active" : "")}
              title=${`${n.type}: ${n.count == null ? "—" : n.count.toLocaleString()} items`}
              style=${{
                left: (n.x / STAGE_W) * 100 + "%",
                top: (n.y / STAGE_H) * 100 + "%",
                width: n.size + "px", height: n.size + "px",
                background: `radial-gradient(circle at 35% 30%, ${n.color}, ${n.color}22)`,
                borderColor: n.color,
                opacity: n.count == null ? 0.5 : 1,
                animationDelay: (i % 12) * 0.25 + "s",
              }}
              onClick=${() => pick(n)}>
              <span class="x-node-label">${n.type}</span>
            </button>`)}
        </div>
        ${selected && html`<${AtlasPanel} node=${selected} items=${items} loading=${loadingItems} onClose=${() => setSelected(null)} />`}
      </div>
    </div>`;
}

function AtlasPanel({ node, items, loading, onClose }) {
  return html`
    <aside class="x-panel" style=${{ "--nc": node.color }}>
      <div class="x-panel-head">
        <div>
          <div class="x-panel-type">${node.type}</div>
          <div class="x-panel-meta">${node.count == null ? "—" : node.count.toLocaleString()} items · ${node.fields} fields · ${node.category}</div>
        </div>
        <button class="btn btn--ghost btn--sm" onClick=${onClose}>✕</button>
      </div>
      ${loading && html`<div class="x-empty"><div class="spinner"></div> Fetching live items…</div>`}
      ${!loading && items && items.length === 0 && html`<div class="x-empty muted">No items returned.</div>`}
      ${!loading && items && items.length > 0 && html`
        <div class="x-panel-items">
          ${items.map((it, i) => html`<div key=${i} class="x-panel-item">
            <div class="x-panel-title">${stripHtml(it.Title || it.Name || it.UrlName || it.Id || "(untitled)")}</div>
            ${fmtDate(it.PublicationDate || it.LastModified) && html`<div class="x-panel-date">${fmtDate(it.PublicationDate || it.LastModified)}</div>`}
          </div>`)}
        </div>`}
      ${node.relations && node.relations.length > 0 && html`<div class="x-panel-rel"><span class="muted">relations:</span> ${node.relations.join(", ")}</div>`}
    </aside>`;
}

/* ============================================================
   RAG LAB — grounded ask + semantic-vs-keyword compare
   ============================================================ */
function RagLab() {
  const [tab, setTab] = useState("ask");
  return html`
    <div class="x-raglab">
      <div class="x-intro">
        <h3>Progress Agentic RAG, live on this site.</h3>
        <p class="muted">The same Sitefinity content, now semantically indexed. Ask grounded questions, or see exactly how meaning-based retrieval beats keyword search.</p>
      </div>
      <div class="x-subtabs">
        <button class=${tab === "ask" ? "is-active" : ""} onClick=${() => setTab("ask")}>Grounded Ask</button>
        <button class=${tab === "compare" ? "is-active" : ""} onClick=${() => setTab("compare")}>Semantic vs Keyword</button>
        <button class=${tab === "investigate" ? "is-active" : ""} onClick=${() => setTab("investigate")}>Investigate</button>
      </div>
      ${tab === "ask" ? html`<${GroundedAsk} />` : tab === "compare" ? html`<${CompareView} />` : html`<${Investigate} />`}
    </div>`;
}

const ASK_PRESETS = [
  "What can I eat for lunch at Coriander Lane?",
  "Is the food healthy and locally sourced?",
  "Anything fun for kids or families?",
  "How does the restaurant give back to the community?",
];

function GroundedAsk() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const run = useCallback(async (text) => {
    const question = (text ?? q).trim();
    if (!question || status === "loading") return;
    setQ(question); setStatus("loading"); setError(""); setData(null);
    try {
      const res = await fetch("/api/rag/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Ask failed");
      setData(j); setStatus("done");
    } catch (e) { setError(e.message); setStatus("error"); }
  }, [q, status]);

  return html`
    <div class="x-ask">
      <div class="x-bar">
        <input class="input" placeholder="Ask anything about the site…" value=${q}
          onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && run()} />
        <button class="btn btn--primary" disabled=${status === "loading"} onClick=${() => run()}>
          ${status === "loading" ? "Thinking…" : "Ask"}
        </button>
      </div>
      <div class="x-presets">
        ${ASK_PRESETS.map((p) => html`<button key=${p} class="x-chip" disabled=${status === "loading"} onClick=${() => run(p)}>${p}</button>`)}
      </div>

      ${status === "loading" && html`<div class="x-empty panel"><div class="spinner"></div> Retrieving & grounding via Agentic RAG…</div>`}
      ${status === "error" && html`<div class="x-empty panel"><p class="muted">${error}</p></div>`}
      ${status === "done" && data && html`
        <div class="x-answer panel">
          <div class="x-answer-head">
            <span class=${"x-ground-badge " + (data.grounded ? "ok" : "low")}>
              ${data.grounded ? "✓ Grounded" : "⚠ Low confidence"}
            </span>
            <span class="muted">via Progress Agentic RAG · ${data.sources.length} source${data.sources.length === 1 ? "" : "s"}</span>
          </div>
          <div class="x-answer-body">${formatAnswer(data.answer)}</div>
          ${data.relations && data.relations.length > 0 && html`
            <div class="x-rel">
              <div class="subhead">Entities & relations</div>
              <div class="chips">${data.relations.slice(0, 18).map((r, i) => html`<span key=${i} class="chip nav">${r.from} → ${r.label} → ${r.to}</span>`)}</div>
            </div>`}
          ${data.sources.length > 0 && html`
            <div class="x-answer-sources">
              <div class="subhead">Grounded on</div>
              <div class="x-src-grid">
                ${data.sources.map((s, i) => html`<div key=${i} class="x-src"><div class="x-src-title">${s.title}</div>${s.slug && html`<div class="x-src-top"><span class="x-src-type">${(s.slug.split("-")[0])}</span></div>`}</div>`)}
              </div>
            </div>`}
        </div>`}
    </div>`;
}

function formatAnswer(text) {
  return html`<div class="md" dangerouslySetInnerHTML=${{ __html: markdownToHtml(text) }}></div>`;
}

const CMP_PRESETS = ["lunch", "sustainability", "kids", "fundraiser", "global flavours"];

function CompareView({ initial = "", auto = false } = {}) {
  const [q, setQ] = useState(initial);
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(null);

  const run = useCallback(async (text) => {
    const query = (text ?? q).trim();
    if (!query || status === "loading") return;
    setQ(query); setStatus("loading"); setData(null);
    try {
      const res = await fetch("/api/rag/compare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Compare failed");
      setData(j); setStatus("done");
    } catch (e) { setData({ error: e.message }); setStatus("done"); }
  }, [q, status]);

  useEffect(() => { if (auto && initial) run(initial); }, []);

  return html`
    <div class="x-compare2">
      <div class="x-bar">
        <input class="input" placeholder="Try a word the title search would miss…" value=${q}
          onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && run()} />
        <button class="btn btn--primary" disabled=${status === "loading"} onClick=${() => run()}>Compare</button>
      </div>
      <div class="x-presets">
        ${CMP_PRESETS.map((p) => html`<button key=${p} class="x-chip" disabled=${status === "loading"} onClick=${() => run(p)}>${p}</button>`)}
      </div>

      ${status === "loading" && html`<div class="x-empty panel"><div class="spinner"></div> Running both searches…</div>`}
      ${status === "done" && data && !data.error && html`
        <div class="x-cmp-grid">
          <div class="x-cmp-col">
            <div class="x-cmp-head keyword"><span>Sitefinity keyword</span><em>OData contains()</em></div>
            ${data.keyword.length === 0
              ? html`<div class="x-cmp-empty">No title contains “${data.query}”.</div>`
              : data.keyword.map((k, i) => html`<div key=${i} class="x-cmp-item"><span class="x-cmp-type">${k.type}</span><div>${stripHtml(k.title)}</div></div>`)}
          </div>
          <div class="x-cmp-col">
            <div class="x-cmp-head semantic"><span>Agentic RAG semantic</span><em>meaning-based</em></div>
            ${data.semantic.length === 0
              ? html`<div class="x-cmp-empty">No matches.</div>`
              : data.semantic.map((s, i) => html`<div key=${i} class="x-cmp-item"><div class="x-cmp-st"><strong>${stripHtml(s.title)}</strong><span class="x-cmp-score">${s.score}</span></div><div class="x-cmp-snip">${stripHtml(s.text).slice(0, 160)}…</div></div>`)}
          </div>
        </div>
        <p class="muted x-cmp-note">Keyword search only matches the literal string in titles. Agentic RAG understands intent — surfacing relevant passages from across all content (and inside documents), even with no keyword overlap.</p>`}
      ${status === "done" && data && data.error && html`<div class="x-empty panel"><p class="muted">${data.error}</p></div>`}
    </div>`;
}

const INV_PRESETS = [
  "Which dishes are safe for a gluten allergy?",
  "How does Coriander Lane support its local community?",
  "What's the story behind the brand's sustainability push?",
];

function Investigate() {
  const [q, setQ] = useState("");
  const [stages, setStages] = useState([]);
  const [answer, setAnswer] = useState(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async (text) => {
    const question = (text ?? q).trim();
    if (!question || running) return;
    setQ(question); setRunning(true); setStages([]); setAnswer(null);
    try {
      const res = await fetch("/api/rag/investigate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt; try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.type === "stage") {
            setStages((prev) => {
              const idx = prev.findIndex((s) => s.stage === evt.stage);
              if (idx >= 0) { const copy = prev.slice(); copy[idx] = evt; return copy; }
              return [...prev, evt];
            });
          } else if (evt.type === "done") {
            setAnswer({ answer: evt.answer, grounded: evt.grounded, sources: evt.sources || [] });
          } else if (evt.type === "error") {
            setAnswer({ answer: "⚠️ " + evt.error, grounded: false, sources: [] });
          }
        }
      }
    } catch (e) {
      setAnswer({ answer: "⚠️ " + e.message, grounded: false, sources: [] });
    } finally { setRunning(false); }
  }, [q, running]);

  return html`
    <div class="x-inv">
      <p class="muted">A multi-step retrieval agent: it fans out across the semantic knowledge base <em>and</em> live Sitefinity records (over MCP), synthesizes a grounded answer, and validates it — streamed stage by stage.</p>
      <div class="x-bar">
        <input class="input" placeholder="Ask something that spans sources…" value=${q}
          onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && run()} />
        <button class="btn btn--primary" disabled=${running} onClick=${() => run()}>${running ? "Investigating…" : "Investigate"}</button>
      </div>
      <div class="x-presets">${INV_PRESETS.map((p) => html`<button key=${p} class="x-chip" disabled=${running} onClick=${() => run(p)}>${p}</button>`)}</div>

      ${stages.length > 0 && html`<div class="inv-pipe">
        ${stages.map((s, i) => html`<div key=${i} class=${"inv-stage inv-" + s.status}>
          <div class="inv-rail"><span class="inv-dot">${s.status === "running" ? html`<span class="spinner"></span>` : "✓"}</span></div>
          <div class="inv-body">
            <div class="inv-title">${s.title}</div>
            ${s.detail && html`<div class="inv-detail">${s.detail}</div>`}
            ${s.items && s.items.length > 0 && html`<div class="inv-items">${s.items.map((it, j) => html`<div key=${j} class="inv-item">${stripHtml(it)}</div>`)}</div>`}
            ${s.stage === "synth" && s.answer && html`<div class="inv-answer">${formatAnswer(s.answer)}</div>`}
            ${s.stage === "validate" && html`<span class=${"x-ground-badge " + (s.grounded ? "ok" : "low")}>${s.grounded ? "✓ Grounded" : "⚠ Low confidence"}</span>`}
          </div>
        </div>`)}
      </div>`}

      ${answer && answer.sources && answer.sources.length > 0 && html`<div class="x-answer-sources"><div class="subhead">Cited sources</div><div class="x-src-grid">${answer.sources.map((s, i) => html`<div key=${i} class="x-src"><div class="x-src-title">${s.title}</div></div>`)}</div></div>`}
    </div>`;
}

/* ============================================================
   DEMO — guided narrative (the front door)
   ============================================================ */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function callToolLogged(name, args, logWire) {
  const t = performance.now();
  try {
    const data = await callTool(name, args);
    logWire({ tool: name, ms: Math.round(performance.now() - t), ok: true });
    return data;
  } catch (e) {
    logWire({ tool: name, ms: Math.round(performance.now() - t), ok: false });
    return null;
  }
}

function Demo() {
  const [ai, setAi] = useState({ aiEnabled: false, ragEnabled: false });
  useEffect(() => { fetch("/api/info").then((r) => r.json()).then(setAi).catch(() => {}); }, []);

  return html`
    <div class="demo">
      <section class="demo-hero">
        <div class="demo-kicker">Live · Sitefinity MCP × Progress Agentic RAG</div>
        <h1>Your CMS, now <em>understood</em> — not just searched.</h1>
        <p>Everything below is live. This is the website of <strong>Coriander Lane</strong>, a (fictional) restaurant chain, running in <strong>Sitefinity CMS</strong> and exposed over the Model Context Protocol. Real visitors ask for "lunch", "something healthy", "anything for the kids" — almost never the exact words an editor put in a title. <strong>That gap is why keyword search fails and meaning-based retrieval matters.</strong> Watch it happen in four steps.</p>
      </section>

      <${DemoAct} n=${1} title="Ask something keyword search can't answer" sub="The server picks tools, falls back to meaning, and cites its sources — with real MCP traffic on the right.">
        <${NarratedAsk} question="What can I eat for lunch at Coriander Lane?" keyword="lunch" />
      <//>

      <${DemoAct} n=${2} title="Here's why it works" sub="Same content. Same query. One understands what you meant.">
        <${CompareView} initial="sustainability" auto=${true} />
      <//>

      <${DemoAct} n=${3} title="Now build a whole page from that same content" sub="A plain-English brief → live CMS data over MCP → a rendered, grounded experience.">
        ${ai.aiEnabled
          ? html`<${Compose} aiEnabled=${true} />`
          : html`<div class="x-empty panel"><p class="muted">Set ANTHROPIC_API_KEY to enable generative Compose.</p></div>`}
      <//>

      <${DemoAct} n=${4} title="It's all real — go verify" sub="Drop into the raw tool surface, the content map, or the live protocol log.">
        <div class="demo-verify">
          ${[
            { t: "Tool Playground", d: "Call any MCP tool directly and see the JSON-RPC.", v: "playground" },
            { t: "Atlas", d: "The whole content universe, sized by live counts.", v: "studio" },
            { t: "Wire log", d: "Every call is real MCP protocol traffic.", v: "wire" },
            { t: "Content & Query", d: "Browse and filter the raw CMS over OData.", v: "library" },
          ].map((c, i) => html`<button key=${i} class="demo-vcard" onClick=${() => gotoView(c.v)}>
            <div class="demo-vt">${c.t} →</div><div class="demo-vd muted">${c.d}</div>
          </button>`)}
        </div>
      <//>
    </div>`;
}

// Bridge to the vanilla app's tab switching / wire drawer.
function gotoView(v) {
  if (v === "wire") { document.getElementById("wireToggle")?.click(); return; }
  document.querySelector(`.tab[data-view="${v}"]`)?.click();
}

function DemoAct({ n, title, sub, children }) {
  return html`
    <section class="demo-act">
      <div class="demo-act-h">
        <span class="demo-step">${n}</span>
        <div><h2>${title}</h2><p class="muted">${sub}</p></div>
      </div>
      ${children}
    </section>`;
}

function deriveKeyword(s) {
  const words = String(s || "").toLowerCase().match(/[a-z]{4,}/g) || [];
  const stop = new Set(["what", "which", "this", "that", "with", "from", "have", "does", "your", "about", "there", "they", "will", "when", "where", "coriander", "lane", "restaurant", "here", "some", "give", "tell"]);
  const cand = words.filter((w) => !stop.has(w)).sort((a, b) => b.length - a.length);
  return cand[0] || words[0] || "food";
}

function NarratedAsk({ question, keyword }) {
  const blank = (k) => [
    { key: "kw", label: `Keyword search for "${k}"`, tool: "sitefinity_search_items", status: "idle", result: null },
    { key: "sem", label: "Meaning-based search", tool: "sitefinity_semantic_search", status: "idle", result: null },
    { key: "ans", label: "Grounded answer", tool: "sitefinity_grounded_answer", status: "idle", result: null },
  ];
  const [q, setQ] = useState(question);
  const [kw, setKw] = useState(keyword);
  const [steps, setSteps] = useState(() => blank(keyword));
  const [wire, setWire] = useState([]);
  const [answer, setAnswer] = useState(null);
  const [running, setRunning] = useState(false);

  const setStep = (key, patch) => setSteps((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const logWire = (e) => setWire((w) => [...w, e]);

  const play = useCallback(async (questionArg) => {
    if (running) return;
    const Q = (questionArg ?? q).trim();
    if (!Q) return;
    const K = deriveKeyword(Q);
    setQ(Q); setKw(K);
    setRunning(true); setAnswer(null); setWire([]); setSteps(blank(K));

    setStep("kw", { status: "running" });
    const kwRes = await callToolLogged("sitefinity_search_items", { type: "newsitems", term: K, top: 5 }, logWire);
    const kwCount = Array.isArray(kwRes?.value) ? kwRes.value.length : 0;
    setStep("kw", { status: "done", result: { count: kwCount } });
    await wait(550);

    setStep("sem", { status: "running" });
    const semRes = await callToolLogged("sitefinity_semantic_search", { query: Q, top: 6 }, logWire);
    const sem = semRes?.results || [];
    const seenT = new Set();
    const topTitles = [];
    for (const r of sem) {
      const t = String(r.title || "").trim().toLowerCase();
      if (!t || seenT.has(t)) continue;
      seenT.add(t); topTitles.push(r.title);
      if (topTitles.length >= 3) break;
    }
    setStep("sem", { status: "done", result: { count: sem.length, top: topTitles } });
    await wait(550);

    setStep("ans", { status: "running" });
    const ansRes = await callToolLogged("sitefinity_grounded_answer", { question: Q }, logWire);
    setStep("ans", { status: "done", result: { sources: (ansRes?.sources || []).length } });
    setAnswer(ansRes);
    setRunning(false);
  }, [q, running]);

  useEffect(() => { play(question); }, []);

  return html`
    <div class="na">
      <div class="na-main">
        <div class="na-input">
          <input class="input" value=${q} disabled=${running}
            onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && play()}
            placeholder="Ask your own question — it runs live…" />
          <button class="btn btn--primary btn--sm" disabled=${running} onClick=${() => play()}>${running ? "Running…" : "Run live"}</button>
        </div>
        <div class="na-steps">
          ${steps.map((s) => html`<${NaStep} key=${s.key} s=${s} keyword=${kw} />`)}
        </div>
        ${answer && html`
          <div class="na-answer">
            <div class="x-answer-head">
              <span class=${"x-ground-badge " + (answer.grounded ? "ok" : "low")}>${answer.grounded ? "✓ Grounded" : "⚠ Low confidence"}</span>
              <span class="muted">via Progress Agentic RAG · ${(answer.sources || []).length} sources</span>
            </div>
            <div class="x-answer-body">${formatAnswer(answer.answer)}</div>
            ${(answer.sources || []).length > 0 && html`<div class="msg-trace">${answer.sources.slice(0, 8).map((s, i) => html`<span key=${i} class="chip src-chip">${s.title}</span>`)}</div>`}
          </div>`}
        <div class="na-actions">
          <button class="btn btn--ghost btn--sm" disabled=${running} onClick=${() => { setQ(question); play(question); }}>↻ Replay hero question</button>
        </div>
      </div>
      <aside class="na-wire">
        <div class="na-wire-h">◇ Live MCP traffic</div>
        <div class="na-wire-body">
          ${wire.length === 0 ? html`<div class="muted" style=${{ fontSize: "12px" }}>waiting…</div>`
            : wire.map((w, i) => html`<div key=${i} class=${"na-wire-row" + (w.ok ? "" : " err")}>
                <span class="na-wire-m">→ tools/call</span>
                <span class="na-wire-t">${w.tool.replace("sitefinity_", "")}</span>
                <span class="na-wire-ms">${w.ms}ms</span>
              </div>`)}
        </div>
      </aside>
    </div>`;
}

function NaStep({ s, keyword }) {
  const icon = s.status === "done" ? "✓" : s.status === "running" ? html`<span class="spinner"></span>` : "○";
  let detail = null;
  if (s.status === "done" && s.key === "kw") {
    detail = s.result.count === 0
      ? html`<span class="na-bad">0 matches — the word "${keyword}" isn't in any title.</span>`
      : html`<span>${s.result.count} title match(es).</span>`;
  } else if (s.status === "done" && s.key === "sem") {
    detail = html`<span class="na-good">${s.result.count} relevant passages</span>${s.result.top?.length ? html` · ${s.result.top.map(stripHtml).join(" · ")}` : null}`;
  } else if (s.status === "done" && s.key === "ans") {
    detail = html`<span class="na-good">answer ready</span> · ${s.result.sources} sources cited`;
  }
  return html`<div class=${"na-step na-" + s.status}>
    <span class="na-step-i">${icon}</span>
    <div class="na-step-b"><div class="na-step-l">${s.label}</div>${detail && html`<div class="na-step-d">${detail}</div>`}</div>
  </div>`;
}

/* ============================================================
   GRAPH ATLAS — knowledge graph of extracted entities
   ============================================================ */
const GROUP_COLORS = { PERSON: "#22d3ee", GPE: "#a78bfa", LOC: "#a78bfa", FAC: "#10b981", ORG: "#f59e0b", NORP: "#f472b6", DATE: "#64748b", TIME: "#64748b", EVENT: "#34d399", PRODUCT: "#fbbf24", MONEY: "#fbbf24", MISC: "#94a3b8", MAIL: "#94a3b8" };
const GROUP_LABEL = { PERSON: "People", GPE: "Places", LOC: "Places", FAC: "Places/venues", ORG: "Organizations", NORP: "Nationalities", DATE: "Dates", TIME: "Times", EVENT: "Events", PRODUCT: "Products", MONEY: "Money", MISC: "Other", MAIL: "Email" };
const gColor = (g) => GROUP_COLORS[g] || "#94a3b8";
const GW = 1000, GH = 620;

function computeGraphLayout(entities, edges) {
  const n = entities.length;
  const idx = new Map(entities.map((e, i) => [e.value, i]));
  const pos = entities.map((e, i) => {
    const a = i * 2.399963;
    const r = Math.min(GW, GH) * 0.42 * Math.sqrt((i + 1) / n);
    return { x: GW / 2 + r * Math.cos(a), y: GH / 2 + r * Math.sin(a), vx: 0, vy: 0 };
  });
  const E = edges.map((e) => [idx.get(e.from), idx.get(e.to), e.weight]).filter(([a, b]) => a != null && b != null);
  const k = Math.sqrt((GW * GH) / Math.max(1, n)) * 0.62;
  for (let iter = 0; iter < 160; iter++) {
    const t = 1 - iter / 160;
    for (let i = 0; i < n; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        let d = Math.hypot(dx, dy) || 0.01;
        const rep = (k * k) / d;
        fx += (dx / d) * rep; fy += (dy / d) * rep;
      }
      pos[i].vx = fx; pos[i].vy = fy;
    }
    for (const [a, b, w] of E) {
      let dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
      let d = Math.hypot(dx, dy) || 0.01;
      const att = ((d * d) / k) * (0.5 + (0.5 * Math.min(w, 4)) / 4);
      const ax = (dx / d) * att, ay = (dy / d) * att;
      pos[a].vx -= ax; pos[a].vy -= ay; pos[b].vx += ax; pos[b].vy += ay;
    }
    for (let i = 0; i < n; i++) {
      pos[i].vx += (GW / 2 - pos[i].x) * 0.03;
      pos[i].vy += (GH / 2 - pos[i].y) * 0.03;
      const sp = Math.hypot(pos[i].vx, pos[i].vy) || 0.01;
      const max = 26 * t + 2;
      const f = Math.min(sp, max) / sp;
      pos[i].x += pos[i].vx * f * 0.08; pos[i].y += pos[i].vy * f * 0.08;
      pos[i].x = Math.max(34, Math.min(GW - 34, pos[i].x));
      pos[i].y = Math.max(28, Math.min(GH - 28, pos[i].y));
    }
  }
  return pos;
}

function GraphAtlas() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(null);

  useEffect(() => {
    fetch("/api/rag/graph").then((r) => r.json()).then((d) => {
      if (d.error) setError(d.error); else setData(d);
    }).catch((e) => setError(e.message));
  }, []);

  const layout = useMemo(() => (data ? computeGraphLayout(data.entities, data.edges) : []), [data]);
  const idx = useMemo(() => (data ? new Map(data.entities.map((e, i) => [e.value, i])) : new Map()), [data]);
  const neighbors = useMemo(() => {
    if (!data || !sel) return null;
    const set = new Set([sel]);
    for (const e of data.edges) { if (e.from === sel) set.add(e.to); if (e.to === sel) set.add(e.from); }
    return set;
  }, [data, sel]);

  if (error) return html`<div class="x-empty panel"><h3>Graph unavailable</h3><p class="muted">${error}</p></div>`;
  if (!data) return html`<div class="x-empty panel"><div class="spinner"></div> Extracting the knowledge graph…</div>`;

  const maxDeg = Math.max(1, ...data.entities.map((e) => e.degree));
  const groupsPresent = [...new Set(data.entities.map((e) => e.group))];

  return html`
    <div class="x-graph">
      <div class="x-intro">
        <h3>The knowledge graph inside your content.</h3>
        <p class="muted">${data.entities.length} entities Agentic RAG automatically extracted from the Sitefinity content (people, places, organizations, dates…), linked where they co-occur across ${data.resourceCount} resources. Click any entity to trace its connections.</p>
      </div>
      <div class="x-atlas-legend">
        ${[...new Set(groupsPresent.map((g) => GROUP_LABEL[g] || g))].map((label) => {
          const g = groupsPresent.find((x) => (GROUP_LABEL[x] || x) === label);
          return html`<span key=${label} class="x-leg"><i style=${{ background: gColor(g) }}></i>${label}</span>`;
        })}
      </div>
      <div class="x-stage" style=${{ aspectRatio: GW + " / " + GH }}>
        <svg viewBox=${`0 0 ${GW} ${GH}`} preserveAspectRatio="xMidYMid meet" style=${{ width: "100%", height: "100%" }}>
          ${data.edges.map((e, i) => {
            const a = layout[idx.get(e.from)], b = layout[idx.get(e.to)];
            if (!a || !b) return null;
            const active = neighbors && (e.from === sel || e.to === sel);
            const op = neighbors ? (active ? 0.5 : 0.04) : Math.min(0.06 + e.weight * 0.03, 0.22);
            return html`<line key=${i} x1=${a.x} y1=${a.y} x2=${b.x} y2=${b.y} stroke=${active ? "#10b981" : "#ffffff"} stroke-opacity=${op} stroke-width=${active ? 1.5 : 1} />`;
          })}
          ${data.entities.map((e, i) => {
            const p = layout[i]; if (!p) return null;
            const r = 6 + Math.sqrt(e.degree / maxDeg) * 16;
            const dim = neighbors && !neighbors.has(e.value);
            const showLabel = sel === e.value || (!sel && e.degree / maxDeg > 0.45);
            return html`<g key=${e.value} class="g-node" style=${{ opacity: dim ? 0.2 : 1, cursor: "pointer" }}
              onClick=${() => setSel(sel === e.value ? null : e.value)}>
              <circle cx=${p.x} cy=${p.y} r=${r} fill=${gColor(e.group)} fill-opacity=${sel === e.value ? 1 : 0.85}
                stroke=${sel === e.value ? "#fff" : gColor(e.group)} stroke-width=${sel === e.value ? 2 : 1} />
              ${(showLabel || dim === false) && html`<text x=${p.x} y=${p.y - r - 4} text-anchor="middle" class="g-label" fill="#e8eef5">${e.value}</text>`}
            </g>`;
          })}
        </svg>
      </div>
      ${sel && html`<${GraphInfo} data=${data} sel=${sel} onClose=${() => setSel(null)} />`}
    </div>`;
}

function GraphInfo({ data, sel, onClose }) {
  const ent = data.entities.find((e) => e.value === sel);
  const linked = data.edges
    .filter((e) => e.from === sel || e.to === sel)
    .map((e) => ({ name: e.from === sel ? e.to : e.from, weight: e.weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12);
  return html`
    <div class="x-panel" style=${{ "--nc": gColor(ent?.group) }}>
      <div class="x-panel-head">
        <div>
          <div class="x-panel-type">${sel}</div>
          <div class="x-panel-meta">${GROUP_LABEL[ent?.group] || ent?.group} · ${linked.length} connection${linked.length === 1 ? "" : "s"}</div>
        </div>
        <button class="btn btn--ghost btn--sm" onClick=${onClose}>✕</button>
      </div>
      <div class="x-panel-rel"><span class="muted">co-occurs with</span></div>
      <div class="chips">${linked.map((l, i) => html`<span key=${i} class="chip nav">${l.name}${l.weight > 1 ? ` ×${l.weight}` : ""}</span>`)}</div>
    </div>`;
}

/* ============================================================
   APP shell
   ============================================================ */
function App() {
  const [mode, setMode] = useState("compose");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [ragEnabled, setRagEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/info").then((r) => r.json()).then((i) => {
      setAiEnabled(!!i.aiEnabled);
      setRagEnabled(!!i.ragEnabled);
    }).catch(() => {});
  }, []);

  return html`
    <div class="x-shell">
      <div class="x-head">
        <div>
          <h2>✨ Studio <span class="x-badge">art of the possible</span></h2>
          <p class="muted">Digital experiences generated live from a CMS over the Model Context Protocol.</p>
        </div>
        <div class="x-modes">
          <button class=${mode === "compose" ? "is-active" : ""} onClick=${() => setMode("compose")}>Compose</button>
          <button class=${mode === "atlas" ? "is-active" : ""} onClick=${() => setMode("atlas")}>Atlas</button>
          ${ragEnabled && html`<button class=${mode === "rag" ? "is-active" : ""} onClick=${() => setMode("rag")}>RAG Lab</button>`}
          ${ragEnabled && html`<button class=${mode === "graph" ? "is-active" : ""} onClick=${() => setMode("graph")}>Graph</button>`}
        </div>
      </div>
      ${mode === "compose" ? html`<${Compose} aiEnabled=${aiEnabled} />`
        : mode === "atlas" ? html`<${Atlas} />`
        : mode === "graph" ? html`<${GraphAtlas} />`
        : html`<${RagLab} />`}
    </div>`;
}

const rootEl = document.getElementById("studio-root");
if (rootEl) createRoot(rootEl).render(html`<${App} />`);

const demoEl = document.getElementById("demo-root");
if (demoEl) createRoot(demoEl).render(html`<${Demo} />`);
