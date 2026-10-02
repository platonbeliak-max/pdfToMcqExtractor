import { PageTextData } from "./pdf-parser";
import {
  normalizeExtractedText,
  isScrambledBijoyText,
  repairMangledBengaliText,
} from "./text-normalizer";
import { performOcr } from "./ocr";

export interface ClientExtractionResult {
  success: boolean;
  totalPages: number;
  pages: PageTextData[];
  fullText: string;
  isScanned: boolean;
  isBijoyScrambled?: boolean;
  error?: string;
}

export interface ClientExtractionOptions {
  forceOcr?: boolean;
  lang?: string;
}

/**
 * Extracts text from a PDF Buffer/Uint8Array directly inside the browser.
 * This completely bypasses server body size limits (e.g. 413 Request Entity Too Large),
 * allowing documents up to 150MB+ to be parsed with zero upload lag.
 * Supports on-demand high-accuracy Tesseract.js OCR rendering for scanned or Bijoy-encoded PDFs.
 */
export async function extractTextFromPDFClient(
  pdfBuffer: ArrayBuffer | Uint8Array,
  onProgress?: (current: number, total: number, message?: string) => void,
  options?: ClientExtractionOptions
): Promise<ClientExtractionResult> {
  try {
    const pdfjs = await import("pdfjs-dist");

    // Served from /public (copied from the installed pdfjs-dist); the unpkg CDN worker was blocked/mismatched and broke parsing.
    if (typeof window !== "undefined") {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    }

    const uint8Data =
      pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer);

    const loadingTask = pdfjs.getDocument({
      data: uint8Data,
      useSystemFonts: true,
    } as any);

    const pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages;

    if (totalPages === 0) {
      return {
        success: false,
        totalPages: 0,
        pages: [],
        fullText: "",
        isScanned: false,
        error: "The PDF document contains 0 pages.",
      };
    }

    const pages: PageTextData[] = [];
    let totalChars = 0;
    let isBijoyScrambled = false;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      onProgress?.(
        pageNum,
        totalPages,
        options?.forceOcr
          ? `Running Bengali OCR on page ${pageNum} of ${totalPages}...`
          : `Extracting page ${pageNum} of ${totalPages}...`
      );

      const page = await pdfDoc.getPage(pageNum);
      let pageRawText = "";

      // 1. If forceOcr requested, render canvas and run Tesseract OCR with Bengali language model
      if (options?.forceOcr && typeof window !== "undefined") {
        try {
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport } as any).promise;
            const dataUrl = canvas.toDataURL("image/png");
            pageRawText = await performOcr(dataUrl, options.lang || "ben+eng");
          }
        } catch (ocrErr) {
          console.warn(`OCR rendering failed for page ${pageNum}, using text stream:`, ocrErr);
        }
      }

      // 2. If OCR was not forced or yielded empty, extract from PDF text content stream
      if (!pageRawText) {
        const textContent = await page.getTextContent();
        let lastY: number | null = null;
        const lines: string[] = [];
        let currentLine = "";

        for (const item of textContent.items) {
          if (!("str" in item)) continue;
          const textItem = item as { str: string; transform?: number[] };
          const currentY = textItem.transform ? textItem.transform[5] : null;

          if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 5) {
            if (currentLine.trim()) {
              lines.push(currentLine.trim());
            }
            currentLine = textItem.str;
          } else {
            currentLine += (currentLine ? " " : "") + textItem.str;
          }
          lastY = currentY;
        }

        if (currentLine.trim()) {
          lines.push(currentLine.trim());
        }

        pageRawText = lines.join("\n");
      }

      // Detect and heuristically repair Bijoy/ANSI font encoding corruptions
      if (isScrambledBijoyText(pageRawText)) {
        isBijoyScrambled = true;
        pageRawText = repairMangledBengaliText(pageRawText);
      }

      const normalizedPageText = normalizeExtractedText(pageRawText);
      const charCount = normalizedPageText.replace(/\s+/g, "").length;
      totalChars += charCount;

      pages.push({
        pageNumber: pageNum,
        text: normalizedPageText,
        charCount,
      });
    }

    const fullText = pages
      .map((p) => `--- PAGE ${p.pageNumber} ---\n${p.text}`)
      .join("\n\n");
    const avgCharsPerPage = totalPages > 0 ? totalChars / totalPages : 0;
    const isScanned = avgCharsPerPage < 25 || options?.forceOcr === true;

    return {
      success: true,
      totalPages,
      pages,
      fullText,
      isScanned,
      isBijoyScrambled,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes("Password") || errorMsg.includes("password")) {
      return {
        success: false,
        totalPages: 0,
        pages: [],
        fullText: "",
        isScanned: false,
        error:
          "Password-protected PDFs are not supported. Please remove the password and re-upload.",
      };
    }
    return {
      success: false,
      totalPages: 0,
      pages: [],
      fullText: "",
      isScanned: false,
      error: `Browser PDF parsing error: ${errorMsg}`,
    };
  }
}
