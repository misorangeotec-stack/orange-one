# Workflows — Layer 1 (Instructions)

Markdown SOPs that brief the agent on how to accomplish a task — the same way
you'd brief a teammate. Each workflow names its objective, required inputs,
which tools to use, expected outputs, and how to handle edge cases.

## Conventions

- One workflow per file, named for the task: `scrape_website.md`, `build_report.md`.
- Reference the concrete tool(s) the workflow relies on (e.g. `tools/scrape_single_site.py`).
- Keep them current: when you learn a better method or hit a constraint,
  update the workflow so the lesson sticks (see CLAUDE.md → "Keep workflows current").
- **Don't overwrite or delete a workflow without asking.** These are durable
  instructions, not throwaway notes.

## Writing a new one

Copy `_TEMPLATE.md` and fill it in.
