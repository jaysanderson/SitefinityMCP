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
    let semantic = [];
    try {
      const f = await arag.find(q, { top: 8 });
      semantic = f.paragraphs.map((p) => ({
        title: p.title,
        text: p.text,
        score: Math.round((p.score || 0) * 1000) / 1000,
      }));
    } catch {
      semantic = [];
    }

    return { query: q, keyword, semantic };
  }

  return { ask, compare };
}
