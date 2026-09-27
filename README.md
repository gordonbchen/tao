# Tao

Tao is a local-first study app for course-aware practice. Add subjects and covered topics, upload notes, and practice problems selected by topic review state.

The interface keeps the overview to a subject list and new-subject action. Each subject shows its topics, resources, and practice action. Text is set in the bundled Libertinus Serif font.
The study screen renders TeX notation with locally hosted MathJax. Resource and topic summaries render Markdown and TeX. Use `\\(...\\)` for inline math and `\\[...\\]` for display math. The header provides Codex or Claude model selection, a remaining-usage bar, and a saved dark mode toggle. Sign-in is not implemented yet.

This prototype has one shared local demo workspace and no sign-in. Run it only on a machine or network you trust; account separation is a future milestone. Uploaded files and study data remain in local Docker volumes.

## Local development

Use Docker with Compose. Git is needed to clone the repository; Node.js, npm, and the Codex and Claude CLIs are already in the Docker images. From the repository root, run:

```bash
docker compose -f compose.portable.yaml up --build
```

Then open Tao and press **Connect AI** in the header to sign in to Codex (ChatGPT) or Claude with your own subscription. Codex shows a link and a one-time code; Claude shows a link, then asks you to paste the code from its sign-in page. The key button in the header reopens this dialog to sign in to the other provider or sign out. No `.env` file is needed; `.env.example` lists optional settings.

Open [http://localhost:3000](http://localhost:3000). `compose.portable.yaml` uses a standard Docker network and publishes only the web app on local port 3000. It starts PostgreSQL, the web app, and the Codex and Claude sidecars. Logins are stored in the `codex_auth` and `claude_auth` Docker volumes. Database migrations run automatically when the app first queries the database. Data and uploads live in named Docker volumes. Source files under `app/`, `lib/`, and `db/` are mounted for development.

Before signing in, you can organize subjects and inspect extracted text; summaries and practice need Codex or Claude.

This workspace also has `compose.yaml`, a Linux host-network variant because its Docker environment cannot create bridge interfaces. On that machine, run `docker compose up --build` instead. Both variants use the same app and database schema. Use the same `-f compose.portable.yaml` flag with later `ps`, `logs`, `exec`, and `down` commands when you started the portable variant.

### Try the prototype

1. Create a subject such as **Analysis**.
2. Add a covered topic, such as **Convergent sequences**. Select one or several `.txt`, `.md`, or text-based `.pdf` resources in the file picker. Tao uploads each file and queues its topic suggestions for review. If Codex is unavailable, Tao uses headings as a fallback. Click a resource to see its model summary and extracted text. Click a topic, open **Resources**, and click rows to add or remove resources. The available list filters as you type. Labels show **Saved**, **To add**, and **To remove** before you press **Save** to update links and regenerate the topic summary once. The summary remains editable.
3. Sign in with **Connect AI** in the header if you have not already. The model selector lists models from every signed-in provider; the chosen model decides which one handles requests.
4. Use the topic selector beneath the subject name, then press **Practice**. Tao chooses a problem level from earlier attempts and opens one problem. Without Codex connected, Tao shows a setup notice instead of generating a demo prompt.
5. Ask for a hint, write an answer, choose how difficult it felt, and submit. TeX typed in the answer box appears in a preview. You can skip a question or give feedback about its quality; skipping leaves review state unchanged. Reveal the reference solution after checking your answer. Return to the subject page to see updated review state.

The first version works with one problem at a time. It saves generated problems and attempts, but the interface does not yet offer a problem queue. Scanned or handwritten PDFs do not have OCR yet. Course-specific generation, summaries, and AI feedback require Codex or Claude. Do not put private student records in this shared workspace.

To stop the portable setup, press Ctrl-C or run `docker compose -f compose.portable.yaml down`. Adding `-v` deletes its local database and uploads.

Without Codex or Claude connected, you can organize subjects and inspect extracted resource text, but summaries and practice are unavailable. Keep your Codex and Claude login files out of source control.

### AI backends

Both backends run a CLI on your machine in its own Docker container, and each calls hosted models through your login. Neither is offline or unlimited: Codex uses OpenAI models through ChatGPT or API-key sign-in, and Claude uses Anthropic models through a Claude subscription or Console sign-in. Each sidecar mounts only its own login volume and talks to the web app through its own Unix socket; neither mounts the app's database or uploads. Claude runs `claude -p` with tools, MCP servers, settings files, and session persistence disabled. This setup is for the single-user local prototype only: anyone who can open the app can sign these accounts in or out.

`CODEX_MODEL` and `CLAUDE_MODEL` set default models (`gpt-6-luna`, `claude-sonnet-5`). Choose another in the header. Some Claude models may need extra usage credits on your plan; Tao shows the CLI's message when a request is refused. Claude CLI does not expose remaining allowance, so the usage bar shows it as unavailable while a Claude model is selected. The first problem can take a while because each inference call starts a fresh CLI process.

To reuse an existing host login instead of signing in through Tao, set `CODEX_AUTH_DIR` (usually `$HOME/.codex`) or `CLAUDE_AUTH_DIR` in `.env`. This gives the sidecar access to those login files.

Uploaded text and a model-generated summary are stored with each resource. The selected model suggests topics from sampled content across the uploaded text; if it is unavailable, headings and the filename provide a fallback. Topics store editable coverage summaries and explicit resource links; accepting a suggested topic links its source resource. Resource summaries process extracted text in sections. For a new problem, the model receives the subject, topic, selected difficulty, topic summary, linked excerpts, recent prompts, and recent student feedback. Older topics without links temporarily use relevant subject resources. Hints use the problem, stored solution, earlier hints, and the student's message; answer checking uses the problem, stored solution, and submitted answer.

## Checks and troubleshooting

On a machine using the portable setup:

```bash
docker compose -f compose.portable.yaml ps
docker compose -f compose.portable.yaml logs --tail=80 web codex claude
docker compose -f compose.portable.yaml exec web npm run typecheck
docker compose -f compose.portable.yaml exec web npm run lint
docker compose -f compose.portable.yaml exec web npm test
```

The database should report healthy. If the AI accounts dialog says a sidecar is not running, check the `codex` or `claude` container logs. If sign-in keeps failing, press **Restart** in the dialog to get a fresh link and code. If port 3000 is occupied, change the host-side `127.0.0.1:3000:3000` mapping in `compose.portable.yaml` and open that port in the browser. The setup commands above use POSIX shell syntax; on Windows, use WSL or translate the environment-variable assignment for your shell.

For checks outside Docker, install Node.js 22 and run `npm ci`, then:

```bash
npm run typecheck
npm run lint
npm test
```

With Docker Compose running, edits to files under `app/` hot reload. To tune the default answer height, edit `.answer-box { min-height: clamp(180px, 22vh, 280px); }` in `app/globals.css`; the study page's overall height is set by `.study-layout` nearby. Rebuild with the same Compose file and `up --build -d` after changing package dependencies, Docker configuration, or the Codex or Claude bridge. Restart the web container after adding a migration file, since migrations are checked once per process.

See [AGENTS.md](AGENTS.md) for the product plan and development conventions. Production VPS deployment is planned but has not been configured yet.
The topic coverage model and the remaining passage-level evidence plan are described in [docs/content-model.md](docs/content-model.md).
