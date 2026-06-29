/**
 * Minimal, dependency-free parser for an OData v4 $metadata (CSDL/XML) document.
 *
 * We only extract what the MCP tools need:
 *   - the list of entity sets exposed by the service container
 *   - for each entity set, the underlying entity type's properties and
 *     navigation properties (the latter drive $expand suggestions)
 *
 * This is what makes the server "generated from the live API": the tool surface,
 * the type enum, and per-type field lists all come from this parse.
 */

/** Decode the handful of XML entities that appear in attribute values. */
function unescapeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Last segment of a fully-qualified type name (namespace.Type → Type). */
function localName(fqn) {
  if (!fqn) return fqn;
  // Strip Collection(...) wrapper if present.
  const inner = fqn.replace(/^Collection\((.*)\)$/, "$1");
  const parts = inner.split(".");
  return parts[parts.length - 1];
}

/**
 * Parse an EntityType block's inner XML into property + navigation lists.
 */
function parseTypeBody(body) {
  const properties = [];
  for (const m of body.matchAll(/<Property\s+Name="([^"]+)"\s+Type="([^"]+)"([^>]*)>?/g)) {
    const extra = m[3] || "";
    const nullable = !/Nullable="false"/.test(extra);
    properties.push({
      name: unescapeXml(m[1]),
      type: unescapeXml(m[2]),
      nullable,
    });
  }

  const navigationProperties = [];
  for (const m of body.matchAll(/<NavigationProperty\s+Name="([^"]+)"\s+Type="([^"]+)"/g)) {
    const fqn = unescapeXml(m[2]);
    navigationProperties.push({
      name: unescapeXml(m[1]),
      type: fqn,
      collection: /^Collection\(/.test(fqn),
    });
  }

  return { properties, navigationProperties };
}

/**
 * Parse a full $metadata XML string.
 * @returns {{
 *   entitySets: Array<{name:string, entityType:string, typeLocalName:string, properties:Array, navigationProperties:Array}>,
 *   byName: Record<string, object>
 * }}
 */
export function parseMetadata(xml) {
  // 1. Index every EntityType by its local name.
  const typesByLocalName = new Map();
  for (const m of xml.matchAll(/<EntityType\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/EntityType>/g)) {
    const name = unescapeXml(m[1]);
    typesByLocalName.set(name, parseTypeBody(m[2]));
  }

  // 2. Read the EntitySet → EntityType mappings from the container(s).
  const entitySets = [];
  const byName = {};
  for (const m of xml.matchAll(/<EntitySet\s+Name="([^"]+)"\s+EntityType="([^"]+)"/g)) {
    const name = unescapeXml(m[1]);
    const entityType = unescapeXml(m[2]);
    const tln = localName(entityType);
    const body = typesByLocalName.get(tln) || { properties: [], navigationProperties: [] };
    const entry = {
      name,
      entityType,
      typeLocalName: tln,
      properties: body.properties,
      navigationProperties: body.navigationProperties,
    };
    entitySets.push(entry);
    byName[name] = entry;
  }

  entitySets.sort((a, b) => a.name.localeCompare(b.name));
  return { entitySets, byName };
}
