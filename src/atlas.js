/**
 * Atlas data: enriches the discovered content types with live item counts and a
 * category, so the React "Atlas" view can render the whole content universe.
 * Counts are gathered in parallel and cached briefly.
 */

const CATEGORY_MAP = {
  // media
  images: "media", videos: "media", documents: "media", albums: "media",
  videolibraries: "media", documentlibraries: "media", folders: "media",
  // taxonomy
  taxonomies: "taxonomy", "flat-taxa": "taxonomy", "hierarchy-taxa": "taxonomy", taxons: "taxonomy",
  // system / config
  sites: "system", calendars: "system", forms: "system", "form-drafts": "system",
  searchindexes: "system", knowledgeboxes: "system", "kb-settings": "system",
  "pipe-settings": "system", servicehooks: "system", templates: "system",
  widgetpresets: "system", notifications: "system", alerts: "system", contentitems: "system",
  // editorial containers
  blogs: "content", lists: "content",
};

function categorize(name) {
  if (CATEGORY_MAP[name]) return CATEGORY_MAP[name];
  return "content"; // news, blogposts, events, listitems, pages + dynamic types
}

export function createAtlasHandler(client) {
  let cache = null;
  let cacheAt = 0;

  return async function atlas() {
    if (cache && Date.now() - cacheAt < 300000) return cache;

    const schema = await client.getSchema();
    const types = await Promise.all(
      schema.entitySets.map(async (e) => {
        let count = null;
        try {
          count = await client.getCount(e.name);
        } catch {
          count = null; // some system types don't support $count
        }
        return {
          type: e.name,
          count,
          category: categorize(e.name),
          fields: e.properties.length,
          relations: e.navigationProperties.map((n) => n.name),
        };
      })
    );

    cache = {
      serviceRoot: client.serviceRoot,
      total: types.reduce((a, b) => a + (b.count || 0), 0),
      types,
    };
    cacheAt = Date.now();
    return cache;
  };
}
