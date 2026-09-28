# Tao: project guide for future agents

## Purpose and current stage

Build a course-aware learning website. A student creates subjects, supplies their own course material, practices problems drawn from what their course has covered, and receives topic-level spaced review. Keep the app and student data local first. A hosted version may come later, but local use must remain a complete path.

This file is the living record of the project's direction. Update it in the same change whenever a product decision, architecture, setup command, test command, or important assumption changes. Keep it accurate and short enough to use. Record unresolved decisions as unresolved; do not present proposals as completed features.

## Implemented local prototype

The Next.js app, PostgreSQL schema and auto-applied migrations, Docker Compose development setup, subject/topic/resource pages, text and PDF text extraction, resource summaries, topic suggestions, single-problem study screen, Codex CLI and Claude Code CLI (`claude -p`) backends, and topic review scheduling are implemented. On another Docker machine, use `docker compose -f compose.portable.yaml up --build` and open `http://localhost:6283`; see the README for login and checks. This workspace uses `docker compose up --build` with `compose.yaml`, a Linux host-network variant because its Docker environment cannot create bridge interfaces. Each AI sidecar (Codex, Claude) always starts, uses its own Unix socket and login volume, and is signed in or out from the header's AI accounts dialog, which drives the CLI's own login flow (`bridge/auth.mjs`); the selected model decides which sidecar handles a request. No `.env` or host CLI is needed. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` for checks, or run typecheck/lint/tests inside the web container. `README.md` has a short test walkthrough.

The current `local-demo` owner is shared by all visitors and there is no sign-in. Do not deploy this prototype as a public multi-user service. Scanned PDF OCR, Anki cards, mixed-subject study, problem queue UI, and production VPS configuration are not implemented.
Resource upload accepts multiple files in one picker action and processes each one, queuing its topic suggestions for review. It extracts selectable PDF/text content. Codex suggests study topics from sampled material throughout the extracted text, using existing topic names when they fit. Headings and the filename are a fallback when Codex is unavailable. If Codex is connected, it generates a per-resource summary from the full extracted text in sections. Students can click a resource name to inspect its Markdown and MathJax summary or extracted text in a wide viewer that closes with Escape. The resource/topic summary viewer has one vertical scroll area: the modal itself. `resources.extracted_text` stores the full extracted text (up to 200,000 characters), while resource summary fields store generated text and model provenance. Topics store name, coverage flag, review state, and an editable Markdown and MathJax coverage summary generated from explicitly linked resources. The topic Resources tab shows selected rows and a searchable list of available rows; clicking a row stages the link change. Save replaces its link set and triggers one summary regeneration. Track saving, summarizing, and errors by topic ID so one topic's model work does not block another topic's Save action or overwrite another topic's open view. Single links from a resource viewer or topic suggestion also regenerate the summary. A `topic_resources` join table connects them. See `docs/content-model.md` for the remaining passage-level evidence plan.
Practice content uses locally hosted MathJax 4 to render TeX in problems, hints, feedback, solutions, and a live preview of the student's plain-text answer. `npm install`/`npm ci` copies MathJax and its font package into ignored `public/mathjax/` and `public/mathjax-font/`; keep both available in Docker and local development. Ask AI providers for `\\(...\\)` inline and `\\[...\\]` display notation. Chat remains plain text while typing.

Current interface direction: keep the overview to subjects and a new-subject action. A subject page shows the subject name, editable topics, resources with add/remove controls, and a practice action with an optional topic selector. Practice opens a problem directly; the server chooses its level from review history. Removal uses a 10-second undo toast instead of a confirmation dialog. Subject descriptions are no longer collected or used; the legacy database column remains to preserve existing data. Home's tab title is `Tao - Home`, subject/study titles use `Tao - {subject name}`, and `app/icon.svg` is a yin-yang favicon and header mark. Keep typography comfortably sized; Libertinus Serif is bundled locally. Remove redundant banners, headings, controls, and copy before adding new ones.
The site header links home and exposes a Connect AI/accounts dialog, model selection across signed-in providers, a remaining-usage bar, and a persistent dark mode toggle. Sign-in is not available until accounts exist; do not imply that the shared local workspace is private. Without a signed-in provider, resource text can be viewed but summary and practice actions must open the sign-in dialog.

## Product direction

- Support multiple subjects per student. Each subject has a name and an editable list of covered topics; do not collect a subject description.
- Accept text files and PDFs as course resources. Scanned or handwritten PDFs may be accepted in the first version if extraction is practical, but the student must review and correct extracted topics and coverage. Do not promise reliable handwriting recognition before testing real examples.
- Use locally invoked CLIs as the AI backends: Codex CLI and Claude Code CLI (`claude -p` with structured JSON output, no tools). Each calls a hosted model through the user's own login. Remove obsolete provider branches when assumptions change; do not retain Ollama or API-key code paths. Never require a hosted Tao server for local study.
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
- Keep model switching and usage in the header. Open the AI accounts dialog when an AI action needs sign-in. Claude CLI exposes no allowance data, so show its usage as unavailable. Show only real usage data and label unavailable values honestly. Do not imply that Codex inference is offline or free of usage limits.

## Proposed implementation

- Use TypeScript and Next.js for the web interface and its server-side API. Keep one application until a separate backend solves a concrete problem.
- Use PostgreSQL for users, subjects, topics, resource metadata, extracted text, problems, attempts, review state, and tutor messages. Keep original uploaded files outside the database.
- Run the app and PostgreSQL locally with the existing Docker Compose setup. Keep local operation independent of any deployed Tao service and keep database migrations in version control.
- Keep a small VPS deployment as an optional later path, with accounts, HTTPS, backups, and abuse controls. Do not make it the default architecture or a prerequisite for local use.
- Call Codex from server code only. Never bundle login files in source code, write them to logs, commit them, or expose them to another user. Keep the bridge narrow and avoid speculative provider abstractions.
- The Codex and Claude backends use hosted OpenAI/Anthropic inference through local CLI logins; they are not offline models. Keep them local-only. Run each CLI in its own container (`Dockerfile.codex`, `Dockerfile.claude`, scripts in `bridge/`) with only its login directory mounted; do not mount the web app's database or uploads there. The app sends prompts over per-provider Unix sockets. Logins live in the `codex_auth`/`claude_auth` volumes (or an optional host directory). Do not commit `.codex-tao/` or `.claude-tao/` or include credentials in Docker images. Anyone who can reach the app can manage these logins, which is another reason not to expose the prototype publicly.
- Start with text extraction and relevant excerpts from resources. Add semantic retrieval only when simple topic/source matching is inadequate. Avoid sending all course files with every request.
- Plan for multiple users from the data-model and authorization level, even if initial testing uses one account. Every resource and record must be scoped to its owner.

Revisit design choices when actual constraints justify a change; distinguish planned summary and hosted features from implemented behavior.

## First local milestone

1. Set up the app, local database, migrations, environment example, and documented start commands.
2. Implement subjects, resource upload/extraction, and student review of the covered-topic list.
3. Implement a problem session with topic selection, AI generation, hints, answer feedback, and attempt rating.
4. Persist topic review state and show why a topic is due.
5. Test with representative analysis notes and problems, including a scanned PDF if practical.

Do not require an API key to run the site locally. AI actions require a Codex or Claude sidecar and login; organizing subjects and viewing extracted text do not.

## Development and code quality

- Prefer no code, then less code. Implement the smallest clear path that satisfies the current behavior. Avoid speculative abstractions, extra services, and duplicate state.
- Follow the UI style guide below for every visual change. Check nearby screens before adding styles, and ensure new controls work in dark mode and at narrow widths.
- Keep `compose.yaml` and `compose.portable.yaml` aligned when app services, volumes, or environment variables change. The portable file is the copyable setup path; the host-network file supports this workspace. Verify Compose config after edits and update README setup commands.
- When an assumption changes, find code that existed because of the old assumption. Remove or simplify it instead of layering a new branch on top.
- Keep domain decisions (topic scheduling, coverage, difficulty, attempt outcomes) separate from UI and AI-provider calls. Make scheduling deterministic and testable.
- Validate untrusted inputs and uploaded files. Enforce file size/type limits and ownership checks at server boundaries. Do not trust generated content as authoritative course coverage or a verified mathematical solution.
- Use database migrations for schema changes. Never commit secrets, uploaded student documents, or local database files.
- Add meaningful tests for scheduling, authorization, extraction edge cases, and AI response handling. Avoid tests that merely repeat implementation details. Run type checking, linting, and relevant tests before declaring a change complete.
- Document actual setup and test commands in README.md once tooling exists. Keep an example environment file with variable names and explanations, never live values.
- For any change, report what changed, how it was checked, and any remaining limitations.

## UI style guide

Tao should look like one calm, well-set printed page, not a collection of widgets. Every screen uses the same small set of sizes, colors, and components. When a value you need is missing, add a token or shared class in `app/globals.css`; do not add a one-off value. When touching a screen, move nearby drift onto the scales below instead of copying it.

**Tokens.** Define every color, size, radius, and control height as a CSS custom property on `:root`, with dark values under `[data-theme="dark"]`. Components reference tokens only; hex values appear nowhere else. Status colors (danger, success, warning) need their own light and dark tokens, like `--danger` and `--danger-soft`, not inline hex.

**Alignment and control height.** Items that sit on one line must share one height and one baseline. This is the most visible defect to avoid.
- Set height with a height token, not padding: `--control-h: 40px` for buttons, inputs, selects, and segmented controls; `--control-h-sm: 32px` for compact rows, chips, and toolbars. Never mix the two sizes in the same row.
- Style controls as `display: inline-flex; align-items: center;` with horizontal padding only and `line-height: 1.2`. Icon-only buttons are square (`width = height`).
- Rows of controls use `display: flex; align-items: center;` and one gap from the spacing scale. Do not nudge alignment with margins, `top`, or `vertical-align`.
- Text and control on one line (label + select, name + button) must be vertically centered. A multi-line block beside a control aligns to the top.

**Spacing.** Use a 4px scale: 4, 8, 12, 16, 24, 32, 48, 64. Use 8 inside controls and between related controls, 16 between groups, 24–32 between sections, and 48+ between page regions. Do not use odd values (7, 9, 11, 13) or asymmetric padding without a reason written in a comment.

**Type.** Libertinus Serif throughout. The size scale is 14 (captions, metadata), 16 (controls, secondary text), 19 (body), 23 (section headings), 26 (modal and page titles), and `clamp(32px, 5vw, 43px)` for the page title only. Weights are 400 and 600. Body line height is 1.5; headings and controls 1.2. Muted text uses `--muted`, never reduced opacity. Do not use uppercase labels, letter-spacing, or icon-plus-caption stacks as decoration.

**Shape and depth.** Controls, inputs, cards, and panels use a 6px radius; modals 8px; chips, pills, and progress tracks are fully round. Separate content with 1px `--line` borders and whitespace. Shadows are reserved for floating layers (modals, toasts, popovers), and all of them use the same shadow token.

**Color.** Keep color scarce: paper, ink, muted, line, surface, plus one accent. Accent marks the single primary action in a view, the current selection, and links. It is not decoration. There is at most one primary button per view or modal. Destructive actions use the danger token only on hover or in confirmation, since removal already has undo.

**Components.** Reuse the shared patterns before writing new CSS: `.button` / `.button-primary` / `.button-small`, `.modal` with `.modal-head` and `.modal-actions`, `.simple-list` rows, `.content-link-chip`, `.icon-action`, and `.error-message`. Each new visual pattern becomes one shared class used everywhere; screen-specific classes only handle layout. Every interactive element needs hover, `:focus-visible` (the shared outline), and disabled states, and a hit target of at least 32px.

**States and motion.** Loading uses the shared `.spinner` next to text that says what is happening. Empty states are one plain sentence with at most one action. Errors appear next to the thing that failed, in `.error-message`. Transitions are 150ms ease on color and background only. Nothing bounces, slides in, or delays interaction.

**Layout and responsiveness.** Keep a single reading column with a comfortable measure (roughly 60–80 characters for prose). Check every change at 375px wide and in dark mode: rows wrap cleanly, nothing overflows horizontally, and control heights stay equal after wrapping.

**Restraint.** Before adding a heading, border, label, icon, or banner, remove one that is redundant. Prefer fewer, larger, well-spaced elements over many small ones. If two things look almost the same, make them identical.

## Open decisions

- Account system and password/session implementation for local and VPS use.
- Model choice, quality benchmarks, and limits on AI calls and file processing before public access.
- Exact scanned-PDF extraction approach and acceptable accuracy.
- File storage path and backup procedure on the VPS.
- Public sign-up policy and abuse controls when opening the site to other students.
