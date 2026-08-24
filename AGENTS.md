# VoC Board development rules

- Never put secrets or real customer data in prompts, source, tests, logs, or commits.
- Before editing, state the target files, intended change, and verification in at most three items.
- Do not add dependencies unless the request requires them.
- Do not delete or disable tests, lint, format, or TypeScript settings to hide failures.
- Before commit, run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test`.
