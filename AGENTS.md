# Tao: project guide for future agents

## Purpose and current stage

Build a course-aware learning website. A student creates subjects, supplies their own course material, practices problems drawn from what their course has covered, and receives topic-level spaced review. The immediate milestone is a working local application. Plan for eventual deployment on a small VPS, but do not make deployment a prerequisite for local development.

This file is the living record of the project's direction. Update it in the same change whenever a product decision, architecture, setup command, test command, or important assumption changes. Keep it accurate and short enough to use. Record unresolved decisions as unresolved; do not present proposals as completed features.

## Implemented local prototype

The Next.js app, PostgreSQL schema and auto-applied migrations, Docker Compose development setup, subject/topic/resource pages, text and PDF text extraction, topic suggestions, single-problem study screen, demo AI mode, optional Ollama/OpenAI calls, and topic review scheduling are implemented. On Linux, run `docker compose up --build` and open `http://localhost:3000`. Compose uses host networking because this development environment cannot create Docker bridge interfaces; web, database, and optional Ollama bind to localhost. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` for checks. `README.md` has a short test walkthrough.

The current `local-demo` owner is shared by all visitors and there is no sign-in. Do not deploy this prototype as a public multi-user service. Scanned PDF OCR, Anki cards, mixed-subject study, problem queue UI, and production VPS configuration are not implemented.
Mathematical notation is currently displayed as plain text; no MathJax or other TeX renderer is installed yet.

Current interface direction: keep the overview to subjects and a new-subject action. A subject page shows the subject name, editable topics, resources with add/remove controls, and a practice action with an optional topic selector. Practice opens a problem directly; the server chooses its level from review history. Removal uses a 10-second undo toast instead of a confirmation dialog. Subject descriptions are no longer collected or used; the legacy database column remains to preserve existing data. Home's tab title is `Tao - Home`, subject/study titles use the subject name, and `app/icon.svg` is the favicon derived from the original `public/logo.png`. Keep typography comfortably sized; Libertinus Serif is bundled locally. Remove redundant banners, headings, controls, and copy before adding new ones.

## Product direction

- Support multiple subjects per student. Each subject has a name and an editable list of covered topics; do not collect a subject description.
- Accept text files and PDFs as course resources. Scanned or handwritten PDFs may be accepted in the first version if extraction is practical, but the student must review and correct extracted topics and coverage. Do not promise reliable handwriting recognition before testing real examples.
- Select practice topics using a simple, explainable spaced repetition schedule based on attempts. Save the attempt history so the scheduling algorithm can be changed later.
- Generate problems within the student's confirmed course coverage. Select target difficulty from the topic's attempt history; do not ask the student to choose it before practicing. Keep the generated problem, solution, relevant source references, and generation metadata.
- Give each problem a small tutor conversation for hints, explaining where the student is stuck, and answer feedback. Reveal hints incrementally; do not expose the stored solution before submission or an explicit request.
- Ask for a discrete difficulty rating after an attempt (initial proposal: Easy / Okay / Hard / Could not solve). The tutor may suggest a rating later, but the student controls it. A timer and time-based scheduling signals must be optional; do not create pressure to finish quickly.
- Treat AI grading of mathematical reasoning as fallible. Allow uncertain feedback and student correction.
- Keep Anki-like cards and mixed-subject study in the longer-term plan, outside the first implementation milestone.
- Future study-flow ideas: let students park a problem and return to it later with their work intact; offer a session that presents several problems (for example four) together. The first prototype stays with one problem at a time. Parking or generating another problem must not count as a failed attempt or change review state.

## Proposed implementation

- Use TypeScript and Next.js for the web interface and its server-side API. Keep one application until a separate backend solves a concrete problem.
- Use PostgreSQL for users, subjects, topics, resource metadata, extracted text, problems, attempts, review state, and tutor messages. Keep original uploaded files outside the database.
- Run the app and PostgreSQL locally with reproducible setup, likely Docker Compose for PostgreSQL and a normal Node.js development server. The site must work locally without any deployed service. Keep the database schema and migrations in version control.
- Design for a small VPS later: a containerized app, PostgreSQL, persistent upload storage, HTTPS reverse proxy, and backups. Do not assume a particular VPS provider or provision production infrastructure before it is needed.
- Call an AI provider from server code only. The local application offers repeatable demo responses without a provider, optional Ollama for free local inference, and a user-provided OpenAI API key for live hosted inference. The key is entered in the browser, sent per request, and held only in page memory; it is not saved. Never bundle a key in source code, write it to logs, commit it, or expose it to another user. Keep provider-specific code behind a small interface so the rest of the app does not depend on one provider.
- Start with text extraction and relevant excerpts from resources. Add semantic retrieval only when simple topic/source matching is inadequate. Avoid sending all course files with every request.
- Plan for multiple users from the data-model and authorization level, even if initial testing uses one account. Every resource and record must be scoped to its owner.

These are current design choices, not a claim that the stack has been implemented. Revisit them if actual constraints justify a change.

## First local milestone

1. Set up the app, local database, migrations, environment example, and documented start commands.
2. Implement subjects, resource upload/extraction, and student review of the covered-topic list.
3. Implement a problem session with topic selection, AI generation, hints, answer feedback, and attempt rating.
4. Persist topic review state and show why a topic is due.
5. Test with representative analysis notes and problems, including a scanned PDF if practical.

Do not require an API key to run the whole site locally: non-AI flows and tests should work without one; AI features can explain that a key is required.

## Development and code quality

- Prefer no code, then less code. Implement the smallest clear path that satisfies the current behavior. Avoid speculative abstractions, extra services, and duplicate state.
- When an assumption changes, find code that existed because of the old assumption. Remove or simplify it instead of layering a new branch on top.
- Keep domain decisions (topic scheduling, coverage, difficulty, attempt outcomes) separate from UI and AI-provider calls. Make scheduling deterministic and testable.
- Validate untrusted inputs and uploaded files. Enforce file size/type limits and ownership checks at server boundaries. Do not trust generated content as authoritative course coverage or a verified mathematical solution.
- Use database migrations for schema changes. Never commit secrets, uploaded student documents, or local database files.
- Add meaningful tests for scheduling, authorization, extraction edge cases, and AI response handling. Avoid tests that merely repeat implementation details. Run type checking, linting, and relevant tests before declaring a change complete.
- Document actual setup and test commands in README.md once tooling exists. Keep an example environment file with variable names and explanations, never live values.
- For any change, report what changed, how it was checked, and any remaining limitations.

## Open decisions

- Account system and password/session implementation for local and VPS use.
- Model choice, quality benchmarks, and limits on AI calls and file processing before public access.
- Exact scanned-PDF extraction approach and acceptable accuracy.
- File storage path and backup procedure on the VPS.
- Public sign-up policy and abuse controls when opening the site to other students.
