/**
 * Context menu registration for "Export Annotations to Org".
 */

import { config } from "../../package.json";
import { Exporter } from "./exporter";

/**
 * Get the active ZoteroPane.
 */
function getZoteroPane(): _ZoteroTypes.ZoteroPane | null {
  return Zotero.getActiveZoteroPane() || null;
}

export class MenuFactory {
  /**
   * Register the right-click context menu item for library items.
   */
  static registerItemContextMenu(): void {
    const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;

    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: "zotero-export-org-notes-menu",
      label: "Export Annotations to Org",
      icon: menuIcon,
      commandListener: async () => {
        const zp = getZoteroPane();
        const items = zp?.getSelectedItems();
        if (items && items.length > 0) {
          await Exporter.exportItems(items);
        }
      },
      getVisibility: () => {
        // Show only when items with potential PDF attachments are selected
        const zp = getZoteroPane();
        const items = zp?.getSelectedItems();
        if (!items || items.length === 0) return false;

        return items.some((item: Zotero.Item) => {
          // Show for PDF attachments
          if (item.isPDFAttachment?.()) return true;
          // Show for regular items (which may have PDF attachments)
          if (item.isRegularItem()) return true;
          return false;
        });
      },
    });
  }
}
