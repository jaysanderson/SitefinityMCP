/* Tiny, safe Markdown → HTML renderer (shared by the chat + RAG answer views).
   Supports: headings, GFM tables, bullet lists, bold/italic, inline code,
   paragraphs. Escapes HTML first so model output can't inject markup. */

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function splitRow(line) {
  let cells = line.split("|");
  if (cells[0].trim() === "") cells = cells.slice(1);
  if (cells.length && cells[cells.length - 1].trim() === "") cells = cells.slice(0, -1);
  return cells.map((c) => c.trim());
}

export function markdownToHtml(md) {
  const lines = String(md ?? "").replace(/\r/g, "").split("\n");
  let out = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // table: a row with pipes followed by a |---|---| separator
    if (line.includes("|") && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i])); i++;
      }
      out += '<table class="md-table"><thead><tr>' +
        header.map((h) => `<th>${inline(h)}</th>`).join("") +
        "</tr></thead><tbody>" +
        rows.map((r) => "<tr>" + header.map((_, c) => `<td>${inline(r[c] ?? "")}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>";
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out += `<h4 class="md-h">${inline(h[2])}</h4>`; i++; continue; }

    // bullet list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++;
      }
      out += '<ul class="md-ul">' + items.map((it) => `<li>${inline(it)}</li>`).join("") + "</ul>";
      continue;
    }

    // blank
    if (/^\s*$/.test(line)) { i++; continue; }

    // paragraph
    const para = [line]; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) &&
           !/^\s*[-*+]\s+/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !lines[i].includes("|")) {
      para.push(lines[i]); i++;
    }
    out += "<p>" + para.map(inline).join("<br>") + "</p>";
  }
  return out;
}
