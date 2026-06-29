/**
 * RAG Lab handlers — showcase endpoints combining Progress Agentic RAG with the
 * Sitefinity MCP/OData layer.
 *
 *  - ask:     grounded, cited answer + entity relations (ARAG /ask)
 *  - compare: ARAG semantic /find vs Sitefinity keyword (OData contains()),
 *             side by side — the recall "lift" made visible.
 */

export function createRagHandlers({ arag, client }) {
  async function ask(question) {
    const q = String(question || "").slice(0, 600).trim();
    if (!q) throw new Error("Enter a question.");
    const r = await arag.ask(q);
    const grounded = r.grounded && (r.sources?.length || 0) > 0;
    return {
      question: q,
      answer: r.answer,
      sources: r.sources || [],
      relations: r.relations || [],
      citations: r.citations || null,
      grounded,
    };
  }

  async function compare(query) {
    const q = String(query || "").slice(0, 200).trim();
    if (!q) throw new Error("Enter a query.");
    const esc = q.replace(/'/g, "''");

    // Keyword side — Sitefinity OData substring match (what search looks like today).
    const types = ["newsitems", "blogposts", "events"];
    const keyword = [];
    for (const t of types) {
      try {
        const d = await client.get(t, {
          filter: `contains(Title,'${esc}')`,
          top: 6,
          select: ["Title", "PublicationDate"],
        });
        for (const it of d?.value || []) {
          keyword.push({ type: t, title: it.Title, date: it.PublicationDate || null });
        }
      } catch {
        /* per-type best effort */
      }
    }

    // Semantic side — Agentic RAG meaning-based retrieval across the whole KB.
    // Only surface genuinely relevant matches; near-zero scores undercut the point.
    let semantic = [];
    try {
      const f = await arag.find(q, { top: 12 });
      const seenTitles = new Set();
      semantic = f.paragraphs
        .filter((p) => (p.score || 0) >= 0.08)
        .filter((p) => { const k = (p.title || "").toLowerCase(); if (seenTitles.has(k)) return false; seenTitles.add(k); return true; })
        .slice(0, 6)
        .map((p) => ({ title: p.title, text: p.text, score: Math.round((p.score || 0) * 100) / 100 }));
    } catch {
      semantic = [];
    }

    return { query: q, keyword, semantic };
  }

  // Multi-source investigation: fan out across the semantic KB and live CMS
  // records, synthesize a grounded answer, and validate — streamed stage by
  // stage. This is the "Retrieval Agent" experience, orchestrated by us with
  // the Sitefinity MCP as one of the sources.
  async function investigate(question, onStage) {
    const q = String(question || "").slice(0, 400).trim();
    if (!q) throw new Error("Enter a question.");
    const kw = deriveKeyword(q);
    const emit = (s) => { if (onStage) onStage(s); };

    emit({ stage: "plan", status: "done", title: "Plan retrieval",
      detail: `Fanning out across 2 sources — the semantic knowledge base and live Sitefinity records — for "${q}".` });

    // Source 1: semantic KB
    emit({ stage: "semantic", status: "running", title: "Knowledge base · semantic search" });
    let sem = [];
    try {
      const f = await arag.find(q, { top: 10 });
      sem = f.paragraphs.filter((p) => (p.score || 0) >= 0.08).slice(0, 5)
        .map((p) => ({ title: p.title, score: Math.round((p.score || 0) * 100) / 100 }));
    } catch { /* ignore */ }
    emit({ stage: "semantic", status: "done", title: "Knowledge base · semantic search",
      detail: `${sem.length} relevant passages`, items: sem.map((x) => `${x.title}  (${x.score})`) });

    // Source 2: live structured CMS records (via the Sitefinity MCP/OData client)
    emit({ stage: "structured", status: "running", title: "Live CMS · structured records (OData)" });
    const recs = [];
    const esc = kw.replace(/'/g, "''");
    for (const t of ["newsitems", "events", "blogposts"]) {
      try {
        const d = await client.get(t, { filter: `contains(Title,'${esc}')`, top: 4, select: ["Title"] });
        for (const it of d?.value || []) recs.push(`${t}: ${it.Title}`);
      } catch { /* per-type */ }
    }
    emit({ stage: "structured", status: "done", title: "Live CMS · structured records (OData)",
      detail: `${recs.length} structured matches for "${kw}"`, items: recs });

    // Synthesize
    emit({ stage: "synth", status: "running", title: "Synthesize grounded answer" });
    let answer = "", sources = [], grounded = false;
    try {
      const a = await arag.ask(q);
      answer = a.answer; sources = a.sources || [];
      grounded = a.grounded && sources.length > 0;
    } catch (e) { answer = `Synthesis failed: ${e.message}`; }
    emit({ stage: "synth", status: "done", title: "Synthesize grounded answer", answer, sources });

    // Validate (honest groundedness signal)
    emit({ stage: "validate", status: "done", title: "Groundedness check",
      grounded, detail: grounded ? `Grounded in ${sources.length} cited sources.` : "Low confidence — insufficient grounded context." });

    return { question: q, answer, grounded, sources };
  }

  return { ask, compare, investigate };
}

function deriveKeyword(s) {
  const words = String(s || "").toLowerCase().match(/[a-z]{4,}/g) || [];
  const stop = new Set(["what", "which", "this", "that", "with", "from", "have", "does", "your", "about", "there", "they", "will", "when", "where", "coriander", "lane", "restaurant", "here", "some", "give", "tell", "safe"]);
  const cand = words.filter((w) => !stop.has(w)).sort((a, b) => b.length - a.length);
  return cand[0] || words[0] || "food";
}
