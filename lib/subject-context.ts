import { LOCAL_OWNER_ID, query } from "@/lib/db";
import { mentionedItems } from "@/lib/chat-context";
import { groupPath } from "@/lib/topic-tree";

type TopicRow = {
  id: string; name: string; groupId: string | null; about: string; coverageSummary: string;
  dueAt: Date | null; intervalDays: number | null; lastRating: string | null; lastCorrectness: string | null;
  attempts: number; correct: number; partial: number; incorrect: number; couldNotSolve: number; hard: number; lastAttempt: Date | null; skipped: number; unfinished: number;
  cards: number; cardsDue: number; lapses: number; cardReviews30d: number; forgotten30d: number;
};

const day = (date: Date | null) => date?.toISOString().slice(0, 10);

// What the tutor reads for a chat about a whole subject: a compact record of every topic's progress, recent problems
// (including ones opened but not answered), recent chats about its topics, folders, and resources, and resource briefs,
// plus the coverage of the few topics the conversation names. Resource text is never sent.
export async function subjectMaterial(subjectId: string, question: string) {
  const subject = await query<{ name: string }>("SELECT name FROM subjects WHERE id = $1 AND owner_id = $2", [subjectId, LOCAL_OWNER_ID]);
  if (!subject.rows[0]) return null;
  const [groups, topics, problems, chats, resources, unfiledCards] = await Promise.all([
    query<{ id: string; name: string; parentId: string | null }>(`SELECT id, name, parent_id AS "parentId" FROM topic_groups WHERE subject_id = $1`, [subjectId]),
    query<TopicRow>(`SELECT t.id, t.name, t.group_id AS "groupId", CASE WHEN t.brief <> '' THEN t.brief ELSE left(t.coverage_summary, 200) END AS about,
        t.coverage_summary AS "coverageSummary", r.due_at AS "dueAt", r.interval_days AS "intervalDays", r.last_rating AS "lastRating", r.last_correctness AS "lastCorrectness",
        a.attempts, a.correct, a.partial, a.incorrect, a.could_not_solve AS "couldNotSolve", a.hard, a.last_attempt AS "lastAttempt", f.skipped, f.unfinished,
        c.cards, c.due AS "cardsDue", c.lapses, cr.reviews AS "cardReviews30d", cr.forgotten AS "forgotten30d"
      FROM topics t
      LEFT JOIN topic_reviews r ON r.topic_id = t.id
      CROSS JOIN LATERAL (SELECT count(*)::int AS attempts, count(*) FILTER (WHERE at.correctness = 'correct')::int AS correct,
        count(*) FILTER (WHERE at.correctness = 'partial')::int AS partial, count(*) FILTER (WHERE at.correctness = 'incorrect')::int AS incorrect,
        count(*) FILTER (WHERE at.rating = 'could_not_solve')::int AS could_not_solve, count(*) FILTER (WHERE at.rating = 'hard')::int AS hard, max(at.created_at) AS last_attempt
        FROM attempts at JOIN problems p ON p.id = at.problem_id WHERE p.topic_id = t.id) a
      CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE pf.skipped)::int AS skipped,
        count(*) FILTER (WHERE p.served_at IS NOT NULL AND pf.skipped IS NOT TRUE AND NOT EXISTS (SELECT 1 FROM attempts WHERE problem_id = p.id))::int AS unfinished
        FROM problems p LEFT JOIN problem_feedback pf ON pf.problem_id = p.id WHERE p.topic_id = t.id) f
      CROSS JOIN LATERAL (SELECT count(*)::int AS cards, count(*) FILTER (WHERE due <= now())::int AS due, coalesce(sum(lapses), 0)::int AS lapses FROM cards WHERE topic_id = t.id) c
      CROSS JOIN LATERAL (SELECT count(*)::int AS reviews, count(*) FILTER (WHERE cv.rating = 1)::int AS forgotten FROM card_reviews cv JOIN cards cd ON cd.id = cv.card_id
        WHERE cd.topic_id = t.id AND cv.reviewed_at > now() - interval '30 days') cr
      WHERE t.subject_id = $1 ORDER BY t.position, t.created_at`, [subjectId]),
    // Served problems, most recently active first, with their latest attempt, skip, and how much the student asked the tutor.
    query<{ topic: string | null; prompt: string; servedAt: Date; attempts: number; rating: string | null; correctness: string | null; attemptedAt: Date | null;
      skipped: boolean | null; questions: number }>(`SELECT t.name AS topic, left(p.prompt, 240) AS prompt, p.served_at AS "servedAt",
        (SELECT count(*)::int FROM attempts WHERE problem_id = p.id) AS attempts, la.rating, la.correctness, la.created_at AS "attemptedAt", pf.skipped,
        (SELECT count(*)::int FROM tutor_messages WHERE problem_id = p.id AND role = 'student') AS questions
      FROM problems p LEFT JOIN topics t ON t.id = p.topic_id LEFT JOIN problem_feedback pf ON pf.problem_id = p.id
      LEFT JOIN LATERAL (SELECT rating, correctness, created_at FROM attempts WHERE problem_id = p.id ORDER BY created_at DESC LIMIT 1) la ON true
      WHERE p.subject_id = $1 AND p.served_at IS NOT NULL ORDER BY coalesce(la.created_at, p.served_at) DESC LIMIT 12`, [subjectId]),
    // Chats about this subject's topics, folders, and resources, current and archived, with their latest questions.
    query<{ kind: string; item: string; title: string | null; questions: number; lastAt: Date; latest: string[] }>(`SELECT
        CASE WHEN m.topic_id IS NOT NULL THEN 'topic' WHEN m.group_id IS NOT NULL THEN 'folder' ELSE 'resource' END AS kind,
        coalesce(t.name, g.name, r.filename) AS item, max(m.content) FILTER (WHERE m.kind = 'title') AS title,
        count(*) FILTER (WHERE m.kind = 'question')::int AS questions, max(m.created_at) AS "lastAt",
        (array_agg(left(m.content, 160) ORDER BY m.created_at DESC) FILTER (WHERE m.kind = 'question'))[1:3] AS latest
      FROM tutor_messages m LEFT JOIN topics t ON t.id = m.topic_id LEFT JOIN topic_groups g ON g.id = m.group_id LEFT JOIN resources r ON r.id = m.resource_id
      WHERE coalesce(t.subject_id, g.subject_id, r.subject_id) = $1
      GROUP BY m.topic_id, m.group_id, m.resource_id, m.cleared_at, t.name, g.name, r.filename
      HAVING count(*) FILTER (WHERE m.kind = 'question') > 0 ORDER BY "lastAt" DESC LIMIT 8`, [subjectId]),
    query<{ filename: string; about: string; createdAt: Date }>(`SELECT filename, created_at AS "createdAt", CASE WHEN brief <> '' THEN left(brief, 200) ELSE left(model_summary, 200) END AS about
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
      // A new topic is due at once; saying so reads as overdue, so say it has not been practiced instead.
      ...(topic.lastRating === null && !topic.attempts ? { status: "not practiced yet" } : { nextReview: day(topic.dueAt) }), intervalDays: topic.intervalDays, lastRating: topic.lastRating, lastCorrectness: topic.lastCorrectness,
      problemAttempts: topic.attempts, correct: topic.correct, partial: topic.partial, incorrect: topic.incorrect, couldNotSolve: topic.couldNotSolve, ratedHard: topic.hard,
      lastAttempt: day(topic.lastAttempt), skippedProblems: topic.skipped, problemsOpenedNotAnswered: topic.unfinished,
      cards: topic.cards, cardsDue: topic.cardsDue, cardLapses: topic.lapses, cardReviewsLast30Days: topic.cardReviews30d, cardsForgottenLast30Days: topic.forgotten30d,
    })),
    cardsWithoutTopic: unfiledCards.rows[0]?.count || undefined,
    recentProblems: problems.rows.map((problem) => compact({
      opened: day(problem.servedAt), topic: problem.topic,
      status: problem.attempts ? "answered" : problem.skipped ? "skipped" : "opened, not answered yet",
      attempts: problem.attempts, lastAnswered: day(problem.attemptedAt), rating: problem.rating, correctness: problem.correctness,
      questionsToTutor: problem.questions, problem: problem.prompt,
    })),
    recentChats: chats.rows.map((chat) => compact({ about: `${chat.kind} ${chat.item}`, name: chat.title, lastMessage: day(chat.lastAt), questions: chat.questions, latestQuestions: chat.latest })),
    resources: resources.rows.map((resource) => compact({ filename: resource.filename, added: day(resource.createdAt), about: resource.about.replace(/\s+/g, " ") })),
    namedTopicCoverage: mentionedItems(topics.rows.filter((topic) => topic.coverageSummary), question, 2)
      .map((topic) => ({ topic: topic.name, coverageSummary: topic.coverageSummary.slice(0, 6000) })),
  };
}
