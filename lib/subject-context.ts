import { LOCAL_OWNER_ID, query } from "@/lib/db";
import { mentionedItems } from "@/lib/chat-context";
import { groupPath } from "@/lib/topic-tree";

type TopicRow = {
  id: string; name: string; groupId: string | null; about: string; coverageSummary: string;
  dueAt: Date | null; intervalDays: number | null; lastRating: string | null; lastCorrectness: string | null;
  attempts: number; correct: number; partial: number; incorrect: number; couldNotSolve: number; hard: number; lastAttempt: Date | null; skipped: number;
  cards: number; cardsDue: number; lapses: number; cardReviews30d: number; forgotten30d: number;
};

const day = (date: Date | null) => date?.toISOString().slice(0, 10);

// What the tutor reads for a chat about a whole subject: a compact record of every topic's progress, recent attempts,
// and resource briefs, plus the coverage of the few topics the conversation names. Resource text is never sent.
export async function subjectMaterial(subjectId: string, question: string) {
  const subject = await query<{ name: string }>("SELECT name FROM subjects WHERE id = $1 AND owner_id = $2", [subjectId, LOCAL_OWNER_ID]);
  if (!subject.rows[0]) return null;
  const [groups, topics, attempts, resources, unfiledCards] = await Promise.all([
    query<{ id: string; name: string; parentId: string | null }>(`SELECT id, name, parent_id AS "parentId" FROM topic_groups WHERE subject_id = $1`, [subjectId]),
    query<TopicRow>(`SELECT t.id, t.name, t.group_id AS "groupId", CASE WHEN t.brief <> '' THEN t.brief ELSE left(t.coverage_summary, 200) END AS about,
        t.coverage_summary AS "coverageSummary", r.due_at AS "dueAt", r.interval_days AS "intervalDays", r.last_rating AS "lastRating", r.last_correctness AS "lastCorrectness",
        a.attempts, a.correct, a.partial, a.incorrect, a.could_not_solve AS "couldNotSolve", a.hard, a.last_attempt AS "lastAttempt", f.skipped,
        c.cards, c.due AS "cardsDue", c.lapses, cr.reviews AS "cardReviews30d", cr.forgotten AS "forgotten30d"
      FROM topics t
      LEFT JOIN topic_reviews r ON r.topic_id = t.id
      CROSS JOIN LATERAL (SELECT count(*)::int AS attempts, count(*) FILTER (WHERE at.correctness = 'correct')::int AS correct,
        count(*) FILTER (WHERE at.correctness = 'partial')::int AS partial, count(*) FILTER (WHERE at.correctness = 'incorrect')::int AS incorrect,
        count(*) FILTER (WHERE at.rating = 'could_not_solve')::int AS could_not_solve, count(*) FILTER (WHERE at.rating = 'hard')::int AS hard, max(at.created_at) AS last_attempt
        FROM attempts at JOIN problems p ON p.id = at.problem_id WHERE p.topic_id = t.id) a
      CROSS JOIN LATERAL (SELECT count(*)::int AS skipped FROM problem_feedback pf JOIN problems p ON p.id = pf.problem_id WHERE p.topic_id = t.id AND pf.skipped) f
      CROSS JOIN LATERAL (SELECT count(*)::int AS cards, count(*) FILTER (WHERE due <= now())::int AS due, coalesce(sum(lapses), 0)::int AS lapses FROM cards WHERE topic_id = t.id) c
      CROSS JOIN LATERAL (SELECT count(*)::int AS reviews, count(*) FILTER (WHERE cv.rating = 1)::int AS forgotten FROM card_reviews cv JOIN cards cd ON cd.id = cv.card_id
        WHERE cd.topic_id = t.id AND cv.reviewed_at > now() - interval '30 days') cr
      WHERE t.subject_id = $1 ORDER BY t.position, t.created_at`, [subjectId]),
    query<{ topic: string | null; prompt: string; rating: string; correctness: string; createdAt: Date }>(`SELECT t.name AS topic, left(p.prompt, 240) AS prompt,
        at.rating, at.correctness, at.created_at AS "createdAt"
      FROM attempts at JOIN problems p ON p.id = at.problem_id LEFT JOIN topics t ON t.id = p.topic_id
      WHERE p.subject_id = $1 ORDER BY at.created_at DESC LIMIT 12`, [subjectId]),
    query<{ filename: string; about: string }>(`SELECT filename, CASE WHEN brief <> '' THEN left(brief, 200) ELSE left(model_summary, 200) END AS about
      FROM resources WHERE subject_id = $1 AND owner_id = $2 ORDER BY created_at LIMIT 60`, [subjectId, LOCAL_OWNER_ID]),
    query<{ count: number }>("SELECT count(*)::int AS count FROM cards WHERE subject_id = $1 AND topic_id IS NULL", [subjectId]),
  ]);

  // Zero counts and missing values are left out to keep the record short.
  const compact = (entries: Record<string, unknown>) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined && value !== null && value !== 0 && value !== ""));
  return {
    subject: subject.rows[0].name,
    today: day(new Date()),
    topics: topics.rows.map((topic) => compact({
      name: topic.name, folder: groupPath(groups.rows, topic.groupId).join(" / "), about: topic.about.replace(/\s+/g, " ").slice(0, 200),
      nextReview: day(topic.dueAt), intervalDays: topic.intervalDays, lastRating: topic.lastRating, lastCorrectness: topic.lastCorrectness,
      problemAttempts: topic.attempts, correct: topic.correct, partial: topic.partial, incorrect: topic.incorrect, couldNotSolve: topic.couldNotSolve, ratedHard: topic.hard,
      lastAttempt: day(topic.lastAttempt), skippedProblems: topic.skipped,
      cards: topic.cards, cardsDue: topic.cardsDue, cardLapses: topic.lapses, cardReviewsLast30Days: topic.cardReviews30d, cardsForgottenLast30Days: topic.forgotten30d,
    })),
    cardsWithoutTopic: unfiledCards.rows[0]?.count || undefined,
    recentAttempts: attempts.rows.map((attempt) => ({ date: day(attempt.createdAt), topic: attempt.topic ?? undefined, rating: attempt.rating, correctness: attempt.correctness, problem: attempt.prompt })),
    resources: resources.rows.map((resource) => compact({ filename: resource.filename, about: resource.about.replace(/\s+/g, " ") })),
    namedTopicCoverage: mentionedItems(topics.rows.filter((topic) => topic.coverageSummary), question, 2)
      .map((topic) => ({ topic: topic.name, coverageSummary: topic.coverageSummary.slice(0, 6000) })),
  };
}
