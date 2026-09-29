# Tao

Tao is a local-first study app for course-aware practice. Add subjects and covered topics, upload notes, practice problems selected by topic review state, and review spaced-repetition flashcards.

The interface keeps the overview to a subject list and new-subject action. Each subject shows its topics, resources, and practice action. Text is set in the bundled Libertinus Serif font.
The study screen renders TeX notation with locally hosted MathJax. Resource and topic summaries render Markdown and TeX. Use `\\(...\\)` for inline math and `\\[...\\]` for display math. The header provides Codex or Claude model selection, a remaining-usage bar, and a saved dark mode toggle. Sign-in is not implemented yet.

This prototype has one shared local demo workspace and no sign-in. Run it only on a machine or network you trust; account separation is a future milestone. Uploaded files and study data remain in local Docker volumes.

## Local development

Use Docker with Compose. Git is needed to clone the repository; Node.js, npm, and the Codex and Claude CLIs are already in the Docker images. From the repository root, run:

```bash
docker compose -f compose.portable.yaml up --build
```

Then open Tao and press **Connect AI** in the header to sign in to Codex (ChatGPT) or Claude with your own subscription. Codex shows a link and a one-time code; Claude shows a link, then asks you to paste the code from its sign-in page. The key button in the header reopens this dialog to sign in to the other provider or sign out. No `.env` file is needed; `.env.example` lists optional settings.

Open [http://localhost:6283](http://localhost:6283). `compose.portable.yaml` uses a standard Docker network and publishes only the web app on local port 6283. It starts PostgreSQL, the web app, and the Codex and Claude sidecars. Logins are stored in the `codex_auth` and `claude_auth` Docker volumes. Database migrations run automatically when the app first queries the database. Data and uploads live in named Docker volumes. Source files under `app/`, `lib/`, and `db/` are mounted for development.

Before signing in, you can organize subjects and inspect extracted text; summaries and practice need Codex or Claude.

This workspace also has `compose.yaml`, a Linux host-network variant because its Docker environment cannot create bridge interfaces. On that machine, run `docker compose up --build` instead. Both variants use the same app and database schema. Use the same `-f compose.portable.yaml` flag with later `ps`, `logs`, `exec`, and `down` commands when you started the portable variant.

### Try the prototype

1. Create a subject such as **Analysis**.
2. Add a covered topic, such as **Convergent sequences**. Select one or several `.txt`, `.md`, or text-based `.pdf` resources in the file picker. Tao uploads each file and queues its topic suggestions for review. If Codex is unavailable, Tao uses headings as a fallback. Click a resource to see its model summary and extracted text. Click a topic, open **Resources**, and click rows to add or remove resources. The available list filters as you type. Labels show **Saved**, **To add**, and **To remove** before you press **Save** to update links and regenerate the topic summary once. A resource's **Topics** tab works the same way from the other side. Press **Suggest** to have the model rank candidates by their short summaries; up to five **Suggested** items move to the top of the add list. The summary remains editable. Use the folder button beside **Topics** to make a folder, then drag topics onto it or pick a folder in a topic's edit row. Drag a row onto the top or bottom edge of another row to reorder folders and topics. Right-click a folder or topic to edit or delete it, or to create a folder or topic inside a folder. Folders nest, collapse, and show a short model overview of what they contain, with the union of their topics' resources. Suggested topics from an upload come with a place in your folders. **Organize** proposes a whole folder tree for review before anything moves.
3. Sign in with **Connect AI** in the header if you have not already. The model selector lists models from every signed-in provider; the chosen model decides which one handles requests.
4. Press **Practice** beside the subject name, or right-click a topic or folder and choose **Practice** or **Flashcards**. The study page switches between **Problems** and **Flashcards** and remembers the last one. The topic button at its top right chooses any mix of topics and folders to study together; a folder includes everything inside it. For problems, Tao practices the most due topic in the selection, chooses a level from earlier attempts, and opens one problem. If you leave a problem without answering or skipping it, Practice brings the same problem back, with its chat. It keeps one problem generated and saved ahead of time for the current selection, so Practice usually opens immediately. Without Codex or Claude connected, problems show a setup notice instead of a demo prompt.
5. Write an answer, choose how difficult it felt, and submit. TeX typed in the answer box appears in a preview. The tutor chat beside the problem answers questions; the lightbulb asks for a small hint. Enter sends and Shift+Enter starts a new line. **Skip** or **Give feedback** above the problem records its quality; skipping leaves review state unchanged. Show the reference solution after checking your answer.
6. In **Flashcards**, **Add** writes cards by hand, **Import** reads an Anki `.apkg` deck, a `.txt`, `.csv`, or `.tsv` file, or pasted lines (front and back separated by a tab or comma, as in Anki's "Notes in Plain Text" export), and **Generate** drafts cards from a topic's summary and linked resources for you to keep or discard. Press Space or **Show answer**, then rate with **Again**, **Hard**, **Good**, or **Easy** (keys 1–4); each button shows when the card returns. Cards are scheduled with FSRS. The same tutor chat works for cards: before the answer is shown, it hints without revealing it. **Browse** lists, searches, edits, and deletes the selection's cards. Flashcards work without AI; chat and generation need it.

Problems are shown one at a time. **Browse** on the Problems tab lists every problem you have been shown in the current selection with its latest result; opening one brings back its chat and your last answer, and **Try again** submits a new attempt, which counts toward the topic's review like any other. Scanned or handwritten PDFs do not have OCR yet. Course-specific generation, summaries, and AI feedback require Codex or Claude. Do not put private student records in this shared workspace.

To stop the portable setup, press Ctrl-C or run `docker compose -f compose.portable.yaml down`. Adding `-v` deletes its local database and uploads.

Without Codex or Claude connected, you can organize subjects and inspect extracted resource text, but summaries and practice are unavailable. Keep your Codex and Claude login files out of source control.

### AI backends

Both backends run a CLI on your machine in its own Docker container, and each calls hosted models through your login. Neither is offline or unlimited: Codex uses OpenAI models through ChatGPT or API-key sign-in, and Claude uses Anthropic models through a Claude subscription or Console sign-in. Each sidecar mounts only its own login volume and talks to the web app through its own Unix socket; neither mounts the app's database or uploads. Claude runs `claude -p` with tools, MCP servers, settings files, and session persistence disabled. This setup is for the single-user local prototype only: anyone who can open the app can sign these accounts in or out.

`CODEX_MODEL` and `CLAUDE_MODEL` set default models (`gpt-6-luna`, `claude-sonnet-5`). Choose another in the header. Some Claude models may need extra usage credits on your plan; Tao shows the CLI's message when a request is refused. Claude CLI has no usage command, so the Claude sidecar reads the 5-hour and weekly windows of its subscription login from Anthropic's account usage endpoint (undocumented, so it may change) and the bar shows the most used window. Console API-key logins show usage as unavailable. The first problem can take a while because each inference call starts a fresh CLI process.

To reuse an existing host login instead of signing in through Tao, set `CODEX_AUTH_DIR` (usually `$HOME/.codex`) or `CLAUDE_AUTH_DIR` in `.env`. This gives the sidecar access to those login files.

Uploaded text and a model-generated summary are stored with each resource. The selected model suggests topics from sampled content across the uploaded text; if it is unavailable, headings and the filename provide a fallback. Topics store editable coverage summaries and explicit resource links; accepting a suggested topic links its source resource. Resource summaries process extracted text in sections. For a new problem, the model receives the subject, topic, selected difficulty, topic summary, linked excerpts, recent prompts, and recent student feedback. Older topics without links temporarily use relevant subject resources. Hints use the problem, stored solution, earlier hints, and the student's message; answer checking uses the problem, stored solution, and submitted answer. Card generation uses the topic summary, linked excerpts, and the topic's existing card fronts; card chat uses the card's front and back and whether the student has seen the back. Anki imports keep each note's first two fields as text, flatten HTML, turn cloze deletions into one card, and drop media and scheduling history.

## Checks and troubleshooting

On a machine using the portable setup:

```bash
docker compose -f compose.portable.yaml ps
docker compose -f compose.portable.yaml logs --tail=80 web codex claude
docker compose -f compose.portable.yaml exec web npm run typecheck
docker compose -f compose.portable.yaml exec web npm run lint
docker compose -f compose.portable.yaml exec web npm test
```

The database should report healthy. If the AI accounts dialog says a sidecar is not running, check the `codex` or `claude` container logs. If sign-in keeps failing, press **Restart** in the dialog to get a fresh link and code. If port 6283 is occupied, change the host-side port in the `127.0.0.1:6283:6283` mapping in `compose.portable.yaml` and open that port in the browser. The setup commands above use POSIX shell syntax; on Windows, use WSL or translate the environment-variable assignment for your shell.

For checks outside Docker, install Node.js 22 and run `npm ci`, then:

```bash
npm run typecheck
npm run lint
npm test
```

With Docker Compose running, edits to files under `app/` hot reload. Styling uses Tailwind CSS v4: tokens are in `app/globals.css`, shared components in `app/ui.tsx`, and the UI style guide in `AGENTS.md`. Rebuild with the same Compose file and `up --build -d` after changing package dependencies, Docker configuration, or the Codex or Claude bridge. Restart the web container after adding a migration file, since migrations are checked once per process.

See [AGENTS.md](AGENTS.md) for the product plan and development conventions. Production VPS deployment is planned but has not been configured yet.
The topic coverage model and the remaining passage-level evidence plan are described in [docs/content-model.md](docs/content-model.md).
