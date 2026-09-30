import { cleanDrafts, parseApkg, parseCardText } from "@/lib/card-import";
import { isUuid, jsonError } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";

type RouteContext = { params: Promise<{ subjectId: string }> };
const MAX_BYTES = 50 * 1024 * 1024;

// Reads cards from an uploaded .apkg, .txt, .csv, or .tsv file, or from pasted text, for the student to preview.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError("Expected a file or pasted text"); }
  const file = form.get("file");
  const text = form.get("text");
  try {
    let drafts;
    if (file instanceof File) {
      if (file.size < 1 || file.size > MAX_BYTES) return jsonError("File must be between 1 byte and 50 MB");
      const name = file.name.toLowerCase();
      if (name.endsWith(".apkg") || name.endsWith(".colpkg")) drafts = parseApkg(new Uint8Array(await file.arrayBuffer()));
      else if (/\.(txt|csv|tsv)$/.test(name)) drafts = parseCardText(await file.text());
      else return jsonError("Choose an .apkg, .txt, .csv, or .tsv file");
    } else if (typeof text === "string" && text.trim()) {
      if (text.length > 2_000_000) return jsonError("Pasted text is too long");
      drafts = parseCardText(text);
    } else return jsonError("Expected a file or pasted text");
    const cards = cleanDrafts(drafts);
    if (!cards.length) return jsonError("No cards were found. Put each card on its own line, with the front and back separated by a tab or comma.", 422);
    return Response.json({ cards });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not read these cards", 422);
  }
}
