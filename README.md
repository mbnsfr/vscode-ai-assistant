# mbnsfr AI Coding Assistant — Personal v0.2.0

Private, dependency-free VS Code launcher for four **official coding agents**. No backend, no telemetry in this extension, no stored API keys, and no credential collection. Existing provider subscriptions are authenticated by their official extensions; This extension has no access to those sessions.

## Install

1. Use **Extensions: Install from VSIX...** in VS Code and select `mbnsfr-ai-coding-assistant-0.2.0.vsix`.
2. Reload VS Code if requested. The package is platform-independent for Windows and Ubuntu.
3. Click **mbnsfr AI** in the status bar or run **mbnsfr AI: Open Multi-Agent Hub** in the Command Palette.
4. For each provider, click **Get extension** when required, install the *official* extension, then use **Connect / sign in** and its own panel to log in.
5. Click **Open agent** to select one of the official extension's available contributed commands, or use VS Code Chat and select the harness/model in the native picker.

## Providers and existing subscription access

| Agent | VS Code extension | Sign in | Important |
|---|---|---|---|
| Claude Code | `anthropic.claude-code` | Eligible Claude Pro/Max/Team/Enterprise account | Shared Claude/Claude Code usage limits; some access options are API-based. |
| OpenAI Codex | `OpenAI.chatgpt` | ChatGPT account | Codex plan quota remains; API key is separately billed. |
| Google Gemini | `Google.google-antigravity` | Personal Google account through **Antigravity** | The older Gemini Code Assist consumer/Google AI Pro/Ultra login was retired June 2026. Antigravity is the official consumer replacement. |
| GitHub Copilot | `GitHub.copilot-chat` | GitHub account with eligible Copilot access | Copilot plan quotas apply; it may offer many model families. |

The extension's **installed** status checks only whether the official VS Code extension is present. It **cannot confirm login**, quotas, or account plan; check the provider's own UI. One subscription does **not** unlock a different provider's subscription or API. Different harnesses have different features, sessions, costs and limits.

## Optional API models (BYOK)

Use **Add API models** to open VS Code **Chat: Manage Language Models**. This is an *optional, separate* usage-based access path and may be needed for GPT-OSS, Qwen or other models outside your subscriptions. VS Code handles API credentials. Enabling `chat.agentHost.byokModels.enabled` may be required for experimental Agent Host BYOK.

## Safe workflow for multiple agents

- Use one agent on a worktree at a time, or separate Git worktrees for independent parallel work.
- **Copy task handoff** builds a basic validation/safety checklist and places it on your clipboard. You paste it manually to whichever agent you choose; no automatic shared context or invisible forwarding is performed.
- **Add safety instructions** offers three *opt-in* files: `AGENTS.md` (Codex/Copilot/Antigravity), `CLAUDE.md` (Claude Code), and `.github/instructions/ai-coding.instructions.md` (Copilot).
- Existing files are skipped, **never overwritten**. Read and reconcile existing project instructions manually. Do not create duplicate/conflicting instructions without reviewing them.
- These files are **guidance, not hard policy enforcement**. Native agent/tool settings, Git permissions, and production IAM must enforce actual safety.
- Generic rules cover production deployment approval, Git merges, credential safety, and sensitive authorization/billing changes.

## What it does NOT do

- Not a custom Claude/Codex/Gemini/Copilot client. It does not secretly reuse browser cookies or session tokens.
- Not a single shared conversation with all four providers. It coordinates access to official surfaces inside one editor.
- Does not send messages, execute commands, install other extensions, push Git commits, deploy, or modify billing automatically.
- Does not bypass usage limits or guarantee any provider accepts a given task.
- Does not track tokens/cost across provider subscriptions (each provider handles its own usage).

## References (official)

- Claude Code: https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code
- Codex: https://marketplace.visualstudio.com/items?itemName=OpenAI.chatgpt
- Antigravity: https://antigravity.google/docs/ide/extensions/vscode/
- Copilot: https://code.visualstudio.com/docs/setup/copilot
- VS Code Agent harnesses: https://code.visualstudio.com/docs/agents/run/agent-harnesses
- VS Code instructions: https://code.visualstudio.com/docs/agent-customization/custom-instructions

## Development

Run `node --check extension.js` and `npm test`. All logic is in `extension.js`; no install-time scripts, runtime dependencies, remote servers or APIs.
