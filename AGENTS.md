# Tao: project guide for future agents

## Purpose and current stage

Build a course-aware learning website. A student creates subjects, supplies their own course material, practices problems drawn from what their course has covered, and receives topic-level spaced review. Keep the app and student data local first. A hosted version may come later, but local use must remain a complete path.

This file is the living record of the project's direction. Update it in the same change whenever a product decision, architecture, setup command, test command, or important assumption changes. Keep it accurate and short enough to use. Record unresolved decisions as unresolved; do not present proposals as completed features.

## Implemented local prototype

The Next.js app, PostgreSQL schema and auto-applied migrations, Docker Compose development setup, subject/topic/resource pages, text and PDF text extraction, resource summaries, topic suggestions, single-problem study screen, Codex CLI backend, and topic review scheduling are implemented. On another Docker machine, use `docker compose -f compose.portable.yaml up --build` and open `http://localhost:3000`; see the README for login and checks. This workspace uses `docker compose up --build` with `compose.yaml`, a Linux host-network variant because its Docker environment cannot create bridge interfaces. The Codex sidecar uses a shared Unix socket and a separate login mount. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` for checks, or run typecheck/lint/tests inside the web container. `README.md` has a short test walkthrough.

The current `local-demo` owner is shared by all visitors and there is no sign-in. Do not deploy this prototype as a public multi-user service. Scanned PDF OCR, Anki cards, mixed-subject study, problem queue UI, and production VPS configuration are not implemented.
Resource upload accepts multiple files in one picker action and processes each one, queuing its topic suggestions for review. It extracts selectable PDF/text content. Codex suggests study topics from sampled material throughout the extracted text, using existing topic names when they fit. Headings and the filename are a fallback when Codex is unavailable. If Codex is connected, it generates a per-resource summary from the full extracted text in sections. Students can click a resource name to inspect its Markdown and MathJax summary or extracted text in a wide viewer that closes with Escape. The resource/topic summary viewer has one vertical scroll area: the modal itself. `resources.extracted_text` stores the full extracted text (up to 200,000 characters), while resource summary fields store generated text and model provenance. Topics store name, coverage flag, review state, and an editable Markdown and MathJax coverage summary generated from explicitly linked resources. The topic Resources tab shows selected rows and a searchable list of available rows; clicking a row stages the link change. Save replaces its link set and triggers one summary regeneration. Single links from a resource viewer or topic suggestion also regenerate the summary. A `topic_resources` join table connects them. See `docs/content-model.md` for the remaining passage-level evidence plan.
Practice content uses locally hosted MathJax 4 to render TeX in problems, hints, feedback, solutions, and a live preview of the student's plain-text answer. `npm install`/`npm ci` copies MathJax and its font package into ignored `public/mathjax/` and `public/mathjax-font/`; keep both available in Docker and local development. Ask AI providers for `\\(...\\)` inline and `\\[...\\]` display notation. Chat remains plain text while typing.

Current interface direction: keep the overview to subjects and a new-subject action. A subject page shows the subject name, editable topics, resources with add/remove controls, and a practice action with an optional topic selector. Practice opens a problem directly; the server chooses its level from review history. Removal uses a 10-second undo toast instead of a confirmation dialog. Subject descriptions are no longer collected or used; the legacy database column remains to preserve existing data. Home's tab title is `Tao - Home`, subject/study titles use `Tao - {subject name}`, and `app/icon.svg` is a yin-yang favicon and header mark. Keep typography comfortably sized; Libertinus Serif is bundled locally. Remove redundant banners, headings, controls, and copy before adding new ones.
The site header links home and exposes Codex model selection, a remaining-usage bar, and a persistent dark mode toggle. Sign-in is not available until accounts exist; do not imply that the shared local workspace is private. Without Codex connected, resource text can be viewed but summary and practice actions must show a clear setup notice.

## Product direction

- Support multiple subjects per student. Each subject has a name and an editable list of covered topics; do not collect a subject description.
- Accept text files and PDFs as course resources. Scanned or handwritten PDFs may be accepted in the first version if extraction is practical, but the student must review and correct extracted topics and coverage. Do not promise reliable handwriting recognition before testing real examples.
- Use the locally invoked Codex CLI as the sole AI backend for now. It calls a hosted model through the user's login. Remove obsolete provider branches when assumptions change; do not retain Ollama or API-key code paths. Never require a hosted Tao server for local study.
- Select practice topics using a simple, explainable spaced repetition schedule based on attempts. Save the attempt history so the scheduling algorithm can be changed later.
- Save skipped-question reasons and free-text quality feedback with the problem. Use recent feedback and previous prompts to guide future generation, and revisit unsolved problems when due without counting a skip as a failed attempt.
- Generate problems within the student's confirmed course coverage. Select target difficulty from the topic's attempt history; do not ask the student to choose it before practicing. Keep the generated problem, solution, relevant source references, and generation metadata.
- Give each problem a small tutor conversation for hints, explaining where the student is stuck, and answer feedback. Reveal hints incrementally; do not expose the stored solution before submission or an explicit request.
- Ask for a discrete difficulty rating after an attempt (initial proposal: Easy / Okay / Hard / Could not solve). The tutor may suggest a rating later, but the student controls it. A timer and time-based scheduling signals must be optional; do not create pressure to finish quickly.
- Treat AI grading of mathematical reasoning as fallible. Allow uncertain feedback and student correction.
- Keep Anki-like cards and mixed-subject study in the longer-term plan, outside the first implementation milestone.
- Future study-flow ideas: let students park a problem and return to it later with their work intact; offer a session that presents several problems (for example four) together. The first prototype stays with one problem at a time. Parking or generating another problem must not count as a failed attempt or change review state.

## Next content model

The detailed plan is in `docs/content-model.md`. Update it alongside this file when content storage or summary behavior changes.

- Keep the original file and extracted text per resource. Generate a reviewable resource summary only when Codex is connected; show what was extracted even without AI.
- Keep an editable coverage summary per topic and explicit links to its resources. Passage-level support for each claim and multiple distinct passages from the same resource remain planned. When resources change, mark the topic summary stale. A future draft/confirmation flow should preserve student edits when regenerating; do not silently treat new model text as confirmed coverage.
- Derive a subject overview from confirmed topic coverage instead of maintaining a third independent summary. For problem generation, use the topic coverage summary together with relevant source passages, so students can trace the material back to their notes.
- Keep Codex model switching and usage in the header. Show a setup notice when the sidecar is unavailable. Show only real usage data and label unavailable values honestly. Do not imply that Codex inference is offline or free of usage limits.

## Proposed implementation

- Use TypeScript and Next.js for the web interface and its server-side API. Keep one application until a separate backend solves a concrete problem.
- Use PostgreSQL for users, subjects, topics, resource metadata, extracted text, problems, attempts, review state, and tutor messages. Keep original uploaded files outside the database.
- Run the app and PostgreSQL locally with the existing Docker Compose setup. Keep local operation independent of any deployed Tao service and keep database migrations in version control.
- Keep a small VPS deployment as an optional later path, with accounts, HTTPS, backups, and abuse controls. Do not make it the default architecture or a prerequisite for local use.
- Call Codex from server code only. Never bundle login files in source code, write them to logs, commit them, or expose them to another user. Keep the bridge narrow and avoid speculative provider abstractions.
- The Codex CLI backend uses hosted OpenAI inference through a local CLI login; it is not an offline model. Keep it local-only. Run the CLI in its own container with only its login directory mounted; do not mount the web app's database or uploads there. The app sends prompts over a shared Unix socket. Do not commit `.codex-tao/` or include credentials in Docker images.
- Start with text extraction and relevant excerpts from resources. Add semantic retrieval only when simple topic/source matching is inadequate. Avoid sending all course files with every request.
- Plan for multiple users from the data-model and authorization level, even if initial testing uses one account. Every resource and record must be scoped to its owner.

Revisit design choices when actual constraints justify a change; distinguish planned summary and hosted features from implemented behavior.

## First local milestone

1. Set up the app, local database, migrations, environment example, and documented start commands.
2. Implement subjects, resource upload/extraction, and student review of the covered-topic list.
3. Implement a problem session with topic selection, AI generation, hints, answer feedback, and attempt rating.
4. Persist topic review state and show why a topic is due.
5. Test with representative analysis notes and problems, including a scanned PDF if practical.

Do not require an API key to run the site locally. AI actions require the Codex sidecar and login; organizing subjects and viewing extracted text do not.

## Development and code quality

- Prefer no code, then less code. Implement the smallest clear path that satisfies the current behavior. Avoid speculative abstractions, extra services, and duplicate state.
- Keep a consistent visual style across Tao: use the existing Libertinus typography, paper/ink/accent color tokens, restrained borders, comfortable spacing, and shared button/form patterns. Check nearby screens before adding styles. Keep home and subject pages sparse; remove redundant headings, labels, banners, and controls rather than introducing a new visual language for each feature. Ensure new controls work in dark mode and at narrow widths.
- Keep `compose.yaml` and `compose.portable.yaml` aligned when app services, volumes, or environment variables change. The portable file is the copyable setup path; the host-network file supports this workspace. Verify Compose config after edits and update README setup commands.
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
