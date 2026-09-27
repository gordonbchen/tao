# Current implementation checklist

- [x] Fix intermittent Codex allowance display and replace clipped text with a readable remaining-usage bar.
- [x] Keep Codex as the sole AI backend; remove Ollama/OpenAI branches, API-key UI, Compose service, and stale setup documentation.
- [x] Make the header mark transparent and reverse its yin-yang colors in dark mode. Improve muted-text contrast and model selector size.
- [x] Give the answer editor and hint conversation more vertical space on desktop while keeping mobile usable.
- [x] Add a topic summary generated only from resources linked to that topic. Make the summary reviewable and refreshable.
- [x] Link resources to topics and topics to resources from both views; show those links in each view.
- [x] Use saved problem and attempt history for review: return to unsolved questions when due and give Codex recent prompts to prevent near-duplicates and trivial repetition.
- [x] Let students skip a flawed or repetitive question without changing review state, classify the issue, and describe how future questions should improve. Save that feedback by subject/topic and include relevant guidance in later generation prompts.
- [x] Update AGENTS.md, README.md, and content-model docs; run checks, Docker rebuild, and end-to-end local tests.
- [x] Render resource and topic summaries as Markdown with MathJax, and keep the answer and chat cards compact.
- [x] Remove the empty Help and Settings header controls; have Codex suggest topics from resource content, with a heading fallback.
- [x] Allow several resource files per selection and queue suggestions; use one vertical scroll area in summary viewers.
