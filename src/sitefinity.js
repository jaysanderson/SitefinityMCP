/**
 * Dependency-free client for the Sitefinity CMS REST (OData) Web Services API.
 *
 *  - Resolves the OData service root ({baseUrl}/api/{service}).
 *  - Optional OAuth2 password-grant auth with token caching/refresh.
 *  - Live introspection: fetches and caches the service document + $metadata so
 *    the MCP tool surface can be generated from the real API.
 *
 * Uses only Node built-ins (global fetch, available in Node >= 18).
 */

import { buildQueryString } from "./odata.js";
import { parseMetadata } from "./metadata.js";

export class SitefinityError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "SitefinityError";
    this.status = status;
    this.body = body;
  }
}

export class SitefinityClient {
  constructor(config) {
    this.config = config;
    this._token = null; // { accessToken, expiresAt }
    this._schema = null; // parsed metadata { entitySets, byName }
    this._schemaPromise = null;
  }

  /** OData service root, e.g. https://mysite.com/api/default */
  get serviceRoot() {
    return `${this.config.baseUrl}/api/${this.config.serviceName}`;
  }

  buildUrl(path, opts) {
    const clean = String(path).replace(/^\/+/, "");
    const merged = this._applyDefaults(opts || {});
    const qs = buildQueryString(merged);
    return qs ? `${this.serviceRoot}/${clean}?${qs}` : `${this.serviceRoot}/${clean}`;
  }

  _applyDefaults(opts) {
    return {
      ...opts,
      culture: opts.culture ?? this.config.defaultCulture,
      site: opts.site ?? this.config.defaultSiteId,
    };
  }

  /** GET an OData resource and parse JSON. */
  async get(path, opts) {
    return this._request(this.buildUrl(path, opts), "application/json");
  }

  /** GET the raw $metadata document (XML). */
  async getMetadataXml() {
    return this._request(`${this.serviceRoot}/$metadata`, "application/xml", true);
  }

  /** GET a $count endpoint, returning the integer count. */
  async getCount(entity, opts) {
    const merged = this._applyDefaults(opts || {});
    const qs = buildQueryString(merged);
    const base = `${this.serviceRoot}/${String(entity).replace(/^\/+/, "")}/$count`;
    const url = qs ? `${base}?${qs}` : base;
    const text = await this._request(url, "text/plain", true);
    const n = parseInt(String(text).trim(), 10);
    if (Number.isNaN(n)) throw new SitefinityError(`Unexpected $count response: ${text}`);
    return n;
  }

  /**
   * Discover and cache the live schema (entity sets + fields). Concurrent
   * callers share a single in-flight request.
   */
  async getSchema(force = false) {
    if (this._schema && !force) return this._schema;
    if (this._schemaPromise && !force) return this._schemaPromise;
    this._schemaPromise = (async () => {
      const xml = await this.getMetadataXml();
      this._schema = parseMetadata(xml);
      this._schema.xml = xml;
      return this._schema;
    })();
    try {
      return await this._schemaPromise;
    } finally {
      this._schemaPromise = null;
    }
  }

  async _request(url, accept, rawText = false) {
    const headers = { Accept: accept, "User-Agent": "sitefinity-mcp/1.0" };

    if (this.config.authMode === "password") {
      headers.Authorization = `Bearer ${await this._ensureToken()}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let res;
    try {
      res = await fetch(url, { headers, signal: controller.signal });
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new SitefinityError(`Request timed out after ${this.config.timeoutMs}ms: ${url}`);
      }
      throw new SitefinityError(`Network error requesting ${url}: ${err?.message || err}`);
    } finally {
      clearTimeout(timer);
    }

    const bodyText = await res.text();

    if (!res.ok) {
      let parsed = bodyText;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        /* keep as text */
      }
      throw new SitefinityError(
        `Sitefinity returned ${res.status} ${res.statusText} for ${url}`,
        res.status,
        parsed
      );
    }

    if (rawText) return bodyText;
    if (!bodyText) return undefined;
    try {
      return JSON.parse(bodyText);
    } catch {
      return bodyText;
    }
  }

  async _ensureToken() {
    const now = Date.now();
    if (this._token && this._token.expiresAt > now + 5000) return this._token.accessToken;

    const tokenUrl = `${this.config.baseUrl}/sitefinity/oauth/token`;
    const form = new URLSearchParams();
    form.set("grant_type", "password");
    form.set("username", this.config.username || "");
    form.set("password", this.config.password || "");
    form.set("client_id", this.config.clientId);
    if (this.config.clientSecret) form.set("client_secret", this.config.clientSecret);
    form.set("scope", "openid");

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new SitefinityError(
        `OAuth token request failed: ${res.status} ${res.statusText}`,
        res.status,
        text
      );
    }
    const json = JSON.parse(text);
    if (!json.access_token) {
      throw new SitefinityError("OAuth response missing access_token", res.status, json);
    }
    this._token = {
      accessToken: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return this._token.accessToken;
  }
}
