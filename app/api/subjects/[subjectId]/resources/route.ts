import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { suggestTopics } from "@/lib/topic-suggestions";
import { aiOptionsFromRequest, hasAiProvider } from "@/lib/ai";
import { suggestTopicsWithAi } from "@/lib/ai-topic-suggestions";
import { topicNames } from "@/lib/topic-groups";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ subjectId: string }> };
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 200_000;

export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError("Expected multipart form data"); }
  const uploaded = form.get("file");
  if (!(uploaded instanceof File)) return jsonError("Choose a text, Markdown, or PDF file");
  if (uploaded.size < 1 || uploaded.size > MAX_BYTES) return jsonError("File must be between 1 byte and 10 MB");
  const ext = path.extname(uploaded.name).toLowerCase();
  if (![".txt", ".md", ".pdf"].includes(ext)) return jsonError("Supported file types are .txt, .md, and .pdf");
  const bytes = Buffer.from(await uploaded.arrayBuffer());
  const pdf = ext === ".pdf";
  if (pdf && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") return jsonError("The file does not appear to be a valid PDF");
  if (!pdf && uploaded.type && !["text/plain", "text/markdown", "text/x-markdown", "application/octet-stream"].includes(uploaded.type)) return jsonError("The selected file is not recognized as text");

  let extractedText = "";
  try {
    if (pdf) {
      const parser = new PDFParse({ data: bytes });
      try { extractedText = (await parser.getText()).text; } finally { await parser.destroy(); }
    } else {
      extractedText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
  } catch {
    return jsonError("Could not extract text from this file. Scanned PDFs need OCR and are not supported yet.", 422);
  }
  extractedText = extractedText.replace(/\0/g, "").slice(0, MAX_TEXT);
  const extractionStatus = extractedText.trim() ? "complete" : "empty";
  const id = crypto.randomUUID();
  const dir = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const storagePath = path.join(/* turbopackIgnore: true */ dir, `${id}${ext}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(storagePath, bytes, { flag: "wx" });
    const result = await query(`INSERT INTO resources(id, subject_id, owner_id, filename, content_type, storage_path, extracted_text, extraction_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, filename, content_type AS "contentType", extraction_status AS "extractionStatus",
        summary_status AS "summaryStatus", created_at AS "createdAt"`,
    [id, subjectId, LOCAL_OWNER_ID, path.basename(uploaded.name).slice(0, 255), pdf ? "application/pdf" : "text/plain", storagePath, extractedText, extractionStatus]);
    // Headings are the fallback when the model cannot suggest topics.
    let suggestedTopics = suggestTopics(extractedText, uploaded.name);
    if (extractedText.trim() && hasAiProvider()) {
      try {
        const fromAi = await suggestTopicsWithAi(uploaded.name, extractedText, await topicNames(subjectId), aiOptionsFromRequest(request));
        if (fromAi.length) suggestedTopics = fromAi;
      } catch { /* Keep the quick heading fallback when AI cannot suggest topics. */ }
    }
    return Response.json({ ...result.rows[0], suggestedTopics, scannedPdfNotice: pdf && !extractedText.trim() ? "No selectable text was found. This may be a scanned document; OCR is not available yet." : undefined }, { status: 201 });
  } catch (error) {
    await rm(storagePath, { force: true });
    throw error;
  }
}
