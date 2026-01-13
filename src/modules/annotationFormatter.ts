/**
 * Formats Zotero annotations as org-mode blocks.
 *
 * Annotation type mapping:
 * - highlight, underline → #+begin_quote / #+end_quote
 * - note → #+begin_comment / #+end_comment
 * - image, ink → #+begin_example with placeholder
 */

import { OrgPdfToolsLink } from "./orgPdfToolsLink";

export interface ZoteroAnnotation {
  annotationType: "highlight" | "underline" | "note" | "image" | "ink";
  annotationText?: string;
  annotationComment?: string;
  annotationPageLabel: string;
  annotationPosition: string;
  annotationColor?: string;
  annotationSortIndex?: string;
  key: string;
  getTags(): Array<{ tag: string }>;
}

export class AnnotationFormatter {
  /**
   * Format a single annotation as org-mode text.
   * Output order: link (with colon), block, optional comment, optional tags.
   */
  static format(annotation: ZoteroAnnotation, pdfPath: string): string {
    const type = annotation.annotationType;

    switch (type) {
      case "highlight":
      case "underline":
        return this.formatHighlight(annotation, pdfPath);
      case "note":
        return this.formatNote(annotation, pdfPath);
      case "image":
        return this.formatImage(annotation, pdfPath);
      case "ink":
        return this.formatInk(annotation, pdfPath);
      default:
        return this.formatGeneric(annotation, pdfPath);
    }
  }

  private static formatHighlight(
    annot: ZoteroAnnotation,
    pdfPath: string,
  ): string {
    const link = OrgPdfToolsLink.generate(pdfPath, annot);
    const text = annot.annotationText || "";
    const comment = annot.annotationComment;
    const tags = this.formatTags(annot);

    let output = "";

    // Link first (above the block)
    output += link + "\n";

    // Quote block for highlighted/underlined text
    output += "#+begin_quote\n";
    output += text.trim() + "\n";
    output += "#+end_quote\n";

    // Comment as separate paragraph (below block)
    if (comment && comment.trim()) {
      output += "\n" + comment.trim() + "\n";
    }

    // Tags on their own line
    if (tags) {
      output += tags + "\n";
    }

    return output;
  }

  private static formatNote(annot: ZoteroAnnotation, pdfPath: string): string {
    const link = OrgPdfToolsLink.generate(pdfPath, annot);
    const comment = annot.annotationComment || "";
    const tags = this.formatTags(annot);

    let output = "";

    // Link first
    output += link + "\n";

    // Comment block for standalone notes
    output += "#+begin_comment\n";
    output += comment.trim() + "\n";
    output += "#+end_comment\n";

    if (tags) {
      output += tags + "\n";
    }

    return output;
  }

  private static formatImage(annot: ZoteroAnnotation, pdfPath: string): string {
    const link = OrgPdfToolsLink.generate(pdfPath, annot);
    const comment = annot.annotationComment;
    const page = annot.annotationPageLabel;
    const tags = this.formatTags(annot);

    let output = "";

    output += link + "\n";
    output += "#+begin_example\n";
    output += `[Image annotation on page ${page}]\n`;
    output += "#+end_example\n";

    if (comment && comment.trim()) {
      output += "\n" + comment.trim() + "\n";
    }

    if (tags) {
      output += tags + "\n";
    }

    return output;
  }

  private static formatInk(annot: ZoteroAnnotation, pdfPath: string): string {
    const link = OrgPdfToolsLink.generate(pdfPath, annot);
    const comment = annot.annotationComment;
    const page = annot.annotationPageLabel;
    const tags = this.formatTags(annot);

    let output = "";

    output += link + "\n";
    output += "#+begin_example\n";
    output += `[Ink/drawing annotation on page ${page}]\n`;
    output += "#+end_example\n";

    if (comment && comment.trim()) {
      output += "\n" + comment.trim() + "\n";
    }

    if (tags) {
      output += tags + "\n";
    }

    return output;
  }

  private static formatGeneric(
    annot: ZoteroAnnotation,
    pdfPath: string,
  ): string {
    const link = OrgPdfToolsLink.generate(pdfPath, annot);
    const text = annot.annotationText || annot.annotationComment || "";

    return `${link}\n${text.trim()}\n`;
  }

  private static formatTags(annot: ZoteroAnnotation): string {
    const tags = annot.getTags();
    if (!tags || tags.length === 0) return "";

    // Org-mode tag format: :tag1:tag2:tag3:
    const tagStr = tags
      .map((t) => t.tag.replace(/\s+/g, "_").replace(/:/g, "-"))
      .join(":");
    return `:${tagStr}:`;
  }
}
