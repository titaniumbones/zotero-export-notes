/**
 * HTTP API endpoint for exporting annotations via citation key.
 *
 * Endpoint: GET http://localhost:23119/export-org/citekey/<citekey>
 *
 * Response: JSON with org-mode formatted annotations
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
 * Checks Better BibTeX first, then falls back to Extra field.
 */
async function findItemByCitekey(citekey: string): Promise<Zotero.Item | null> {
  // Try Better BibTeX API first
  try {
    const bbt = (Zotero as Record<string, unknown>).BetterBibTeX as
      | { KeyManager?: { get: (key: string) => { itemID?: number } | null } }
      | undefined;

    if (bbt?.KeyManager) {
      const result = bbt.KeyManager.get(citekey);
      if (result?.itemID) {
        return (await (
          Zotero as unknown as {
            Items: { getAsync: (id: number) => Promise<Zotero.Item> };
          }
        ).Items.getAsync(result.itemID)) as Zotero.Item;
      }
    }
  } catch {
    // BBT not available, fall back to Extra field search
  }

  // Fall back to searching Extra field for "Citation Key: xxx"
  const libraryID = Zotero.Libraries.userLibraryID;
  const items = Zotero.Items.getAll(libraryID);

  for (const item of items) {
    if (!item.isRegularItem()) continue;

    try {
      const extra = item.getField("extra") as string;
      if (extra) {
        const match = extra.match(/Citation Key:\s*(.+)/i);
        if (match && match[1].trim() === citekey) {
          return item;
        }
      }
    } catch {
      // Skip items that can't be read
    }
  }

  return null;
}

/**
 * HTTP endpoint handler for /export-org/citekey/<citekey>
 */
function CitekeyEndpoint() {
  // @ts-expect-error - Zotero endpoint pattern
  this.supportedMethods = ["GET"];

  // @ts-expect-error - Zotero endpoint pattern
  this.init = async function (
    _data: unknown,
    sendResponseCallback: (
      status: number,
      contentType?: string,
      body?: string,
    ) => void,
  ) {
    // Parse citekey from URL path
    // URL format: /export-org/citekey/<citekey>
    const url = (this as unknown as { pathname?: string }).pathname || "";
    const match = url.match(/\/export-org\/citekey\/(.+)/);

    if (!match || !match[1]) {
      const response: ApiResponse = {
        success: false,
        error: "Missing citekey in URL. Use: /export-org/citekey/<citekey>",
      };
      sendResponseCallback(400, "application/json", JSON.stringify(response));
      return;
    }

    const citekey = decodeURIComponent(match[1]);

    try {
      // Find item by citekey
      const item = await findItemByCitekey(citekey);

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

export class ApiEndpoints {
  /**
   * Register HTTP API endpoints with Zotero's server.
   */
  static register(): void {
    // Register the citekey endpoint
    // The endpoint pattern allows any path after /export-org/citekey/
    Zotero.Server.Endpoints["/export-org/citekey"] = CitekeyEndpoint;

    ztoolkit.log("Registered API endpoint: /export-org/citekey/<citekey>");
  }
}
