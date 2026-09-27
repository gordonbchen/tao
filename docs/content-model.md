# Resource and topic knowledge model

## Current state

Tao stores an uploaded file and its extracted text on the resource. Topic records contain a name, a coverage flag, and review scheduling data. Upload suggestions are deterministic headings. No resource or topic summary exists yet. Problem generation currently selects up to three relevant resource excerpts.

## Planned records

- **Resource:** original file, extracted text, extraction status, a reviewable summary of definitions, results, examples, and boundaries covered in that file. Keep the extraction and summary separate so the student can inspect errors. Record the provider, model, source revision, and summary status.
- **Topic:** name, editable confirmed coverage text, and an AI-proposed coverage draft. Keep student edits separate from generated drafts. A topic may draw on many resources.
- **Topic evidence:** a many-to-many link between a topic and a resource, with the specific page or text span, optional note, and status. Permit several distinct evidence passages from the same resource for one topic. Repeating an attach action should find new relevant passages or refresh a draft; it should not duplicate identical evidence.
- **Subject overview:** derive it from confirmed topics and their evidence, rather than maintaining another independent AI summary.

## Workflow

1. On upload, extract text and let the student inspect it. If AI is configured, create a resource summary and suggest topic links. A failed AI call must not discard the file or extracted text.
2. On topic creation, search existing resources for relevant passages and propose a topic coverage draft. Let the student edit and confirm it. A topic can also be created without AI or resources.
3. In a topic view, make the summary clickable and editable. Show linked resource passages and an **Attach resource** action at any time. A resource view should also allow adding relevant material to an existing topic later.
4. When a resource is added or reattached, use its summary to identify candidate sections, then check the extracted source text for the passages actually relevant to that topic. Propose an update to the topic draft with a visible diff and source links. Preserve confirmed student text until the student accepts the update.
5. When a resource changes or is removed, mark affected drafts stale and recompute support. Do not silently retain unsupported coverage claims.
6. Generate problems from the confirmed topic coverage and a small set of linked source passages. Include source references with generated problems. Avoid sending whole documents on every practice request.

## Provider behavior

The database and files remain local. Ollama can process them offline. Codex CLI runs locally but sends the selected text to an OpenAI model through the user's login. The optional API-key path behaves similarly. AI summaries are suggestions, not proof that material was covered or that a mathematical claim is correct.

Implement these records and screens incrementally. Do not add a separate search service or vector database unless real documents show that simpler passage matching fails.
