/**
 * Generates org-pdftools compatible links for PDF annotations.
 * Link format: [[pdf:PATH::PAGE++HEIGHT;;annot-PAGE-KEY][Page N]]:
 */

export interface AnnotationPosition {
  pageIndex: number;
  rects?: number[][];
}

export interface AnnotationLinkData {
  annotationPageLabel: string;
  annotationPosition: string;
  key: string;
}

export class OrgPdfToolsLink {
  /**
   * Generate org-pdftools compatible link with colon postfix.
   * Format: [[pdf:path::page++height;;annot-id][description]]:
   */
  static generate(pdfPath: string, annotation: AnnotationLinkData): string {
    const page = parseInt(annotation.annotationPageLabel) || 1;
    const position = this.parsePosition(annotation.annotationPosition);
    const height = this.calculateHeight(position);
    const annotId = `annot-${page}-${annotation.key}`;

    const linkTarget = `pdf:${pdfPath}::${page}++${height.toFixed(2)};;${annotId}`;
    const description = `Page ${page}`;

    return `[[${linkTarget}][${description}]]:`;
  }

  /**
   * Generate a simple page link without annotation ID.
   */
  static generatePageLink(
    pdfPath: string,
    page: number,
    height: number = 0,
  ): string {
    const linkTarget = `pdf:${pdfPath}::${page}++${height.toFixed(2)}`;
    return `[[${linkTarget}][Page ${page}]]:`;
  }

  private static parsePosition(positionJson: string): AnnotationPosition {
    try {
      return JSON.parse(positionJson);
    } catch {
      return { pageIndex: 0 };
    }
  }

  private static calculateHeight(position: AnnotationPosition): number {
    // Calculate relative height from rects if available.
    // rects format: [[x1, y1, x2, y2], ...]
    // y values are typically in PDF coordinates where higher = lower on page
    if (position.rects && position.rects.length > 0) {
      const firstRect = position.rects[0];
      if (firstRect && firstRect.length >= 4) {
        const y = firstRect[1];
        // If y is already normalized (0-1), convert to percentage
        if (y <= 1) {
          return y * 100;
        }
        // Otherwise assume standard PDF page height (~792 for letter)
        return Math.min((y / 792) * 100, 100);
      }
    }
    return 0.0;
  }
}
