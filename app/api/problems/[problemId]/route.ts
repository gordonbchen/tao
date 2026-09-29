import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";
import { chatMessages } from "@/lib/practice";
type RouteContext = { params: Promise<{ problemId: string }> };

// A problem the student was shown, with its chat and latest attempt. The solution is included only after an attempt.
export async function GET(_request: Request, { params }: RouteContext) {
  const { problemId } = await params;
  if (!isUuid(problemId)) return jsonError("Problem not found", 404);
  const result = await query<{ solution: string; solutionDiagram: unknown }>(`SELECT p.id, p.topic_id AS "topicId", t.name AS "topicName", p.prompt, p.difficulty,
    p.source_refs AS "sourceRefs", p.diagram, p.created_at AS "createdAt", p.solution, p.solution_diagram AS "solutionDiagram"
    FROM problems p JOIN subjects s ON s.id = p.subject_id LEFT JOIN topics t ON t.id = p.topic_id
    WHERE p.id = $1 AND s.owner_id = $2 AND p.served_at IS NOT NULL`, [problemId, LOCAL_OWNER_ID]);
  if (!result.rows[0]) return jsonError("Problem not found", 404);
  const { solution, solutionDiagram, ...problem } = result.rows[0];
  const attempt = await query<{ answer: string; rating: string; correctness: string; feedback: string }>(`SELECT answer, rating, correctness, feedback
    FROM attempts WHERE problem_id = $1 ORDER BY created_at DESC LIMIT 1`, [problemId]);
  const latest = attempt.rows[0];
  return Response.json({
    problem: { ...problem, messages: await chatMessages({ problemId }) },
    attempt: latest ? { ...latest, solution, solutionDiagram } : null,
  });
}
