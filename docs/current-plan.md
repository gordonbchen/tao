# Current implementation plan

This checklist tracks the current local prototype pass. Update it when scope or behavior changes, and keep `AGENTS.md` and `README.md` aligned with implemented behavior.

- [x] Allow subject deletion from home with ten-second Undo; remove uploaded files when deletion commits.
- [x] Save an AI summary for each resource and show it first in a wide viewer, with an Extracted text tab and Escape to close.
- [x] Move AI setup to global settings, remove duplicate theme/profile controls, and show the active model and genuine usage information in the header.
- [x] Let the user switch the actual model used by requests; block AI actions when no provider is configured and point to settings.
- [x] Keep provider readiness quick by loading account usage separately. The remaining 5–9 seconds measured in local practice calls is Codex CLI startup and hosted inference; there is no confirmed safe shortcut in this pass.
- [x] Render MathJax in answer feedback and solution, and preview TeX in the student's answer as they type.
- [x] Match tutor chat height to the practice pane, grow the answer input with content, and align Check answer with difficulty feedback.
- [x] Run typecheck, lint, tests, production build, Docker rebuild, and API smoke checks for subject deletion, summary, problem generation, and answer feedback. Browser appearance still needs hands-on review.

Potential follow-up: topic coverage summaries, passage links, and resource reattachment remain in `docs/content-model.md` until implemented.
