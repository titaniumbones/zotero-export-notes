/**
 * Main export orchestration for PDF annotations to org-mode.
 */

import {
  AnnotationFormatter,
  ZoteroAnnotation,
} from "./annotationFormatter";
import { MetadataFormatter } from "./metadataFormatter";

export class Exporter {
  /**
   * Export annotations from multiple items.
   */
  static async exportItems(items: Zotero.Item[]): Promise<void> {
    for (const item of items) {
      await this.exportItem(item);
    }
  }

  /**
   * Export annotations from a single item to an org file.
   */
  static async exportItem(item: Zotero.Item): Promise<void> {
    // Get PDF attachment(s)
    const attachments: Zotero.Item[] = [];

    if (item.isPDFAttachment?.()) {
      attachments.push(item);
    } else if (item.isRegularItem()) {
      const attachmentIDs = item.getAttachments();
      for (const id of attachmentIDs) {
        const att = await Zotero.Items.getAsync(id);
        if (att && att.attachmentContentType === "application/pdf") {
          attachments.push(att);
        }
      }
    }

    if (attachments.length === 0) {
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: "No PDF attachments found",
          type: "fail",
        })
        .show();
      return;
    }

    // Generate org content
    let orgContent = "";

    // Get parent item for metadata
    const parentItem = item.isRegularItem()
      ? item
      : item.parentItemID
        ? await Zotero.Items.getAsync(item.parentItemID)
        : null;

    if (parentItem) {
      orgContent += MetadataFormatter.format(parentItem);
    }

    let totalAnnotations = 0;

    // Process each attachment
    for (const attachment of attachments) {
      const annotations = attachment.getAnnotations() as unknown as ZoteroAnnotation[];
      if (!annotations || annotations.length === 0) continue;

      totalAnnotations += annotations.length;

      // Sort by page and position
      annotations.sort((a, b) => {
        const pageA = parseInt(a.annotationPageLabel) || 0;
        const pageB = parseInt(b.annotationPageLabel) || 0;
        if (pageA !== pageB) return pageA - pageB;
        return (a.annotationSortIndex || "").localeCompare(
          b.annotationSortIndex || "",
        );
      });

      const filePath = await attachment.getFilePath();
      if (!filePath) {
        ztoolkit.log("Could not get file path for attachment:", attachment.key);
        continue;
      }

      for (const annot of annotations) {
        orgContent += AnnotationFormatter.format(annot, filePath);
        orgContent += "\n";
      }
    }

    if (totalAnnotations === 0) {
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: "No annotations found in PDF(s)",
          type: "fail",
        })
        .show();
      return;
    }

    // Prompt for save location
    const defaultFilename = this.generateFilename(parentItem || item);
    const savePath = await this.promptSaveLocation(defaultFilename);

    if (savePath) {
      await Zotero.File.putContentsAsync(savePath, orgContent);
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `Exported ${totalAnnotations} annotations to ${savePath}`,
          type: "success",
        })
        .show();
    }
  }

  private static generateFilename(item: Zotero.Item): string {
    let title = "annotations";
    try {
      title = (item.getField("title") as string) || "annotations";
    } catch {
      // Use default
    }
    // Sanitize filename: remove special chars, limit length
    const safeTitle = title
      .replace(/[^a-zA-Z0-9\-_\s]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 50);
    return `${safeTitle}.org`;
  }

  private static async promptSaveLocation(
    defaultFilename: string,
  ): Promise<string | null> {
    const path = await new ztoolkit.FilePicker(
      "Save Org File",
      "save",
      [["Org Files (*.org)", "*.org"]],
      defaultFilename,
    ).open();

    if (path) {
      // Ensure .org extension
      return path.endsWith(".org") ? path : path + ".org";
    }
    return null;
  }
}
