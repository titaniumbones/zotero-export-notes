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

import { Exporter } from "./exporter";

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
  org?: string;
  error?: string;
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
 * Accepts POST with JSON body: {"key": "<citekey>", "libraryID": <optional>}
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
    // Parse citekey and optional libraryID from POST body
    // Note: GET with query params is not supported by Zotero's server
    let citekey: string | undefined;
    let libraryID: number | undefined;

    if (data && typeof data === "object") {
      const dataObj = data as Record<string, unknown>;
      if (typeof dataObj.key === "string") {
        citekey = dataObj.key;
      }
      if (typeof dataObj.libraryID === "number") {
        libraryID = dataObj.libraryID;
      }
    }

    ztoolkit.log("API request, citekey:", citekey, "libraryID:", libraryID);

    if (!citekey) {
      const response: ApiResponse = {
        success: false,
        error: "Missing 'key' parameter. Use POST with JSON body: {\"key\": \"<citekey>\"}",
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

      // Generate org content
      const result = await Exporter.generateOrgContent(item);

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
        org: result.content,
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
 * Opens Zotero's item picker and returns selected item's citekey
 */
function PickerEndpoint() {
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
    try {
      // Parse optional libraryID
      let libraryID: number | undefined;
      if (data && typeof data === "object") {
        const dataObj = data as Record<string, unknown>;
        if (typeof dataObj.libraryID === "number") {
          libraryID = dataObj.libraryID;
        }
      }

      // Get the main window
      const mainWindow = Zotero.getMainWindow();
      if (!mainWindow) {
        sendResponseCallback(500, "application/json", JSON.stringify({
          success: false,
          error: "Zotero main window not available",
        }));
        return;
      }

      // Focus Zotero window
      mainWindow.focus();

      // Use Zotero's item selection dialog
      const io = {
        singleSelection: true,
        dataOut: null as { id: number } | null,
        libraryID: libraryID,
      };

      // Open the item selector dialog
      (mainWindow as unknown as { openDialog: (url: string, name: string, features: string, io: unknown) => Window }).openDialog(
        "chrome://zotero/content/selectItemsDialog.xhtml",
        "",
        "chrome,dialog=no,modal,centerscreen,resizable=yes",
        io
      );

      // Get the selected item
      if (io.dataOut && io.dataOut.id) {
        const item = await (Zotero as unknown as {
          Items: { getAsync: (id: number) => Promise<Zotero.Item> }
        }).Items.getAsync(io.dataOut.id);

        if (item) {
          // Get citekey from BBT or Extra field
          let citekey: string | null = null;

          // Try BBT
          try {
            const bbt = (Zotero as Record<string, unknown>).BetterBibTeX as Record<string, unknown> | undefined;
            if (bbt?.KeyManager) {
              const km = bbt.KeyManager as { get: (key: string) => { citekey?: string } | null };
              const result = km.get(item.key);
              if (result?.citekey) {
                citekey = result.citekey;
              }
            }
          } catch {
            // BBT not available
          }

          // Fall back to Extra field
          if (!citekey) {
            try {
              const extra = item.getField("extra") as string;
              const match = extra?.match(/Citation Key:\s*(.+)/i);
              if (match) {
                citekey = match[1].trim();
              }
            } catch {
              // No citekey in Extra
            }
          }

          if (citekey) {
            sendResponseCallback(200, "application/json", JSON.stringify({
              success: true,
              citekey,
              title: item.getField("title"),
              itemKey: item.key,
            }));
            return;
          }
        }
      }

      sendResponseCallback(200, "application/json", JSON.stringify({
        success: false,
        error: "No item selected or item has no citation key",
      }));
    } catch (e) {
      sendResponseCallback(500, "application/json", JSON.stringify({
        success: false,
        error: `Error in picker: ${e instanceof Error ? e.message : String(e)}`,
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
    ztoolkit.log("Registered API endpoints: /export-org/citekey, /export-org/libraries, /export-org/picker");
  }
}
