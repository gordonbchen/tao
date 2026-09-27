# Tao

Tao is a local-first study app for course-aware practice. Add subjects and covered topics, upload notes, and practice problems selected by topic review state.

The interface keeps the overview to a subject list and new-subject action. Each subject shows its topics, resources, and practice action. Text is set in the bundled Libertinus Serif font.
The study screen renders TeX notation with locally hosted MathJax. Resource and topic summaries render Markdown and TeX. Use `\\(...\\)` for inline math and `\\[...\\]` for display math. The header provides Codex model selection, a remaining-usage bar, and a saved dark mode toggle. Sign-in is not implemented yet.

This prototype has one shared local demo workspace and no sign-in. Run it only on a machine or network you trust; account separation is a future milestone. Uploaded files and study data remain in local Docker volumes.

## Local development

Use Docker with Compose. Git is needed to clone the repository. The Codex CLI is needed on the host only to create a login for AI features; Node.js and npm are already in the Docker images. Run these commands from the repository root in a POSIX shell:

```bash
cp -n .env.example .env
mkdir -p .codex-tao
CODEX_HOME="$PWD/.codex-tao" codex login
docker compose -f compose.portable.yaml up --build
```

Open [http://localhost:3000](http://localhost:3000). `compose.portable.yaml` uses a standard Docker network and publishes only the web app on local port 3000. It starts PostgreSQL, the web app, and the Codex sidecar enabled by `.env`. Database migrations run automatically when the app first queries the database. Data and uploads live in named Docker volumes. Source files under `app/`, `lib/`, and `db/` are mounted for development.

To browse Tao before signing in to Codex, leave `COMPOSE_PROFILES` unset in `.env` or omit `.env` and start Compose. You can then organize subjects and inspect extracted text; summaries and practice need Codex.

This workspace also has `compose.yaml`, a Linux host-network variant because its Docker environment cannot create bridge interfaces. On that machine, run `docker compose up --build` instead. Both variants use the same app and database schema. Use the same `-f compose.portable.yaml` flag with later `ps`, `logs`, `exec`, and `down` commands when you started the portable variant.

### Try the prototype

1. Create a subject such as **Analysis**.
2. Add a covered topic, such as **Convergent sequences**. Select one or several `.txt`, `.md`, or text-based `.pdf` resources in the file picker. Tao uploads each file and queues its topic suggestions for review. If Codex is unavailable, Tao uses headings as a fallback. Click a resource to see its model summary and extracted text. Click a topic, open **Resources**, and click rows to add or remove resources. The available list filters as you type. Labels show **Saved**, **To add**, and **To remove** before you press **Save** to update links and regenerate the topic summary once. The summary remains editable.
3. Check the model selector in the header for the Codex connection. The local CLI sidecar uses your login. Switch the selected Codex model there.
4. Use the topic selector beneath the subject name, then press **Practice**. Tao chooses a problem level from earlier attempts and opens one problem. Without Codex connected, Tao shows a setup notice instead of generating a demo prompt.
5. Ask for a hint, write an answer, choose how difficult it felt, and submit. TeX typed in the answer box appears in a preview. You can skip a question or give feedback about its quality; skipping leaves review state unchanged. Reveal the reference solution after checking your answer. Return to the subject page to see updated review state.

The first version works with one problem at a time. It saves generated problems and attempts, but the interface does not yet offer a problem queue. Scanned or handwritten PDFs do not have OCR yet. Course-specific generation, summaries, and AI feedback require Codex. Do not put private student records in this shared workspace.

To stop the portable setup, press Ctrl-C or run `docker compose -f compose.portable.yaml down`. Adding `-v` deletes its local database and uploads.

Without Codex connected, you can organize subjects and inspect extracted resource text, but summaries and practice are unavailable. Keep your Codex login files out of source control.

### Codex CLI backend

Codex CLI runs on your machine in a separate Docker container but calls OpenAI models through your Codex login. It is **not** an offline or unlimited free model. It can use ChatGPT sign-in or API-key sign-in, depending on how you logged into Codex. The sidecar has its own login directory and communicates with the web app through a Unix socket; it does not mount the app's database or uploads. This mode is for the single-user local prototype only.

With Codex CLI installed on your host, create a separate login for Tao if you have not already done so in the quick start:

```bash
mkdir -p .codex-tao
CODEX_HOME="$PWD/.codex-tao" codex login
```

Copy `.env.example` to `.env`; it enables the `local-codex` Compose profile and defaults to `gpt-6-luna`. If you prefer to reuse your existing CLI login, set `CODEX_AUTH_DIR` in `.env` to its directory (usually `$HOME/.codex`); this gives the Codex sidecar access to those login files. Choose a model in Tao's header. The first problem can take a while because the sidecar starts a fresh Codex CLI process for each inference call.

Uploaded text and a model-generated summary are stored with each resource. Codex suggests topics from sampled content across the uploaded text; if it is unavailable, headings and the filename provide a fallback. Topics store editable coverage summaries and explicit resource links; accepting a suggested topic links its source resource. Resource summaries process extracted text in sections. For a new problem, Codex receives the subject, topic, selected difficulty, topic summary, linked excerpts, recent prompts, and recent student feedback. Older topics without links temporarily use relevant subject resources. Hints use the problem, stored solution, earlier hints, and the student's message; answer checking uses the problem, stored solution, and submitted answer.

## Checks and troubleshooting

On a machine using the portable setup:

```bash
docker compose -f compose.portable.yaml ps
docker compose -f compose.portable.yaml logs --tail=80 web codex
docker compose -f compose.portable.yaml exec web npm run typecheck
docker compose -f compose.portable.yaml exec web npm run lint
docker compose -f compose.portable.yaml exec web npm test
```

The database should report healthy. If Codex is unavailable, check that `.env` contains `COMPOSE_PROFILES=local-codex`, that `CODEX_AUTH_DIR` points to the directory used for `codex login`, and that the `codex` container is running. If port 3000 is occupied, change the host-side `127.0.0.1:3000:3000` mapping in `compose.portable.yaml` and open that port in the browser. The setup commands above use POSIX shell syntax; on Windows, use WSL or translate the environment-variable assignment for your shell.

For checks outside Docker, install Node.js 22 and run `npm ci`, then:

```bash
npm run typecheck
npm run lint
npm test
```

With Docker Compose running, edits to files under `app/` hot reload. To tune the default answer height, edit `.answer-box { min-height: clamp(180px, 22vh, 280px); }` in `app/globals.css`; the study page's overall height is set by `.study-layout` nearby. Rebuild with the same Compose file and `up --build -d` after changing package dependencies, Docker configuration, or the Codex bridge. Restart the web container after adding a migration file, since migrations are checked once per process.

See [AGENTS.md](AGENTS.md) for the product plan and development conventions. Production VPS deployment is planned but has not been configured yet.
The topic coverage model and the remaining passage-level evidence plan are described in [docs/content-model.md](docs/content-model.md).
