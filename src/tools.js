/**
 * MCP tool definitions for reading/querying Sitefinity content.
 *
 * The tool set is GENERATED from the live service: at first use we fetch the
 * service $metadata, parse the available entity sets and their fields, and bake
 * the discovered type names into the tool input schemas (the `type` enum). All
 * tools are read-only (GET).
 */

import { SitefinityError } from "./sitefinity.js";
import { buildContainsFilter } from "./odata.js";

const ok = (data) => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});

const fail = (err) => {
  let text;
  if (err instanceof SitefinityError) {
    text =
      `Sitefinity error${err.status ? ` (HTTP ${err.status})` : ""}: ${err.message}` +
      (err.body ? `\n\nResponse body:\n${JSON.stringify(err.body, null, 2)}` : "");
  } else {
    text = `Error: ${err?.message || String(err)}`;
  }
  return { content: [{ type: "text", text }], isError: true };
};

// ---- Reusable JSON Schema fragments for OData options ----------------------

const odataProps = {
  filter: {
    type: "string",
    description:
      "OData $filter expression, e.g. \"contains(Title,'launch')\" or " +
      '"PublicationDate gt 2024-01-01T00:00:00Z". Operators: eq, ne, gt, lt, ge, le, ' +
      "and, or, not, contains(), startswith(), endswith().",
  },
  select: { type: "array", items: { type: "string" }, description: "Fields to return ($select)." },
  orderby: {
    type: "array",
    items: { type: "string" },
    description: 'Sort clauses ($orderby), e.g. ["PublicationDate desc","Title asc"].',
  },
  top: { type: "integer", minimum: 1, maximum: 1000, description: "Max items to return ($top)." },
  skip: { type: "integer", minimum: 0, description: "Items to skip for paging ($skip)." },
  expand: {
    type: "array",
    items: { type: "string" },
    description: 'Related/navigation fields to expand inline ($expand), e.g. ["RelatedEvents"].',
  },
  culture: { type: "string", description: 'Culture/locale (sf_culture), e.g. "en".' },
  site: { type: "string", description: "Site id for multisite installs (sf_site)." },
  provider: { type: "string", description: "Content provider name (sf_provider)." },
};

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function toOptions(args) {
  return pick(args, ["filter", "select", "orderby", "top", "skip", "expand", "culture", "site", "provider"]);
}

/**
 * Build the tool list (with live type enum) and a dispatcher.
 * @param {import('./sitefinity.js').SitefinityClient} client
 */
export async function buildTools(client, arag = null) {
  // Discover the live schema so tool schemas reflect the real API.
  let schema;
  try {
    schema = await client.getSchema();
  } catch {
    schema = { entitySets: [], byName: {} };
  }
  const typeNames = schema.entitySets.map((e) => e.name);
  const typeEnum = typeNames.length ? { enum: typeNames } : {};
  const typeDesc =
    "Entity set name from the live service" +
    (typeNames.length ? ` (one of ${typeNames.length} discovered types).` : ".");

  const typeProp = { type: "string", description: typeDesc, ...typeEnum };

  const tools = [
    {
      name: "sitefinity_list_content_types",
      title: "List content types",
      description:
        "List every content type (entity set) exposed by the live Sitefinity service, with each " +
        "type's key fields and expandable relations. Generated from the service $metadata.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "sitefinity_describe_type",
      title: "Describe a content type",
      description:
        "Return the full field list (name, OData type, nullability) and navigation/relation " +
        "fields for a single content type, as defined in the live $metadata.",
      inputSchema: {
        type: "object",
        properties: { type: typeProp },
        required: ["type"],
        additionalProperties: false,
      },
    },
    {
      name: "sitefinity_query_items",
      title: "Query content items",
      description:
        "Query a collection of content items with full OData support (filter, select, orderby, " +
        "paging, expand, count). Returns the OData JSON response.",
      inputSchema: {
        type: "object",
        properties: {
          type: typeProp,
          ...odataProps,
          count: { type: "boolean", description: "Include total matching count inline (@odata.count)." },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
    {
      name: "sitefinity_get_item",
      title: "Get content item by id",
      description: "Fetch a single content item by its GUID id, optionally selecting/expanding fields.",
      inputSchema: {
        type: "object",
        properties: {
          type: typeProp,
          id: { type: "string", description: "The item's GUID id." },
          select: odataProps.select,
          expand: odataProps.expand,
          culture: odataProps.culture,
          site: odataProps.site,
          provider: odataProps.provider,
        },
        required: ["type", "id"],
        additionalProperties: false,
      },
    },
    {
      name: "sitefinity_search_items",
      title: "Search content items",
      description:
        "Free-text search within a content type. Builds an OData contains() filter across the given " +
        "fields (default [\"Title\"]). Substring match over fields, not a full-text index.",
      inputSchema: {
        type: "object",
        properties: {
          type: typeProp,
          term: { type: "string", description: "Text to search for." },
          fields: {
            type: "array",
            items: { type: "string" },
            description: 'Fields to search (default ["Title"]). Each OR-ed with contains().',
          },
          top: odataProps.top,
          orderby: odataProps.orderby,
          select: odataProps.select,
          culture: odataProps.culture,
          site: odataProps.site,
        },
        required: ["type", "term"],
        additionalProperties: false,
      },
    },
    {
      name: "sitefinity_count_items",
      title: "Count content items",
      description: "Return the number of items in a content type, optionally constrained by an OData $filter.",
      inputSchema: {
        type: "object",
        properties: { type: typeProp, filter: odataProps.filter, culture: odataProps.culture, site: odataProps.site },
        required: ["type"],
        additionalProperties: false,
      },
    },
    {
      name: "sitefinity_get_related",
      title: "Get related items",
      description:
        "Fetch the items related to a content item through a navigation/related-data field, " +
        "e.g. a news item's RelatedEvents.",
      inputSchema: {
        type: "object",
        properties: {
          type: typeProp,
          id: { type: "string", description: "The parent item's GUID id." },
          relationField: { type: "string", description: 'Navigation/related field name, e.g. "RelatedEvents".' },
          top: odataProps.top,
          skip: odataProps.skip,
          orderby: odataProps.orderby,
          select: odataProps.select,
          culture: odataProps.culture,
          site: odataProps.site,
        },
        required: ["type", "id", "relationField"],
        additionalProperties: false,
      },
    },
    {
      name: "sitefinity_get_metadata",
      title: "Get service metadata (schema)",
      description:
        "Fetch the OData $metadata. Returns the discovered entity set names; include raw XML with " +
        "includeXml=true to inspect every type and property.",
      inputSchema: {
        type: "object",
        properties: { includeXml: { type: "boolean", description: "Include the raw $metadata XML." } },
        additionalProperties: false,
      },
    },
    {
      name: "sitefinity_raw_get",
      title: "Raw OData GET",
      description:
        "Escape hatch: issue a raw GET against an arbitrary OData path relative to the service root " +
        '(e.g. "newsitems(<id>)/RelatedEvents"). Use when a dedicated tool does not cover your case.',
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "OData path relative to the service root, no leading slash." },
          ...odataProps,
          count: { type: "boolean" },
          search: { type: "string", description: "Free-text $search term (if supported)." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  ];

  // ARAG-backed tools — only registered when Progress Agentic RAG is configured.
  if (arag) {
    tools.push(
      {
        name: "sitefinity_semantic_search",
        title: "Semantic search (Agentic RAG)",
        description:
          "Meaning-based search over the site's content indexed in Progress Agentic RAG. Unlike " +
          "substring search, this understands intent and finds relevant passages even without exact " +
          "keyword matches. Returns ranked paragraphs with their source resources.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural-language search query." },
            top: { type: "integer", minimum: 1, maximum: 30, description: "Max passages (default 8)." },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        name: "sitefinity_grounded_answer",
        title: "Grounded answer (Agentic RAG)",
        description:
          "Ask a question and get a synthesized, CITED answer grounded in the site's content via " +
          "Progress Agentic RAG (retrieval-augmented generation). Returns the answer plus the source " +
          "resources it was grounded on. Prefer this for 'what/how/why' questions about site content.",
        inputSchema: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question to answer from site content." },
          },
          required: ["question"],
          additionalProperties: false,
        },
      }
    );
  }

  async function call(name, args = {}) {
    try {
      switch (name) {
        case "sitefinity_list_content_types": {
          const s = await client.getSchema();
          return ok({
            serviceRoot: client.serviceRoot,
            count: s.entitySets.length,
            contentTypes: s.entitySets.map((e) => ({
              type: e.name,
              entityType: e.entityType,
              fields: e.properties.map((p) => p.name),
              relations: e.navigationProperties.map((n) => n.name),
            })),
          });
        }
        case "sitefinity_describe_type": {
          const s = await client.getSchema();
          const entry = s.byName[args.type];
          if (!entry) {
            return ok({
              type: args.type,
              found: false,
              available: s.entitySets.map((e) => e.name),
            });
          }
          return ok({
            type: entry.name,
            entityType: entry.entityType,
            properties: entry.properties,
            navigationProperties: entry.navigationProperties,
          });
        }
        case "sitefinity_query_items": {
          const opts = { ...toOptions(args), count: args.count };
          return ok(await client.get(args.type, opts));
        }
        case "sitefinity_get_item": {
          const path = `${args.type}(${args.id})`;
          return ok(await client.get(path, pick(args, ["select", "expand", "culture", "site", "provider"])));
        }
        case "sitefinity_search_items": {
          const fields = args.fields?.length ? args.fields : ["Title"];
          const filter = buildContainsFilter(args.term, fields);
          return ok(
            await client.get(args.type, {
              filter,
              top: args.top ?? 20,
              ...pick(args, ["orderby", "select", "culture", "site"]),
            })
          );
        }
        case "sitefinity_count_items": {
          const count = await client.getCount(args.type, pick(args, ["filter", "culture", "site"]));
          return ok({ type: args.type, count });
        }
        case "sitefinity_get_related": {
          const path = `${args.type}(${args.id})/${args.relationField}`;
          return ok(await client.get(path, pick(args, ["top", "skip", "orderby", "select", "culture", "site"])));
        }
        case "sitefinity_get_metadata": {
          const s = await client.getSchema();
          const entitySets = s.entitySets.map((e) => e.name);
          return args.includeXml ? ok({ entitySets, metadataXml: s.xml }) : ok({ entitySets });
        }
        case "sitefinity_semantic_search": {
          if (!arag) return fail(new Error("Agentic RAG is not configured."));
          const r = await arag.find(args.query, { top: args.top ?? 8 });
          return ok({
            query: args.query,
            results: r.paragraphs.map((p) => ({ title: p.title, text: p.text, score: p.score })),
          });
        }
        case "sitefinity_grounded_answer": {
          if (!arag) return fail(new Error("Agentic RAG is not configured."));
          const r = await arag.ask(args.question);
          return ok({ answer: r.answer, sources: r.sources, citations: r.citations });
        }
        case "sitefinity_raw_get": {
          const opts = { ...toOptions(args), count: args.count, search: args.search };
          return ok(await client.get(args.path, opts));
        }
        default:
          return fail(new Error(`Unknown tool: ${name}`));
      }
    } catch (err) {
      return fail(err);
    }
  }

  return { tools, call };
}
