# mbnsfr AI Coding Assistant — Personal v0.1.0

A **private workflow helper**, not a custom coding-agent engine. VS Code's built-in BYOK chat/agent support is responsible for model API connectivity, tool calling, file edits, terminal operations, and approval prompts.

## Install

1. In VS Code run **Extensions: Install from VSIX...** and select `mbnsfr-ai-coding-assistant-0.1.0.vsix`.
2. Open the Command Palette and run **mbnsfr AI: Start Coding**.
3. Choose **Set up API models**, or directly run **Chat: Manage Language Models** in VS Code.
4. Add an appropriate provider (Google or Custom Endpoint/OpenRouter) and your own API key through VS Code's model manager. Verify the exact API model ID with your provider.
5. In Chat, select the added model and **Agent** for edits/tests, **Plan** for planning, or **Ask** for discussion. Tool calling must be supported by the selected model/provider.
6. Optional: run **mbnsfr AI: Install Workspace Guardrails** in your repo, review the generated `.github/instructions/ai-coding.instructions.md`, and commit only if desired.

## Key facts

- No API keys are requested, read, or stored by this extension; VS Code/provider integration manages them.
- Model availability, provider price, support for agent tools and any billing are determined by the current provider and VS Code version.
- BYOK provider charges are separate from Codex subscription limits; quota limits still apply per provider.
- Does not provide autocomplete, independent Codex execution, custom cost dashboard, automatic fallback, guaranteed policy enforcement, or separate worktrees. These are candidates for future versions.
- Never point two concurrent agents at one mutable worktree.
- Test on a disposable repository first; some VS Code command identifiers change across versions.

References: https://code.visualstudio.com/docs/agent-customization/language-models
