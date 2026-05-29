# Tools — Layer 3 (Execution)

Deterministic Python scripts that do the actual work: API calls, data
transformations, file operations, database queries. They are consistent,
testable, and fast. The agent decides *when* to run them; the tools decide
*how* the work is done.

## Conventions

- **One job per script.** A tool does one thing well (e.g. `scrape_single_site.py`).
- **Read secrets via `config.py`.** Never hard-code keys; pull them from `.env`:
  ```python
  from config import get_env, ensure_tmp
  api_key = get_env("FIRECRAWL_API_KEY", required=True)
  ```
- **Take inputs as CLI args or function params.** Make tools callable both from
  the command line and importable.
- **Write intermediates to `.tmp/`.** Final deliverables go to cloud services.
- **Fail loudly.** Raise clear errors with context so the agent can recover.
- **Idempotent where possible.** Re-running shouldn't corrupt state.

## Running a tool

```bash
pip install -r ../requirements.txt   # first time
python tools/scrape_single_site.py --url https://example.com
```

## Before building new

Check this directory first. Only create a new script when nothing here already
does the task (see CLAUDE.md → "Look for existing tools first").
