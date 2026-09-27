import { aiOptionsFromRequest, hasAiProvider, suggestHint } from "@/lib/ai";
import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";
type RouteContext = { params: Promise<{ problemId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { problemId } = await params;
  if (!isUuid(problemId)) return jsonError("Problem not found", 404);
  let body: { message?: string } = {};
  try { body = await request.json(); } catch { /* Empty body is allowed. */ }
  if (body.message !== undefined && typeof body.message !== "string") return jsonError("Message must be text");
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length > 2000) return jsonError("Message must be 2,000 characters or fewer");
  const problemResult = await query<{ prompt: string; solution: string; hints: string[] }>(`SELECT p.prompt, p.solution, p.hints FROM problems p
    JOIN subjects s ON s.id = p.subject_id WHERE p.id = $1 AND s.owner_id = $2`, [problemId, LOCAL_OWNER_ID]);
  const problem = problemResult.rows[0];
  if (!problem) return jsonError("Problem not found", 404);
  const aiOptions = aiOptionsFromRequest(request);
  if (!hasAiProvider()) return jsonError("Start the local Codex or Claude sidecar before asking for hints", 409);
  const previous = await query<{ content: string }>("SELECT content FROM tutor_messages WHERE problem_id = $1 AND kind = 'hint' ORDER BY created_at", [problemId]);
  const count = previous.rows.length;
  const hasProvider = hasAiProvider();
  const indexedHint = problem.hints[count];
  if (!indexedHint && !hasProvider) return jsonError("You have used the available hints. Try your answer when you are ready.", 409);
  let hint = indexedHint || "";
  if (hasProvider) {
    try { hint = await suggestHint(problem, message, previous.rows.map((row) => row.content), aiOptions) || hint; }
    catch { if (!hint) return jsonError("The tutor could not respond. Check the configured AI provider or try again.", 502); }
  }
  await query("INSERT INTO tutor_messages(problem_id, role, kind, content) VALUES ($1, 'student', 'question', $2)", [problemId, message || "Please give me a small hint."]);
  await query("INSERT INTO tutor_messages(problem_id, role, kind, content) VALUES ($1, 'tutor', 'hint', $2)", [problemId, hint]);
  return Response.json({ hint, index: count + 1 });
}
