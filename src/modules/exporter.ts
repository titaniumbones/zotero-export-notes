/**
 * Main export orchestration for PDF annotations to org-mode.
 */

import {
  AnnotationFormatter,
  ZoteroAnnotation,
} from "./annotationFormatter";
import { MetadataFormatter } from "./metadataFormatter";

interface GenerateResult {
  content: string;
  annotationCount: number;
}

export class Exporter {
  /**
   * Export annotations from multiple items to files.
   */
  static async exportItems(items: Zotero.Item[]): Promise<void> {
    for (const item of items) {
      await this.exportItem(item);
    }
  }

  /**
   * Copy annotations from multiple items to clipboard.
   */
  static async copyItems(items: Zotero.Item[]): Promise<void> {
    let allContent = "";
    let totalAnnotations = 0;

    for (const item of items) {
      const result = await this.generateOrgContent(item);
      if (result) {
        allContent += result.content;
        totalAnnotations += result.annotationCount;
        // Add separator between items if multiple
        if (items.length > 1) {
          allContent += "\n";
        }
      }
    }

    if (totalAnnotations === 0) {
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: "No annotations found",
          type: "fail",
        })
        .show();
      return;
    }

    // Copy to clipboard
    new ztoolkit.Clipboard()
      .addText(allContent, "text/plain")
      .copy();

    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: `Copied ${totalAnnotations} annotations to clipboard`,
        type: "success",
      })
      .show();
  }

  /**
   * Export annotations from a single item to an org file.
   */
  static async exportItem(item: Zotero.Item): Promise<void> {
    const result = await this.generateOrgContent(item);

    if (!result || result.annotationCount === 0) {
      return; // Error already shown by generateOrgContent
    }

    // Get parent item for filename
    const parentItem = item.isRegularItem()
      ? item
      : item.parentItemID
        ? await Zotero.Items.getAsync(item.parentItemID)
        : null;

    // Prompt for save location
    const defaultFilename = this.generateFilename(parentItem || item);
    const savePath = await this.promptSaveLocation(defaultFilename);

    if (savePath) {
      await Zotero.File.putContentsAsync(savePath, result.content);
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `Exported ${result.annotationCount} annotations to ${savePath}`,
          type: "success",
        })
        .show();
    }
  }

  /**
   * Generate org-mode content for an item's annotations.
   * Returns null if no PDF attachments found.
   */
  static async generateOrgContent(
    item: Zotero.Item,
  ): Promise<GenerateResult | null> {
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
      return null;
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
      const annotations =
        attachment.getAnnotations() as unknown as ZoteroAnnotation[];
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
      return null;
    }

    return {
      content: orgContent,
      annotationCount: totalAnnotations,
    };
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
