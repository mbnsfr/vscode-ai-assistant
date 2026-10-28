# mbnsfr AI Coding Assistant — v0.3.0

Personal, unpublished VS Code extension for Windows and Ubuntu. It launches official Claude Code, Codex and Google Antigravity integrations and links to **Microsoft Copilot personal** in your browser (not GitHub Copilot). Provider subscription sign-in remains within each official app/CLI.

## Features

- One task can run through **plan → implementation → independent review**.
- For plan and review, sequentially tries configured free-tier API/local providers, then subscription CLIs. Quota, auth, unsupported model and transient errors can trigger fallback. APIs can incur charges; *free-quota* is only a classification, not a guarantee of cost or availability.
- Implementation uses CLI agents only in a newly created **Git worktree**; if an agent edits files and then fails, the system **stops** for manual review instead of blindly switching.
- API keys are kept in VS Code SecretStorage; VS Code extension installation never proves you're signed into that provider.
- Pin models to detect downgrades **only when providers report actual model identity**. If model information is hidden, the status is *unverified*, not proof of a downgrade. Strict mode can block unverified results.
- Microsoft Copilot personal has a browser/manual handoff, **no automatic chat API**.
- No credentials, releases, deployments, merges, or billing changes are performed by this extension.

## Install

1. In VS Code, run `Extensions: Install from VSIX...` and select `mbnsfr-ai-coding-assistant-0.3.0.vsix`.
2. Click **mbnsfr AI** in the status bar, or run **mbnsfr AI: Open Multi-Agent Coordinator**.
3. Configure provider CLI sign-ins through their official setup guides; optionally add Groq, OpenRouter or local models through **Configure API or Local Models**.
4. Test **Plan + Review** on an unimportant repository first. For **Implement**, verify the worktree and all diffs before committing anything.

## Limitations

This is experimental and needs testing in a live VS Code instance and against provider CLIs. Compatibility with CLI flags and response formats can change. It cannot detect hidden subscription throttling, model fallback or remaining quotas. Microsoft Copilot personal and GitHub Copilot do not participate in automatic routing.

## Development

`npm test` — isolated routing/unit tests. `npm run check` — JavaScript syntax checks. No runtime npm dependencies.
