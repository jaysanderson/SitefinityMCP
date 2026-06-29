/**
 * Helpers for building Sitefinity OData query strings.
 *
 * Sitefinity's Web Services API is OData v4 and supports the standard system
 * query options ($filter, $select, $orderby, $top, $skip, $count, $expand,
 * $search) plus Sitefinity params sf_culture, sf_site, sf_provider.
 */

/** OData string-literal escaping: single quotes are doubled. */
export function odataString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Build a contains() filter across one or more fields, OR-ed together. */
export function buildContainsFilter(term, fields) {
  const lit = odataString(term);
  return fields.map((f) => `contains(${f},${lit})`).join(" or ");
}

/**
 * Serialize OData options into a query string (without the leading "?").
 * @param {object} opts
 */
export function buildQueryString(opts = {}) {
  const params = new URLSearchParams();

  if (opts.filter) params.set("$filter", opts.filter);
  if (Array.isArray(opts.select) && opts.select.length) params.set("$select", opts.select.join(","));
  if (Array.isArray(opts.orderby) && opts.orderby.length) params.set("$orderby", opts.orderby.join(","));
  if (typeof opts.top === "number") params.set("$top", String(opts.top));
  if (typeof opts.skip === "number") params.set("$skip", String(opts.skip));
  if (Array.isArray(opts.expand) && opts.expand.length) params.set("$expand", opts.expand.join(","));
  if (opts.count) params.set("$count", "true");
  if (opts.search) params.set("$search", opts.search);

  if (opts.culture) params.set("sf_culture", opts.culture);
  if (opts.site) params.set("sf_site", opts.site);
  if (opts.provider) params.set("sf_provider", opts.provider);

  return params.toString();
}
