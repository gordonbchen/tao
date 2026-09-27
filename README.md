# Tao

Tao is a local-first study app for course-aware practice. Add subjects and covered topics, upload notes, and practice problems selected by topic review state.

The interface keeps the overview to a subject list and new-subject action. Each subject shows its topics, resources, and practice action. Text is set in the bundled Libertinus Serif font.
The study screen renders TeX notation with locally hosted MathJax. Use `\\(...\\)` for inline math and `\\[...\\]` for display math. The header provides help, settings, a saved dark mode toggle, and a shared local profile; sign-in is not implemented yet.

This prototype has one shared local demo workspace and no sign-in. Run it only on a machine or network you trust; account separation is a future milestone. Uploaded files and study data remain in local Docker volumes.

## Local development

Requirements: Docker with Compose on Linux. Node.js and npm are only needed if you want to run the web app outside Docker. This local setup uses host networking because Docker bridge networking is unavailable in the current development environment; the web app and database listen on localhost.

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). PostgreSQL and the web app run in containers; source changes are mounted into the web container for development. Database data and uploads are kept in named Docker volumes. Check their status with `docker compose ps`; both services should be running and the database should be healthy.

### Try the prototype

1. Create a subject such as **Analysis**.
2. Add a covered topic, such as **Convergent sequences**. You can also upload or remove a `.txt`, `.md`, or text-based `.pdf` resource and review any topic suggestions before adding them.
3. Use the topic selector beneath the subject name, then press **Practice**. The app chooses the problem level from earlier attempts and opens a problem immediately. With no AI configured, it uses a repeatable demonstration prompt.
4. Ask for a hint, write an answer, choose how difficult it felt, and submit. The demo checker records the attempt as uncertain; it cannot judge your mathematics. Reveal the reference solution afterward.
5. Return to the subject page to see its updated review state. The scheduler uses your rating and the answer check; the demo checker marks answers uncertain, so it schedules another review soon.

The first version works with one problem at a time. It saves generated problems and attempts, but the interface does not yet offer a problem queue. Scanned or handwritten PDFs do not have OCR yet. The no-key demo uses general definition-and-example prompts; course-specific generation and AI answer feedback require Codex, Ollama, or an OpenAI key. Do not put private student records in this shared demo workspace.

To stop the app, press Ctrl-C or run `docker compose down`. `docker compose down -v` also deletes the local database and uploads.

Without an AI provider, the app uses repeatable demo problems and hints. For live AI, enter an OpenAI API key in the app, use Codex CLI, or run an optional local model with Ollama. Keep keys out of source control.

### Optional Codex CLI backend

Codex CLI runs on your machine in a separate Docker container but calls OpenAI models through your Codex login. It is **not** an offline or unlimited free model. It can use ChatGPT sign-in or API-key sign-in, depending on how you logged into Codex. The sidecar has its own login directory and communicates with the web app through a Unix socket; it does not mount the app's database or uploads. This mode is for the single-user local prototype only.

With Codex CLI installed on your host, create a separate login for Tao:

```bash
mkdir -p .codex-tao
CODEX_HOME="$PWD/.codex-tao" codex login
```

Copy `.env.example` to `.env` and set `AI_PROVIDER=codex`. Then run `docker compose --profile local-codex up --build -d`. Leave the OpenAI key field blank in Tao to use Codex. If you prefer to reuse your existing CLI login, set `CODEX_AUTH_DIR` in `.env` to its directory (usually `$HOME/.codex`); this gives the Codex sidecar access to those login files. `CODEX_MODEL` is optional. A key entered on the practice page takes precedence over Codex.

Uploaded text is stored with each resource. Topic suggestions are extracted from headings and the filename; no AI analyzes uploads yet. Topics store names and review state, not a separate summary. For a new problem, the AI receives the subject, topic, selected difficulty, and up to three resource excerpts of 3,500 characters each, taken near the topic name when found. Hints use the problem, stored solution, earlier hints, and the student's message; answer checking uses the problem, stored solution, and submitted answer.

### Optional local AI

Copy `.env.example` to `.env`, uncomment `OLLAMA_BASE_URL`, and set `OLLAMA_MODEL` to a model you intend to download. Then run:

```bash
docker compose --profile local-ai up --build -d
docker compose exec ollama ollama pull qwen3:4b
```

For the example above, set `OLLAMA_MODEL=qwen3:4b`. The model download is about 2.5 GB and CPU inference can be slow. Ollama is optional; ordinary `docker compose up --build` does not start it. To stop the optional service, run `docker compose --profile local-ai down`.

## Checks

```bash
npm run typecheck
npm run lint
npm test
```

See [AGENTS.md](AGENTS.md) for the product plan and development conventions. Production VPS deployment is planned but has not been configured yet.
