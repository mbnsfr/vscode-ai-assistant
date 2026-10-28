'use strict';
const vscode = require('vscode');

const GUARDRAILS = `---
applyTo: "**"
---
# Personal coding safety instructions

- Analyze and propose a plan before significant or multi-file changes.
- Never merge to main, tag a release, publish a VS Code extension, or deploy to production without explicit user approval.
- Never perform AWS infrastructure apply/destroy, production database migrations, marketplace publication, metering activation, or billing changes without explicit user approval.
- Prefer an isolated branch/worktree when another coding agent may be working concurrently.
- Show proposed diffs and validation results; distinguish tests run from tests not run.
- Do not print, commit, or copy secrets. Never place API keys in source files, prompts, or chat transcripts.
- Never modify authentication, authorization or privacy boundaries without review.
- Follow existing repository conventions and avoid unrequested changes to security, authorization, billing, and metering.
`;

async function configure() {
  const choice = await vscode.window.showQuickPick([
    {label:'$(key) Add models using VS Code Language Models', detail:'Open the supported VS Code model manager', value:'models'},
    {label:'$(gear) Enable experimental BYOK in Agent Host', detail:'Only if you use the Agent Host experience', value:'agent'},
    {label:'$(book) Read official BYOK instructions', value:'docs'}
  ], {placeHolder:'Select your BYOK setup step'});
  if (!choice) return;
  if (choice.value === 'models') {
    try { await vscode.commands.executeCommand('workbench.action.chat.manageLanguageModels'); }
    catch (_) { await vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs/agent-customization/language-models')); }
  } else if (choice.value === 'agent') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'chat.agentHost.byokModels.enabled');
  } else {
    await vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs/agent-customization/language-models'));
  }
}

async function installGuardrails() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) { vscode.window.showWarningMessage('Open a project folder first.'); return; }
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({placeHolder:'Choose repository'});
  if (!folder) return;
  const target = vscode.Uri.joinPath(folder.uri, '.github', 'instructions', 'ai-coding.instructions.md');
  try {
    await vscode.workspace.fs.stat(target);
    const answer = await vscode.window.showWarningMessage('mbnsfr instructions already exist. Replace them?', {modal:true}, 'Replace');
    if (answer !== 'Replace') return;
  } catch (e) { if (e.code !== 'FileNotFound') { vscode.window.showErrorMessage(`Cannot check instructions: ${e.message}`); return; } }
  const ok = await vscode.window.showInformationMessage(`Create or replace guardrails in ${folder.name}? These are instructions, not a technical security boundary.`, {modal:true}, 'Create');
  if (ok !== 'Create') return;
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.github', 'instructions'));
    await vscode.workspace.fs.writeFile(target, Buffer.from(GUARDRAILS, 'utf8'));
    await vscode.window.showTextDocument(target);
    vscode.window.showInformationMessage('mbnsfr guardrails written. Review them before relying on agent behavior.');
  } catch (e) { vscode.window.showErrorMessage(`Could not write guardrails: ${e.message}`); }
}

async function showGuide(context) {
  await vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs/agent-customization/language-models'));
  vscode.window.showInformationMessage('Add a BYOK model in Chat: Manage Language Models, then select it in Chat Agent mode.');
}

async function start() {
  const choice = await vscode.window.showQuickPick([
    {label:'$(comment-discussion) Open VS Code AI Chat', detail:'Select your BYOK model and Agent / Plan / Ask mode in Chat', value:'chat'},
    {label:'$(key) Set up API models', value:'setup'},
    {label:'$(shield) Add repository guardrails', value:'guards'}
  ], {placeHolder:'mbnsfr AI Coding Assistant'});
  if (!choice) return;
  if (choice.value === 'setup') return configure();
  if (choice.value === 'guards') return installGuardrails();
  try { await vscode.commands.executeCommand('workbench.action.chat.open'); }
  catch (_) { vscode.window.showInformationMessage('Open the Chat view from the VS Code sidebar and select a BYOK model.'); }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('mbAI.start', start),
    vscode.commands.registerCommand('mbAI.configure', configure),
    vscode.commands.registerCommand('mbAI.installGuardrails', installGuardrails),
    vscode.commands.registerCommand('mbAI.showGuide', showGuide)
  );
}
function deactivate() {}
module.exports = {activate, deactivate};
