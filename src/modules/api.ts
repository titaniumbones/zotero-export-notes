/**
 * HTTP API endpoint for exporting annotations via citation key.
 *
 * Endpoint: POST http://localhost:<port>/export-org/citekey
 * Body: {"key": "<citekey>", "libraryID": <optional-number>}
 *
 * Response: JSON with org-mode formatted annotations
 *
 * Note: GET requests with query parameters are not supported due to
 * Zotero server limitations. Use POST with JSON body instead.
 */

import { Exporter, ExportFormat } from "./exporter";

// Type declarations for Zotero's server system
declare const Zotero: {
  Server: {
    Endpoints: Record<string, unknown>;
  };
  Items: {
    getAll: (libraryID: number) => Zotero.Item[];
  };
  Libraries: {
    userLibraryID: number;
  };
  getMainWindow: () => { Zotero_Tabs?: unknown } | null;
  [key: string]: unknown;
};

interface ApiResponse {
  success: boolean;
  citekey?: string;
  title?: string;
  annotationCount?: number;
  format?: string;
  content?: string;
  org?: string; // Backwards compatibility
  error?: string;
  // Batch response fields
  itemCount?: number;
  totalAnnotations?: number;
  items?: Array<{
    citekey?: string;
    title: string;
    annotationCount: number;
  }>;
}

/**
 * Find a Zotero item by its citation key.
 * Uses Better BibTeX JSON-RPC API, then falls back to Extra field search.
 * @param citekey - The citation key to look up
 * @param libraryID - Optional library ID (for group libraries)
 */
async function findItemByCitekey(citekey: string, libraryID?: number): Promise<Zotero.Item | null> {
  ztoolkit.log("Looking up citekey:", citekey, "libraryID:", libraryID);

  // Try Better BibTeX JSON-RPC API
  try {
    ztoolkit.log("Trying BBT JSON-RPC API...");

    // Get the server port from Zotero preferences
    const port = (Zotero as unknown as { Prefs: { get: (key: string) => number } }).Prefs.get("httpServer.port") || 23119;
    const url = `http://localhost:${port}/better-bibtex/json-rpc`;

    // BBT item.search accepts optional library parameter
    const params: (string | number)[] = [citekey];
    if (libraryID !== undefined) {
      params.push(libraryID);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "item.search",
        params,
        id: 1,
      }),
    });

    if (response.ok) {
      const data = await response.json() as { result?: Array<{ id?: string; itemKey?: string; libraryID?: number }> };
      ztoolkit.log("BBT JSON-RPC response:", data);

      if (data.result && data.result.length > 0) {
        const bbtItem = data.result[0];

        // Extract item key from the id URL (format: "http://zotero.org/users/XX/items/ITEMKEY")
        let itemKey = bbtItem.itemKey;
        if (!itemKey && bbtItem.id) {
          const match = bbtItem.id.match(/\/items\/([A-Z0-9]+)$/);
          if (match) {
            itemKey = match[1];
          }
        }

        if (itemKey) {
          ztoolkit.log("Found item key:", itemKey);
          const itemLibraryID = libraryID ?? bbtItem.libraryID ?? Zotero.Libraries.userLibraryID;
          const item = await (Zotero as unknown as { Items: { getByLibraryAndKeyAsync: (lib: number, key: string) => Promise<Zotero.Item | null> } })
            .Items.getByLibraryAndKeyAsync(itemLibraryID, itemKey);
          if (item) {
            ztoolkit.log("Found item via BBT:", item.getField("title"));
            return item;
          }
        }
      }
    }
  } catch (e) {
    ztoolkit.log("BBT JSON-RPC lookup failed:", e);
  }

  // Fall back to searching Extra field for "Citation Key: xxx"
  try {
    ztoolkit.log("Trying Extra field search...");
    const s = new (Zotero as unknown as { Search: new () => ZoteroSearch }).Search();
    s.addCondition("extra", "contains", citekey);
    if (libraryID !== undefined) {
      s.addCondition("libraryID", "is", String(libraryID));
    }
    const ids = await s.search();
    ztoolkit.log("Search returned ids:", ids);

    if (ids && ids.length > 0) {
      const items = await (Zotero as unknown as { Items: { getAsync: (ids: number[]) => Promise<Zotero.Item[]> } }).Items.getAsync(ids);

      // Verify exact match
      for (const item of items) {
        if (!item.isRegularItem()) continue;
        try {
          const extra = item.getField("extra") as string;
          if (extra) {
            // Check for Citation Key: pattern or just the citekey itself
            const match = extra.match(/Citation Key:\s*(.+)/i);
            if (match && match[1].trim() === citekey) {
              return item;
            }
            // Also check if citekey appears directly
            if (extra.includes(citekey)) {
              return item;
            }
          }
        } catch {
          // Skip
        }
      }
    }
  } catch (e) {
    ztoolkit.log("Extra field search failed:", e);
  }

  return null;
}

// Type for Zotero Search
interface ZoteroSearch {
  addCondition: (field: string, operator: string, value: string) => void;
  search: () => Promise<number[]>;
}

/**
 * HTTP endpoint handler for /export-org/citekey
 * Accepts POST with JSON body:
 *   Single item: {"key": "<citekey>", "libraryID": <optional>, "format": "org"|"md"}
 *   Batch: {"keys": ["<citekey1>", "<citekey2>"], "libraryID": <optional>, "format": "org"|"md"}
 * Default format is "md" (markdown).
 */
function CitekeyEndpoint() {
  // @ts-expect-error - Zotero endpoint pattern
  this.supportedMethods = ["POST"];
  // @ts-expect-error - Zotero endpoint pattern
  this.permitBookmarklet = false;

  // @ts-expect-error - Zotero endpoint pattern
  this.init = async function (
    data: unknown,
    sendResponseCallback: (
      status: number,
      contentType?: string,
      body?: string,
    ) => void,
  ) {
    // Parse citekey(s), optional libraryID, and format from POST body
    let citekey: string | undefined;
    let citekeys: string[] | undefined;
    let libraryID: number | undefined;
    let format: ExportFormat = "md"; // Default to markdown

    if (data && typeof data === "object") {
      const dataObj = data as Record<string, unknown>;
      if (typeof dataObj.key === "string") {
        citekey = dataObj.key;
      }
      if (Array.isArray(dataObj.keys)) {
        citekeys = dataObj.keys.filter((k): k is string => typeof k === "string");
      }
      if (typeof dataObj.libraryID === "number") {
        libraryID = dataObj.libraryID;
      }
      if (dataObj.format === "org" || dataObj.format === "md") {
        format = dataObj.format;
      }
    }

    // Handle batch request (array of keys)
    if (citekeys && citekeys.length > 0) {
      ztoolkit.log("API batch request, citekeys:", citekeys.length, "libraryID:", libraryID, "format:", format);

      try {
        const items: Zotero.Item[] = [];
        const resolvedCitekeys: string[] = [];
        const notFoundKeys: string[] = [];

        // Resolve each citekey to an item
        for (const key of citekeys) {
          const item = await findItemByCitekey(key, libraryID);
          if (item) {
            items.push(item);
            resolvedCitekeys.push(key);
          } else {
            notFoundKeys.push(key);
          }
        }

        if (items.length === 0) {
          const response: ApiResponse = {
            success: false,
            error: `No items found for citekeys: ${citekeys.join(", ")}`,
          };
          sendResponseCallback(404, "application/json", JSON.stringify(response));
          return;
        }

        // Generate batch content
        const result = await Exporter.generateBatchContent(items, format, resolvedCitekeys);

        if (!result) {
          const response: ApiResponse = {
            success: false,
            error: "No annotations found for any of the specified items",
          };
          sendResponseCallback(404, "application/json", JSON.stringify(response));
          return;
        }

        const response: ApiResponse = {
          success: true,
          itemCount: result.itemCount,
          totalAnnotations: result.totalAnnotations,
          format,
          content: result.content,
          items: result.items,
          // Backwards compatibility
          ...(format === "org" ? { org: result.content } : {}),
          // Include warning if some keys weren't found
          ...(notFoundKeys.length > 0 ? { error: `Items not found: ${notFoundKeys.join(", ")}` } : {}),
        };

        sendResponseCallback(200, "application/json", JSON.stringify(response));
        return;
      } catch (e) {
        const response: ApiResponse = {
          success: false,
          error: `Error processing batch request: ${e instanceof Error ? e.message : String(e)}`,
        };
        sendResponseCallback(500, "application/json", JSON.stringify(response));
        return;
      }
    }

    // Handle single item request (original behavior)
    ztoolkit.log("API request, citekey:", citekey, "libraryID:", libraryID, "format:", format);

    if (!citekey) {
      const response: ApiResponse = {
        success: false,
        error: "Missing 'key' or 'keys' parameter. Use POST with JSON body: {\"key\": \"<citekey>\"} or {\"keys\": [\"key1\", \"key2\"]}",
      };
      sendResponseCallback(400, "application/json", JSON.stringify(response));
      return;
    }

    try {
      // Find item by citekey (with optional libraryID)
      const item = await findItemByCitekey(citekey, libraryID);

      if (!item) {
        const response: ApiResponse = {
          success: false,
          error: `Item not found for citekey: ${citekey}`,
        };
        sendResponseCallback(404, "application/json", JSON.stringify(response));
        return;
      }

      // Generate content in requested format
      const result = await Exporter.generateContent(item, format);

      if (!result) {
        const response: ApiResponse = {
          success: false,
          error: `No annotations found for citekey: ${citekey}`,
        };
        sendResponseCallback(404, "application/json", JSON.stringify(response));
        return;
      }

      // Get title
      let title = "";
      try {
        title = item.getField("title") as string;
      } catch {
        // Title not available
      }

      const response: ApiResponse = {
        success: true,
        citekey,
        title,
        annotationCount: result.annotationCount,
        format,
        content: result.content,
        // Backwards compatibility: also include 'org' field when format is org
        ...(format === "org" ? { org: result.content } : {}),
      };

      sendResponseCallback(200, "application/json", JSON.stringify(response));
    } catch (e) {
      const response: ApiResponse = {
        success: false,
        error: `Error processing request: ${e instanceof Error ? e.message : String(e)}`,
      };
      sendResponseCallback(500, "application/json", JSON.stringify(response));
    }
  };
}

/**
 * HTTP endpoint handler for /export-org/libraries
 * Returns list of available Zotero libraries
 */
function LibrariesEndpoint() {
  // @ts-expect-error - Zotero endpoint pattern
  this.supportedMethods = ["GET", "POST"];
  // @ts-expect-error - Zotero endpoint pattern
  this.permitBookmarklet = false;

  // @ts-expect-error - Zotero endpoint pattern
  this.init = async function (
    _data: unknown,
    sendResponseCallback: (
      status: number,
      contentType?: string,
      body?: string,
    ) => void,
  ) {
    try {
      const libraries: Array<{ id: number; name: string; type: string }> = [];

      // Get all libraries using Zotero API
      const ZoteroLibraries = (Zotero as unknown as {
        Libraries: {
          getAll: () => Array<{ libraryID: number; name: string; libraryType: string }>;
        };
      }).Libraries;

      const allLibraries = ZoteroLibraries.getAll();

      for (const lib of allLibraries) {
        libraries.push({
          id: lib.libraryID,
          name: lib.name || (lib.libraryType === "user" ? "My Library" : `Library ${lib.libraryID}`),
          type: lib.libraryType,
        });
      }

      sendResponseCallback(200, "application/json", JSON.stringify({
        success: true,
        libraries,
      }));
    } catch (e) {
      sendResponseCallback(500, "application/json", JSON.stringify({
        success: false,
        error: `Error listing libraries: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  };
}

/**
 * HTTP endpoint handler for /export-org/picker
 * Returns citekey of currently selected item in Zotero using BBT API
 */
function PickerEndpoint() {
  // @ts-expect-error - Zotero endpoint pattern
  this.supportedMethods = ["GET", "POST"];
  // @ts-expect-error - Zotero endpoint pattern
  this.permitBookmarklet = false;

  // @ts-expect-error - Zotero endpoint pattern
  this.init = async function (
    _data: unknown,
    sendResponseCallback: (
      status: number,
      contentType?: string,
      body?: string,
    ) => void,
  ) {
    try {
      // Focus Zotero window
      const mainWindow = Zotero.getMainWindow() as Window | null;
      if (mainWindow) {
        mainWindow.focus();
      }

      // Use BBT's item.citationkey("selected") to get citekey of selected items
      const port = (Zotero as unknown as { Prefs: { get: (key: string) => number } }).Prefs.get("httpServer.port") || 23119;
      const response = await fetch(`http://localhost:${port}/better-bibtex/json-rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "item.citationkey",
          params: ["selected"],
          id: 1,
        }),
      });

      if (!response.ok) {
        sendResponseCallback(500, "application/json", JSON.stringify({
          success: false,
          error: "Failed to query Better BibTeX",
        }));
        return;
      }

      const data = await response.json() as { result?: Record<string, string | null>; error?: { message: string } };

      if (data.error) {
        sendResponseCallback(500, "application/json", JSON.stringify({
          success: false,
          error: `BBT error: ${data.error.message}`,
        }));
        return;
      }

      if (!data.result || Object.keys(data.result).length === 0) {
        sendResponseCallback(200, "application/json", JSON.stringify({
          success: false,
          error: "No item selected in Zotero. Please select an item first.",
        }));
        return;
      }

      // Get the first citekey from the result
      const entries = Object.entries(data.result);
      const [itemKey, citekey] = entries[0];

      if (!citekey) {
        sendResponseCallback(200, "application/json", JSON.stringify({
          success: false,
          error: "Selected item has no citation key. Ensure Better BibTeX is configured.",
        }));
        return;
      }

      sendResponseCallback(200, "application/json", JSON.stringify({
        success: true,
        citekey,
        itemKey,
      }));
    } catch (e) {
      sendResponseCallback(500, "application/json", JSON.stringify({
        success: false,
        error: `Error in picker: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  };
}

/**
 * HTTP endpoint handler for /export-org/collections
 * Lists all collections in a Zotero library.
 * Accepts POST with JSON body: {"libraryID": <optional>, "recursive": <optional bool>}
 */
function CollectionsListEndpoint() {
  // @ts-expect-error - Zotero endpoint pattern
  this.supportedMethods = ["GET", "POST"];
  // @ts-expect-error - Zotero endpoint pattern
  this.permitBookmarklet = false;

  // @ts-expect-error - Zotero endpoint pattern
  this.init = async function (
    data: unknown,
    sendResponseCallback: (
      status: number,
      contentType?: string,
      body?: string,
    ) => void,
  ) {
    let libraryID: number | undefined;

    if (data && typeof data === "object") {
      const dataObj = data as Record<string, unknown>;
      if (typeof dataObj.libraryID === "number") {
        libraryID = dataObj.libraryID;
      }
    }

    const targetLibraryID = libraryID ?? Zotero.Libraries.userLibraryID;

    try {
      const ZoteroCollections = (Zotero as unknown as {
        Collections: {
          getByLibrary: (libraryID: number) => Array<{
            key: string;
            name: string;
            parentKey: string | null;
          }>;
        };
      }).Collections;

      const collections = ZoteroCollections.getByLibrary(targetLibraryID);

      const result = collections.map((col) => ({
        key: col.key,
        name: col.name,
        parentKey: col.parentKey,
      }));

      sendResponseCallback(200, "application/json", JSON.stringify({
        success: true,
        libraryID: targetLibraryID,
        collections: result,
      }));
    } catch (e) {
      sendResponseCallback(500, "application/json", JSON.stringify({
        success: false,
        error: `Error listing collections: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  };
}

/**
 * HTTP endpoint handler for /export-org/collection
 * Exports all annotations from items in a Zotero collection.
 * Accepts POST with JSON body: {"collectionID": <number>, "recursive": <bool>, "format": "org"|"md", "libraryID": <optional>}
 */
function CollectionEndpoint() {
  // @ts-expect-error - Zotero endpoint pattern
  this.supportedMethods = ["POST"];
  // @ts-expect-error - Zotero endpoint pattern
  this.permitBookmarklet = false;

  // @ts-expect-error - Zotero endpoint pattern
  this.init = async function (
    data: unknown,
    sendResponseCallback: (
      status: number,
      contentType?: string,
      body?: string,
    ) => void,
  ) {
    let collectionKey: string | undefined;
    let recursive = false;
    let libraryID: number | undefined;
    let format: ExportFormat = "md";

    if (data && typeof data === "object") {
      const dataObj = data as Record<string, unknown>;
      // Accept collectionKey (string) or collectionID (string or number for backwards compat)
      if (typeof dataObj.collectionKey === "string") {
        collectionKey = dataObj.collectionKey;
      } else if (typeof dataObj.collectionID === "string") {
        collectionKey = dataObj.collectionID;
      } else if (typeof dataObj.collectionID === "number") {
        collectionKey = String(dataObj.collectionID);
      }
      if (typeof dataObj.recursive === "boolean") {
        recursive = dataObj.recursive;
      }
      if (typeof dataObj.libraryID === "number") {
        libraryID = dataObj.libraryID;
      }
      if (dataObj.format === "org" || dataObj.format === "md") {
        format = dataObj.format;
      }
    }

    ztoolkit.log("Collection API request, collectionKey:", collectionKey, "recursive:", recursive, "format:", format);

    if (!collectionKey) {
      sendResponseCallback(400, "application/json", JSON.stringify({
        success: false,
        error: "Missing 'collectionKey' or 'collectionID' parameter. Use POST with JSON body: {\"collectionKey\": \"<key>\"}",
      }));
      return;
    }

    try {
      // Get collection by key
      const ZoteroCollections = (Zotero as unknown as {
        Collections: {
          getByLibraryAndKeyAsync: (libraryID: number, key: string) => Promise<{
            name: string;
            libraryID: number;
            getChildItems: () => Zotero.Item[];
            getDescendents: (recursive: boolean, type: string) => Array<{ type: string; id: number }>;
          } | null>;
        };
      }).Collections;

      // Use provided libraryID or default to user library
      const targetLibraryID = libraryID ?? Zotero.Libraries.userLibraryID;
      const collection = await ZoteroCollections.getByLibraryAndKeyAsync(targetLibraryID, collectionKey);

      if (!collection) {
        sendResponseCallback(404, "application/json", JSON.stringify({
          success: false,
          error: `Collection not found: ${collectionKey}`,
        }));
        return;
      }

      const collectionName = collection.name;

      // Get items from collection
      let items: Zotero.Item[] = [];

      if (recursive) {
        // Get all descendant items (recursive)
        const descendants = collection.getDescendents(true, "item");
        const itemIDs = descendants
          .filter((d: { type: string }) => d.type === "item")
          .map((d: { id: number }) => d.id);

        if (itemIDs.length > 0) {
          items = await (Zotero as unknown as {
            Items: { getAsync: (ids: number[]) => Promise<Zotero.Item[]> };
          }).Items.getAsync(itemIDs);
        }
      } else {
        // Get direct children only
        items = collection.getChildItems();
      }

      // Filter to regular items only (skip attachments, notes)
      items = items.filter((item) => item.isRegularItem());

      if (items.length === 0) {
        sendResponseCallback(200, "application/json", JSON.stringify({
          success: false,
          collectionName,
          error: "No regular items found in collection",
        }));
        return;
      }

      ztoolkit.log("Found", items.length, "items in collection", collectionName);

      // Generate batch content
      const result = await Exporter.generateBatchContent(items, format);

      if (!result) {
        sendResponseCallback(200, "application/json", JSON.stringify({
          success: false,
          collectionName,
          itemCount: items.length,
          error: "No annotations found in any items",
        }));
        return;
      }

      sendResponseCallback(200, "application/json", JSON.stringify({
        success: true,
        collectionName,
        collectionKey,
        recursive,
        itemCount: result.itemCount,
        totalAnnotations: result.totalAnnotations,
        format,
        content: result.content,
        items: result.items,
        ...(format === "org" ? { org: result.content } : {}),
      }));
    } catch (e) {
      sendResponseCallback(500, "application/json", JSON.stringify({
        success: false,
        error: `Error processing collection: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  };
}

export class ApiEndpoints {
  /**
   * Register HTTP API endpoints with Zotero's server.
   */
  static register(): void {
    Zotero.Server.Endpoints["/export-org/citekey"] = CitekeyEndpoint;
    Zotero.Server.Endpoints["/export-org/libraries"] = LibrariesEndpoint;
    Zotero.Server.Endpoints["/export-org/picker"] = PickerEndpoint;
    Zotero.Server.Endpoints["/export-org/collections"] = CollectionsListEndpoint;
    Zotero.Server.Endpoints["/export-org/collection"] = CollectionEndpoint;
    ztoolkit.log("Registered API endpoints: /export-org/citekey, /export-org/libraries, /export-org/picker, /export-org/collections, /export-org/collection");
  }
}
