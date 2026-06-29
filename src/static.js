/**
 * Tiny static file server for the bundled web UI (public/), using only Node
 * built-ins. Includes path-traversal protection and basic content types.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/**
 * Try to serve a static asset for the given URL path.
 * @returns {Promise<{status:number, headers:object, body:Buffer}|null>} null if no file matched.
 */
export async function tryServeStatic(urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === "/" || rel === "") rel = "/index.html";

  // Resolve against the public dir and ensure we stay inside it.
  const resolved = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!resolved.startsWith(PUBLIC_DIR)) return null;

  try {
    const info = await stat(resolved);
    if (!info.isFile()) return null;
    const body = await readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = TYPES[ext] || "application/octet-stream";
    const cache = ext === ".html" ? "no-cache" : "public, max-age=60";
    return {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": body.length,
        "Cache-Control": cache,
      },
      body,
    };
  } catch {
    return null;
  }
}
