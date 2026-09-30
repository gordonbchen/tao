# Resource and topic knowledge model

## Current state

Tao stores an uploaded file, its extracted text, and a model summary on the resource. The summary is generated from the full extracted text in sections when Codex is connected, and stores its model and status. Students can view summary and extraction in separate tabs. Topics have names, review state, and editable coverage summaries generated from linked resources. The `topic_resources` table links many topics and resources within a subject. The topic viewer shows selected resource rows and a searchable list of available resources; clicking rows stages changes, and Save applies them together before one summary update. Resource-view links and accepted topic suggestions also trigger summary updates. Codex suggests topics from resource content, with deterministic headings as a fallback. Problem generation uses topic coverage and linked excerpts, with a temporary subject-resource fallback for older topics without links.

Topics can sit in nested folders (`topic_groups`). Folders hold no resource links of their own: a folder's resources are the union of the links of every topic beneath it. A folder summary is a short overview generated from its direct contents (topic briefs and subfolder briefs), not from resource text, and stores a hash of that input in `summary_basis`; the summary shows as stale whenever the current input hashes differently. Topics accepted from a resource's suggestions start unorganized, outside the tree. Organize proposes folder paths for those topics alone, and the student previews them before they are applied.

## Planned records

- **Resource:** original file, extracted text, extraction status, and a reviewable summary of definitions, results, examples, and boundaries covered in that file. Extraction and summary, provider, model, and summary status are implemented. Source revision tracking and student editing of summaries remain planned.
- **Topic:** name and editable coverage summary are implemented. Regeneration receives the previous summary and asks the model to preserve supported student edits, but it currently replaces the displayed summary. A separate AI draft and student-confirmed revision remain planned so edits can be reviewed before replacement.
- **Topic evidence:** many-to-many links are implemented at resource level. Specific page or text spans, optional notes, and repeated distinct evidence passages from the same resource remain planned.
- **Subject overview:** derive it from confirmed topics and their evidence, rather than maintaining another independent AI summary.

## Longer-term workflow

1. On upload, extract text and let the student inspect it. If AI is configured, create a resource summary and suggest topic links. A failed AI call must not discard the file or extracted text.
2. On topic creation, search existing resources for relevant passages and propose a topic coverage draft. Let the student edit and confirm it. A topic can also be created without AI or resources.
3. In a topic view, keep the summary editable and let the student save several resource links together. Show linked source passages, not only filenames. A resource view should also allow adding relevant material to an existing topic later.
4. When a resource is added or reattached, use its summary to identify candidate sections, then check the extracted source text for the passages actually relevant to that topic. Propose an update to the topic draft with a visible diff and source links. Preserve confirmed student text until the student accepts the update.
5. When a resource changes or is removed, mark affected drafts stale and recompute support. Do not silently retain unsupported coverage claims.
6. Generate problems from the confirmed topic coverage and a small set of linked source passages. Include source references with generated problems. Avoid sending whole documents on every practice request.

## Provider behavior

The database and files remain local. Codex CLI, Claude Code CLI, and OpenCode run locally but send selected text to hosted models through the user's login. AI summaries are suggestions, not proof that material was covered or that a mathematical claim is correct.

Implement these records and screens incrementally. Do not add a separate search service or vector database unless real documents show that simpler passage matching fails.
