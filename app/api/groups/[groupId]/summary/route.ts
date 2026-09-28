import { aiErrorResponse, aiOptionsFromRequest } from "@/lib/ai";
import { isUuid, jsonError, query } from "@/lib/db";
import { getOwnedGroup, groupSummaryInput, summarizeGroup } from "@/lib/topic-groups";

type RouteContext = { params: Promise<{ groupId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { groupId } = await params;
  if (!isUuid(groupId)) return jsonError("Folder not found", 404);
  const group = await getOwnedGroup(groupId);
  if (!group) return jsonError("Folder not found", 404);
  const contents = await groupSummaryInput(group.subjectId, groupId);
  if (!contents?.topicCount) return jsonError("Add a topic to this folder before summarizing it.", 422);
  try {
    const generated = await summarizeGroup(contents.input, aiOptionsFromRequest(request));
    await query(`UPDATE topic_groups SET summary = $2, brief = $3, summary_basis = $4, summary_provider = $5, summary_model = $6 WHERE id = $1`,
      [groupId, generated.summary, generated.brief, contents.basis, generated.provider, generated.model]);
    return Response.json({ id: groupId, summary: generated.summary, summaryStatus: "complete", summaryProvider: generated.provider, summaryModel: generated.model });
  } catch (error) {
    return aiErrorResponse(error, "summarize this folder");
  }
}
