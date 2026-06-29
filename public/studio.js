/* ============================================================
   Studio — React showcase of "art of the possible" experiences
   built on the Sitefinity MCP server.

   Loaded as an ES module from a CDN (no build step, no npm) to honour
   the project's zero-dependency constraint while still being real React.

   Two flagship experiences:
     • Compose — natural language → live MCP data → a rendered microsite
     • Atlas   — an interactive constellation of the whole content universe
   ============================================================ */

import React, { useState, useEffect, useRef, useMemo, useCallback }
  from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);

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
const fmtDate = (d) => (d ? String(d).replace("T", " ").replace("Z", "").slice(0, 16) : "");

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
      ${status === "done" && spec && html`<${Experience} spec=${spec} trace=${trace} key=${spec.title || Math.random()} />`}
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
function Experience({ spec, trace }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShown(true), 40); return () => clearTimeout(t); }, []);
  const accent = (spec.theme && spec.theme.accent) || "#10b981";
  const style = { "--xa": accent };

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
      ${trace && trace.length > 0 && html`
        <div class="x-prov">
          <span class="muted">Built live from</span>
          ${trace.map((t, i) => html`<span key=${i} class=${"chip" + (t.ok ? "" : " err")}>${(t.name || "").replace("sitefinity_", "")}</span>`)}
        </div>`}
    </div>`;
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
            ${(it.PublicationDate || it.LastModified) && html`<div class="x-panel-date">${fmtDate(it.PublicationDate || it.LastModified)}</div>`}
          </div>`)}
        </div>`}
      ${node.relations && node.relations.length > 0 && html`<div class="x-panel-rel"><span class="muted">relations:</span> ${node.relations.join(", ")}</div>`}
    </aside>`;
}

/* ============================================================
   APP shell
   ============================================================ */
function App() {
  const [mode, setMode] = useState("compose");
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/info").then((r) => r.json()).then((i) => setAiEnabled(!!i.aiEnabled)).catch(() => {});
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
        </div>
      </div>
      ${mode === "compose" ? html`<${Compose} aiEnabled=${aiEnabled} />` : html`<${Atlas} />`}
    </div>`;
}

const rootEl = document.getElementById("studio-root");
if (rootEl) createRoot(rootEl).render(html`<${App} />`);
