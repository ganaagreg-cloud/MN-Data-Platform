# Claude Code scaffold — Mongolian Data Platform

Drop these into the **root of your new monorepo**:

```
CLAUDE.md
.mcp.json
.claude/
├── settings.json          # hooks + permissions (committed, team-shared)
├── hooks/                 # Node hooks — cross-platform (work on your Windows setup)
│   ├── guard-bash.mjs       (PreToolUse: blocks rm -rf, force push, DROP/TRUNCATE, unscoped DELETE, curl|sh)
│   ├── guard-secrets.mjs    (PreToolUse: blocks hardcoded keys/tokens/DB creds + real .env writes)
│   └── format-and-check.mjs (PostToolUse: prettier + tsc --noEmit, feeds errors back to Claude)
├── skills/                # auto-loaded when relevant
│   ├── source-adapter/        building a new scraper to the Source contract
│   ├── postgres-conventions/  Drizzle schema, idempotent upserts, indexing
│   ├── mongolian-data/        Cyrillic, MNT, dates, districts, РД
│   ├── scraping-compliance/   robots, rate limits, no republishing
│   └── qpay-billing/          QPay invoice→webhook→subscription state machine
└── agents/                # delegate with: "Use <name> to ..."
    ├── source-onboarder.md    scaffolds a full new source (can write)
    ├── schema-guardian.md     read-only schema/migration reviewer
    └── security-auditor.md    read-only secrets/PII/scraping/payment reviewer
```

## After dropping in

1. Put real values in `.env` (gitignored), placeholders in `.env.example`. Needed: `DATABASE_URL`, `GITHUB_TOKEN`, `QPAY_*`, `RESEND_API_KEY`, `SENTRY_DSN`.
2. Hooks shell out to `npx prettier` / `npx tsc` — they no-op safely until those are installed, so add them when you scaffold the workspace.
3. `.mcp.json` package names are illustrative — confirm the current published names (Context7, Playwright MCP, the GitHub/Postgres servers move around) before relying on them. Claude will prompt to approve project MCP servers on first run.
4. Verify config loads: `claude --doctor`.

## Notes for your Windows setup

- Hooks are Node (`.mjs`), invoked as `node "${CLAUDE_PROJECT_DIR}/.claude/hooks/x.mjs"`, so they don't need git-bash.
- Your VS Code MCP config stays at `AppData\Roaming\Code\User\mcp.json`; this `.mcp.json` is the project-scoped set for the CLI/extension in this repo.
