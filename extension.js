'use strict';

// Intentionally dependency-free. Authentication is ALWAYS handled by each
// provider's official extension; This extension never reads or stores provider tokens.
const vscode = require('vscode');
const crypto = require('crypto');

const PROVIDERS = Object.freeze({
  claude: {
    name: 'Claude Code', short: 'Anthropic Claude', icon: '✦',
    ext: 'anthropic.claude-code',
    marketplace: 'https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code',
    guide: 'https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan',
    signIn: 'Install Claude Code, open its VS Code panel, then sign in with your eligible Claude account. Paid Claude Code subscriptions can cover IDE usage; usage limits are shared with Claude.',
    details: 'Claude Code uses its own agent and subscription/account authentication.'
  },
  codex: {
    name: 'OpenAI Codex', short: 'ChatGPT / Codex', icon: '◈',
    ext: 'OpenAI.chatgpt',
    marketplace: 'https://marketplace.visualstudio.com/items?itemName=OpenAI.chatgpt',
    guide: 'https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan',
    signIn: 'Install the official OpenAI Codex extension, open its VS Code panel, and choose Sign in with ChatGPT. Your existing ChatGPT plan usage limits apply. An OpenAI API key is a separate pay-as-you-go option.',
    details: 'Codex can also be selected as a VS Code harness when supported by your VS Code version.'
  },
  gemini: {
    name: 'Google Antigravity (Gemini)', short: 'Gemini / Antigravity', icon: '✧',
    ext: 'Google.google-antigravity',
    marketplace: 'https://marketplace.visualstudio.com/items?itemName=Google.google-antigravity',
    guide: 'https://antigravity.google/docs/ide/extensions/vscode/',
    signIn: 'Install the official Google Antigravity VS Code extension (NOT the retired consumer Gemini Code Assist integration). Open its activity-bar icon and sign in with your Google account. Antigravity has free and paid plans with their own limits.',
    details: 'Use Gemini through Antigravity with Google sign-in, or add Gemini API access separately as BYOK.'
  },
  copilot: {
    name: 'GitHub Copilot', short: 'GitHub Copilot', icon: '⌘',
    ext: 'GitHub.copilot-chat',
    marketplace: 'https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat',
    guide: 'https://code.visualstudio.com/docs/setup/copilot',
    signIn: 'Open VS Code Chat and sign in with the GitHub account that has your Copilot subscription. Select the Copilot agent/harness and an available model. Copilot limits and policies apply.',
    details: 'Copilot can provide multiple model families, but charges/quotas remain those of the Copilot plan.'
  }
});

const ROOT_INSTRUCTIONS = `# Personal agent guidelines

- Before significant or multi-file changes, analyze the task and propose a plan.
- Do not merge to main, create tags/releases, publish extensions or Marketplace listings, or deploy to production without explicit user approval.
- Do not run AWS infrastructure apply/destroy, production database migrations, enable live metering, or change production billing without explicit approval.
- When another agent may be editing the project, use a separate Git branch and worktree; never use the same active worktree in parallel.
- Report what was changed, show Git diffs, and distinguish commands/tests actually run from unrun suggestions.
- Never print, commit, copy, or disclose secrets. Do not put keys in code, prompts, docs, or Git history.
- Do not modify authorization, credentials or tenant boundaries without explicit review.
- Preserve existing repository conventions. Do not assume any production deployment, merge, or approval is authorized by this file.

These are agent instructions, NOT a technical security boundary. Review every change and approve sensitive operations manually.
`;
const COPILOT_INSTRUCTIONS = `---\napplyTo: "**"\n---\n${ROOT_INSTRUCTIONS}`;
const INSTRUCTION_TARGETS = [
  { label: 'AGENTS.md (Codex, Copilot, Antigravity)', path: ['AGENTS.md'], content: ROOT_INSTRUCTIONS },
  { label: 'CLAUDE.md (Claude Code)', path: ['CLAUDE.md'], content: ROOT_INSTRUCTIONS },
  { label: 'Copilot .github/instructions/ai-coding.instructions.md', path: ['.github', 'instructions', 'ai-coding.instructions.md'], content: COPILOT_INSTRUCTIONS }
];

let panel;
let extensionContext;

function installed(id) { return Boolean(vscode.extensions.getExtension(id)); }
function statuses() {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([key, provider]) => [key, installed(provider.ext)]));
}

async function openUrl(url) { await vscode.env.openExternal(vscode.Uri.parse(url)); }
async function tryCommand(id, ...args) {
  try { await vscode.commands.executeCommand(id, ...args); return true; }
  catch (e) { return false; }
}

function getProviderOpenCommands(provider) {
  const extension = vscode.extensions.getExtension(provider.ext);
  if (!extension) return [];
  const cmds = extension.packageJSON?.contributes?.commands || [];
  return cmds.map(c => {
    const title = typeof c.title === 'string' ? c.title : (c.title?.value || '');
    const category = typeof c.category === 'string' ? c.category : '';
    return {label: (category ? category + ': ' : '') + title, id: c.command};
  }).filter(c => c.id && /open|start|chat|focus|show|agent|panel|view/i.test(c.label)
    && !/settings|reset|clear|delete|logout|sign out|remove|install|uninstall/i.test(c.label)).slice(0, 12);
}

async function openProvider(key) {
  const p = PROVIDERS[key];
  if (!p) return;
  if (!installed(p.ext)) {
    const answer = await vscode.window.showInformationMessage(
      `${p.name} is not installed. Install its official extension, then sign in there.`,
      'Open Marketplace', 'Setup instructions'
    );
    if (answer === 'Open Marketplace') await openUrl(p.marketplace);
    if (answer === 'Setup instructions') await signInGuide(key);
    return;
  }
  if (key === 'copilot') {
    if (!await tryCommand('workbench.action.chat.open'))
      vscode.window.showInformationMessage('Use View → Chat to access GitHub Copilot.');
    return;
  }
  const commands = getProviderOpenCommands(p);
  if (commands.length) {
    const choice = await vscode.window.showQuickPick(
      [
        {label: '$(comment-discussion) Open VS Code Chat / Agent picker', value: 'chat', detail: 'Select the provider harness when it is supported'},
        ...commands.map(c => ({label: '$(play) ' + c.label, value: c.id, detail: 'Command offered by the installed official extension'})),
        {label: '$(book) Sign-in instructions', value: 'guide'}
      ], {placeHolder: `Open ${p.name} — choose the official command to run`}
    );
    if (!choice) return;
    if (choice.value === 'guide') return signInGuide(key);
    if (choice.value === 'chat') return openChat();
    if (!await tryCommand(choice.value))
      vscode.window.showWarningMessage('That command could not be launched. Open the provider icon from the VS Code Activity Bar or use its Command Palette commands.');
  } else {
    const choice = await vscode.window.showInformationMessage(
      `${p.name} is installed. Open its icon in the VS Code Activity Bar, or use the provider's commands in the Command Palette.`,
      'Open Chat', 'Sign-in guide'
    );
    if (choice === 'Open Chat') await openChat();
    if (choice === 'Sign-in guide') await signInGuide(key);
  }
}

async function openChat() {
  if (!await tryCommand('workbench.action.chat.open'))
    vscode.window.showInformationMessage('Open the Chat pane from View → Chat in VS Code.');
}

async function signInGuide(key) {
  const p = PROVIDERS[key];
  if (!p) return;
  const choice = await vscode.window.showInformationMessage(p.signIn, {modal: false}, 'Official setup guide', 'Open provider');
  if (choice === 'Official setup guide') await openUrl(p.guide);
  if (choice === 'Open provider') await openProvider(key);
}

async function configure() {
  const choice = await vscode.window.showQuickPick([
    ...Object.entries(PROVIDERS).map(([key,p]) => ({label: (installed(p.ext) ? '$(check)' : '$(cloud-download)') + ' ' + p.name,
      detail: (installed(p.ext) ? 'Official extension installed — sign-in status must be checked in its own panel' : 'Install official extension') , key})),
    {label: '$(gear) Manage BYOK language models', key: 'byok', detail: 'Optional API keys; separate from existing subscriptions'},
    {label: '$(link) Open native VS Code Agent picker', key: 'chat'}
  ], {placeHolder:'Choose a subscription or optional API-model setup'});
  if (!choice) return;
  if (choice.key === 'byok') return configureBYOK();
  if (choice.key === 'chat') return openChat();
  if (!installed(PROVIDERS[choice.key].ext)) return openUrl(PROVIDERS[choice.key].marketplace);
  return signInGuide(choice.key);
}

async function configureBYOK() {
  if (!await tryCommand('workbench.action.chat.manageLanguageModels'))
    await openUrl('https://code.visualstudio.com/docs/agent-customization/language-models');
}

async function installGuardrails() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { vscode.window.showWarningMessage('Open a project folder before adding instructions.'); return; }
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({placeHolder: 'Choose the repository to protect'});
  if (!folder) return;
  const selected = await vscode.window.showQuickPick(INSTRUCTION_TARGETS,
    {canPickMany: true, placeHolder: 'Choose agent instruction files (existing files will never be overwritten)'});
  if (!selected?.length) return;
  const toWrite = [], skipped = [];
  for (const item of selected) {
    const target = vscode.Uri.joinPath(folder.uri, ...item.path);
    try { await vscode.workspace.fs.stat(target); skipped.push(item.path.join('/')); }
    catch (e) {
      if (e.code === 'FileNotFound' || e.name === 'EntryNotFound (FileSystemError)') toWrite.push({item,target});
      else { vscode.window.showErrorMessage(`Could not check ${item.path.join('/')}: ${e.message}`); return; }
    }
  }
  if (!toWrite.length) {
    vscode.window.showInformationMessage(`No files written. Already present: ${skipped.join(', ')}. Review existing project rules manually.`);
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Create ${toWrite.map(x=>x.item.path.join('/')).join(', ')} in ${folder.name}? Existing files will be skipped. These are guidance, not enforcement.`,
    {modal:true}, 'Create files');
  if (confirm !== 'Create files') return;
  const created = [];
  for (const {item,target} of toWrite) {
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ...item.path.slice(0,-1)));
      // Prevent accidental overwrite if the file appeared while confirming.
      try { await vscode.workspace.fs.stat(target); skipped.push(item.path.join('/')); continue; }
      catch (e) { if (e.code !== 'FileNotFound' && e.name !== 'EntryNotFound (FileSystemError)') throw e; }
      await vscode.workspace.fs.writeFile(target, Buffer.from(item.content, 'utf8'));
      created.push(item.path.join('/'));
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to create ${item.path.join('/')}: ${e.message}`);
    }
  }
  vscode.window.showInformationMessage(`Created: ${created.join(', ') || 'none'}. Skipped existing: ${skipped.join(', ') || 'none'}. Review these rules before using an agent.`);
}

async function copyHandoff() {
  const task = await vscode.window.showInputBox({
    prompt: 'Write the next task. The extension copies a safe handoff into your clipboard; it does not transmit it to any AI service.',
    placeHolder: 'Inspect failing tests and propose a minimal fix...', ignoreFocusOut: true,
    validateInput: value => value?.length > 8000 ? 'Keep the task under 8,000 characters.' : undefined
  });
  if (!task?.trim()) return;
  const folder = vscode.workspace.workspaceFolders?.[0]?.name || 'current workspace';
  const payload = `Task in ${folder}:\n${task.trim()}\n\nHandoff constraints:\n- Inspect current repository state before changing files.\n- Do not assume earlier agent changes or tests have been completed; verify them.\n- Avoid parallel modification of the same Git worktree.\n- Never deploy/merge/release/activate metering or change billing without explicit approval.\n- Protect secrets and tenant authorization.\n- Present changed files, diff summary, tests actually run, and remaining risks.\n`;
  await vscode.env.clipboard.writeText(payload);
  vscode.window.showInformationMessage('Task handoff copied. Paste into the agent you choose; no provider received it automatically.');
}

async function showGuide(context) {
  const ctx = context || extensionContext;
  if (!ctx) return;
  await vscode.window.showTextDocument(vscode.Uri.joinPath(ctx.extensionUri, 'README.md'), {preview: false});
}

function esc(s) {return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function hubHTML(status) {
  const nonce = crypto.randomBytes(18).toString('base64');
  const cards = Object.entries(PROVIDERS).map(([key,p]) => `
    <article class="provider">
      <div class="header"><div class="sigil">${esc(p.icon)}</div><div><h2>${esc(p.name)}</h2><div class="small">${esc(p.short)}</div></div></div>
      <div class="status ${status[key] ? 'installed' : 'missing'}">${status[key] ? 'Official extension installed' : 'Official extension not installed'}</div>
      <p>${esc(p.details)}</p>
      <div class="buttons"><button data-action="open:${key}" class="primary">${status[key] ? 'Open agent' : 'Get extension'}</button><button data-action="setup:${key}">Connect / sign in</button></div>
    </article>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><title>mbnsfr AI Hub</title><style>
:root{color-scheme:light dark}body{font-family:var(--vscode-font-family,system-ui);color:var(--vscode-foreground);background:var(--vscode-editor-background);max-width:1080px;margin:0 auto;padding:30px 20px 45px}h1{font-size:27px;margin:0 0 8px}h2{font-size:18px;margin:0}.lead{color:var(--vscode-descriptionForeground);line-height:1.55;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.provider{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:12px}.header{display:flex;align-items:center;gap:10px}.sigil{font-size:30px;display:grid;place-items:center;background:var(--vscode-editorWidget-background);width:45px;height:45px;border-radius:10px}.small{font-size:12px;color:var(--vscode-descriptionForeground);margin-top:3px}.status{font-size:12px;font-weight:600}.installed{color:var(--vscode-testing-iconPassed,#49a15b)}.missing{color:var(--vscode-descriptionForeground)}p{font-size:13px;line-height:1.5;margin:0;flex:1}.buttons{display:flex;flex-wrap:wrap;gap:8px}button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);padding:9px 13px;cursor:pointer;border-radius:6px;font-family:inherit}button:hover{background:var(--vscode-button-secondaryHoverBackground)}button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button.primary:hover{background:var(--vscode-button-hoverBackground)}button:focus-visible{outline:2px solid var(--vscode-focusBorder)}.actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}.note{font-size:12px;line-height:1.6;color:var(--vscode-descriptionForeground);margin-top:20px}.subtitle{font-size:14px;margin:28px 0 10px}small{color:var(--vscode-descriptionForeground)}
</style></head><body><h1>mbnsfr AI Coding Assistant</h1><p class="lead">One workspace, four official coding agents. Sign in using the providers' own account flows and subscriptions; This extension never receives your passwords or tokens.</p><div class="grid">${cards}</div><h2 class="subtitle">Workspace tools</h2><div class="actions"><button data-action="byok">Add API models (BYOK)</button><button data-action="chat">Open VS Code Chat</button><button data-action="guardrails">Add safety instructions</button><button data-action="handoff">Copy task handoff</button><button data-action="guide">Setup guide</button><button data-action="refresh">Refresh installation status</button></div><p class="note">Installed does not mean signed in. Authenticate inside each official extension. Provider chats/sessions are not automatically merged, and their subscriptions/quotas are separate. Agent instructions are not permission enforcement. Use a separate Git worktree if two agents edit code concurrently.</p><script nonce="${nonce}">const vscode=acquireVsCodeApi();document.addEventListener('click',e=>{const button=e.target.closest('button[data-action]');if(button)vscode.postMessage({action:button.dataset.action});});</script></body></html>`;
}

function refreshHub() {if (panel) panel.webview.html = hubHTML(statuses());}
async function onHubMessage(message) {
  const action = message?.action;
  if (typeof action !== 'string') return;
  if (action === 'refresh') return refreshHub();
  if (action === 'byok') return configureBYOK();
  if (action === 'chat') return openChat();
  if (action === 'guardrails') return installGuardrails();
  if (action === 'handoff') return copyHandoff();
  if (action === 'guide') return showGuide();
  if (action.startsWith('open:') && Object.hasOwn(PROVIDERS, action.slice(5))) return openProvider(action.slice(5));
  if (action.startsWith('setup:') && Object.hasOwn(PROVIDERS, action.slice(6))) return signInGuide(action.slice(6));
}

async function start() {
  if (panel) {panel.reveal();refreshHub();return;}
  panel = vscode.window.createWebviewPanel('mbAICodingHub', 'mbnsfr AI · Coding Hub', vscode.ViewColumn.One,
    {enableScripts:true, retainContextWhenHidden:true, enableCommandUris:false, localResourceRoots:[]});
  panel.webview.html = hubHTML(statuses());
  panel.webview.onDidReceiveMessage(onHubMessage, null, extensionContext.subscriptions);
  panel.onDidDispose(()=>{panel=undefined;},null,extensionContext.subscriptions);
}

function activate(context) {
  extensionContext = context;
  const reg = (cmd,handler) => context.subscriptions.push(vscode.commands.registerCommand(cmd,handler));
  reg('mbAI.start',start);
  reg('mbAI.configure',configure);
  reg('mbAI.openClaude',()=>openProvider('claude'));
  reg('mbAI.openCodex',()=>openProvider('codex'));
  reg('mbAI.openGemini',()=>openProvider('gemini'));
  reg('mbAI.openCopilot',()=>openProvider('copilot'));
  reg('mbAI.installGuardrails',installGuardrails);
  reg('mbAI.copyHandoff',copyHandoff);
  reg('mbAI.showGuide',()=>showGuide(context));
  context.subscriptions.push(vscode.extensions.onDidChange(refreshHub));
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 65);
  statusBar.text = '$(hubot) mbnsfr AI';
  statusBar.tooltip = 'Open mbnsfr AI Coding Hub: Claude · Codex · Gemini · Copilot';
  statusBar.command = 'mbAI.start';
  statusBar.show();
  context.subscriptions.push(statusBar);
}
function deactivate(){ panel=undefined; }
module.exports = {activate,deactivate};
