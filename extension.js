'use strict';
// Private personal coding coordinator. No credential scraping or browser automation.
const vscode=require('vscode');
const crypto=require('crypto');
const path=require('path');
const fs=require('fs/promises');
const {API_PROVIDERS,CLI_PROVIDERS,ROUTES,ROOT_RULES,AgentError,executeStage,redactError}=require('./lib/core');
const {runProcess,runCLI,runAPI}=require('./lib/adapters');

const OFFICIAL=Object.freeze({
  claude:{name:'Claude Code',ext:'anthropic.claude-code',url:'https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code',doc:'https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan',guide:'Install the official Claude Code extension and CLI, then sign in to the CLI with your Claude account (Pro/Max eligible). For orchestration, verify `claude -p "hello" --output-format json` works in your terminal.'},
  codex:{name:'OpenAI Codex',ext:'OpenAI.chatgpt',url:'https://marketplace.visualstudio.com/items?itemName=OpenAI.chatgpt',doc:'https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan',guide:'Install OpenAI Codex and its CLI. Sign in with ChatGPT; confirm `codex exec --sandbox read-only "hello"` works. API keys are separate and NOT required for subscription sign-in.'},
  antigravity:{name:'Google Antigravity',ext:'Google.google-antigravity',url:'https://antigravity.google/docs/ide/extensions/',doc:'https://antigravity.google/docs/cli/headless/',guide:'Install Antigravity extension and Antigravity CLI. Sign in interactively using your Google account, then test `agy -p "hello" --output-format json`. Consumer Gemini Code Assist sign-in retired in June 2026.'},
  microsoft:{name:'Microsoft Copilot',url:'https://copilot.microsoft.com/',doc:'https://support.microsoft.com/en-us/microsoft-copilot/connecting-microsoft-copilot-to-other-services',guide:'Microsoft Copilot (personal subscription, NOT GitHub Copilot) opens securely in your browser. Consumer Copilot does not offer a supported general chat API for this coordinator. Copy a task handoff manually; no token extraction or fake automatic connection.'},
  github:{name:'GitHub Copilot (separate, optional)',ext:'GitHub.copilot-chat',url:'https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat',doc:'https://code.visualstudio.com/docs/setup/copilot',guide:'GitHub Copilot is separate from Microsoft Copilot. You can use it through native VS Code Chat; it is not used as an orchestration backend by this extension.'}
});

const RULES=`# mbnsfr AI · repository agent instructions\n\n- ${ROOT_RULES}\n- Avoid concurrent writes to a Git worktree. Commit/push only with explicit user approval.\n- Use the smallest sufficient model and keep prompts short; report actual tool and model status.\n- Changes must remain in an isolated task worktree until manually reviewed.\n\nThese instructions are guidance, not an enforced sandbox.\n`;
const FILES=[
  {label:'AGENTS.md — Codex / Antigravity',path:['AGENTS.md'],content:RULES},
  {label:'CLAUDE.md — Claude Code',path:['CLAUDE.md'],content:RULES},
  {label:'.github/instructions/ai-coding.instructions.md — optional GitHub Copilot',path:['.github','instructions','ai-coding.instructions.md'],content:`---\napplyTo: "**"\n---\n${RULES}`}
];
let ctx,panel,logChannel,lastSummary='No workflows run yet.';
const installed=id=>Boolean(id&&vscode.extensions.getExtension(id));
const openUrl=url=>vscode.env.openExternal(vscode.Uri.parse(url));
async function safeCommand(id){try{await vscode.commands.executeCommand(id);return true;}catch{return false;}}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function output(s){logChannel.appendLine(String(s));}
function config(){const c=vscode.workspace.getConfiguration('mbAI');return {
  routes:{plan:c.get('routes.plan',ROUTES.plan),implement:c.get('routes.implement',ROUTES.implement),review:c.get('routes.review',ROUTES.review)},
  allowPaidOrUnverifiedApis:!!c.get('allowPaidOrUnverifiedApis',false),
  requireModelEvidence:!!c.get('requireModelEvidence',false),
  maxAttempts:c.get('maxAttempts',4),
  cliModels:ctx.globalState.get('cliModels',{}),models:ctx.globalState.get('apiModels',{})};}
function providerStatus(){return Object.fromEntries(Object.entries(OFFICIAL).map(([k,p])=>[k,{installed:p.ext?installed(p.ext):false}]));}
async function openProvider(id){const p=OFFICIAL[id];if(!p)return;
  if(id==='microsoft')return openUrl(p.url);
  if(id==='github')return (await safeCommand('workbench.action.chat.open'))||openUrl(p.url);
  if(!installed(p.ext)){const answer=await vscode.window.showInformationMessage(`${p.name} is not installed.`, 'Get official extension','Read setup');if(answer==='Get official extension')return openUrl(p.url);if(answer==='Read setup')return guideProvider(id);return;}
  // Discover commands at runtime: avoid hardcoding extension-private commands.
  const x=vscode.extensions.getExtension(p.ext);
  const options=(x.packageJSON?.contributes?.commands||[]).map(c=>({id:c.command,label:String(typeof c.title==='string'?c.title:c.title?.value||'')}))
    .filter(c=>/open|chat|focus|agent|show|start/i.test(c.label)&&!/delete|sign out|logout|reset|settings|remove/i.test(c.label)).slice(0,10);
  const choice=await vscode.window.showQuickPick([{label:'Open native VS Code Agent Chat',id:'builtin'},...options],{placeHolder:`${p.name} · choose an available command`});
  if(!choice)return;
  if(choice.id==='builtin')return safeCommand('workbench.action.chat.open');
  if(!await safeCommand(choice.id))vscode.window.showWarningMessage('Command unavailable. Open the official extension panel from the Activity Bar.');
}
async function guideProvider(id){const p=OFFICIAL[id];if(!p)return;
  const answer=await vscode.window.showInformationMessage(p.guide,{modal:false},'Documentation','Open provider');
  if(answer==='Documentation')await openUrl(p.doc);
  if(answer==='Open provider')await openProvider(id);
}
async function configureAccount(){const pick=await vscode.window.showQuickPick([...Object.entries(OFFICIAL).map(([id,p])=>({label:p.name,description:p.ext?(installed(p.ext)?'Extension installed; sign-in not checked':'Install + sign in'):'Browser only; no programmatic control',id})),{label:'Configure an API key or local model',id:'api'},{label:'Pin a CLI model (optional)',id:'pin'}],{placeHolder:'Choose an account, API, or local engine'});
  if(!pick)return;
  if(pick.id==='api')return configureAPI();if(pick.id==='pin')return pinModel();return guideProvider(pick.id);
}
async function configureAPI(){const selected=await vscode.window.showQuickPick(Object.entries(API_PROVIDERS).map(([id,p])=>({id,label:p.label,description:p.tier})),{placeHolder:'Choose a provider — no keys leave VS Code SecretStorage'});
  if(!selected)return;
  const id=selected.id,p=API_PROVIDERS[id];
  const action=await vscode.window.showQuickPick([
    {label:'Save / replace API key in SecretStorage',id:'key'},
    {label:'Configure model and endpoint',id:'model'},
    {label:'Remove stored API key',id:'remove'},
    {label:'Read provider documentation',id:'docs'}
  ],{placeHolder:p.label});if(!action)return;
  if(action.id==='docs')return openUrl(({groq:'https://console.groq.com/docs/quickstart',openrouter:'https://openrouter.ai/docs',gemini:'https://ai.google.dev/gemini-api/docs',cloudflare:'https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/',ollama:'https://ollama.com/',lmstudio:'https://lmstudio.ai/'})[p.key||id]||'https://code.visualstudio.com/docs/agents/concepts/language-models');
  if(action.id==='key'||action.id==='remove'){
    if(!p.key){vscode.window.showInformationMessage('This local provider does not require an API key.');return;}
    if(action.id==='remove'){await ctx.secrets.delete('mbAI.key.'+p.key);vscode.window.showInformationMessage('Stored key removed.');return;}
    const key=await vscode.window.showInputBox({password:true,ignoreFocusOut:true,prompt:`Paste ${p.key} API key (stored using VS Code SecretStorage; never written to repository or settings).`,placeHolder:'API key'});
    if(!key?.trim())return;await ctx.secrets.store('mbAI.key.'+p.key,key.trim());vscode.window.showInformationMessage(`${p.key} key saved securely (connection NOT tested).`);return;
  }
  const models={...ctx.globalState.get('apiModels',{})},current=models[id]||{};
  const model=await vscode.window.showInputBox({prompt:`Model ID for ${p.label}`,value:current.model||p.model||'',ignoreFocusOut:true});if(model===undefined)return;
  let endpoint=current.endpoint||p.url||'';
  if(p.kind==='openai'){
    const x=await vscode.window.showInputBox({prompt:'Full OpenAI-compatible chat completions URL (HTTPS or loopback HTTP)',value:endpoint,ignoreFocusOut:true});if(x===undefined)return;endpoint=x.trim();
  }
  models[id]={model:model.trim(),endpoint};await ctx.globalState.update('apiModels',models);
  vscode.window.showInformationMessage('Provider settings saved. API connectivity and free-tier eligibility have not been verified.');
}
async function pinModel(){const pick=await vscode.window.showQuickPick(Object.entries(CLI_PROVIDERS).map(([id,x])=>({id,label:x.label})),{placeHolder:'Pin a precise model to help detect downgrades'});if(!pick)return;
  const models={...ctx.globalState.get('cliModels',{})};
  const model=await vscode.window.showInputBox({prompt:`Model ID / alias for ${pick.id}. Blank leaves provider Auto (model identity may be unobservable).`,value:models[pick.id]||'',ignoreFocusOut:true});if(model===undefined)return;
  if(model.trim())models[pick.id]=model.trim();else delete models[pick.id];
  await ctx.globalState.update('cliModels',models);
  vscode.window.showInformationMessage(model.trim()?`Pinned ${pick.id} to ${model.trim()}. Actual model checks still depend on CLI telemetry.`:`Unpinned ${pick.id}; model downgrade detection may be unavailable.`);
}

async function installInstructions(){const folders=vscode.workspace.workspaceFolders;
  if(!folders?.length)return vscode.window.showWarningMessage('Open a repository first.');
  const folder=folders.length===1?folders[0]:await vscode.window.showWorkspaceFolderPick();if(!folder)return;
  const chosen=await vscode.window.showQuickPick(FILES,{canPickMany:true,placeHolder:'Choose safety instruction files; existing files will be skipped'});if(!chosen?.length)return;
  const targets=[];for(const entry of chosen){const uri=vscode.Uri.joinPath(folder.uri,...entry.path);try{await vscode.workspace.fs.stat(uri);}catch(e){if(e.code==='FileNotFound')targets.push({entry,uri});else return vscode.window.showErrorMessage('Could not inspect '+entry.path.join('/'));}}
  if(!targets.length)return vscode.window.showInformationMessage('Selected files already exist; no files changed.');
  const reply=await vscode.window.showWarningMessage(`Create ${targets.map(x=>x.entry.path.join('/')).join(', ')}? These are instructions, not an enforced security policy.`,{modal:true},'Create');if(reply!=='Create')return;
  const created=[];for(const {entry,uri} of targets){await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri,...entry.path.slice(0,-1)));
    try{await vscode.workspace.fs.stat(uri);continue;}catch(e){if(e.code!=='FileNotFound')throw e;}
    await vscode.workspace.fs.writeFile(uri,Buffer.from(entry.content));created.push(entry.path.join('/'));
  }
  vscode.window.showInformationMessage(`Created: ${created.join(', ')||'none'}. Review before trusting.`);
}
async function copyHandoff(){const task=await vscode.window.showInputBox({prompt:'Task for Microsoft Copilot or another agent (copied locally; no automatic transfer)',ignoreFocusOut:true});if(!task?.trim())return;
  const handoff=`Task: ${task.trim()}\n\nContext: open repository and inspect current state; avoid overlapping agent work. Do not deploy, merge, commit, publish, activate billing/metering, or touch production without approval. Do not expose secrets. Report changed files, actual tests and remaining risks.`;
  await vscode.env.clipboard.writeText(handoff);vscode.window.showInformationMessage('Handoff copied. Paste manually into Microsoft Copilot or another agent.');
}
function workspaceRoot(){const folders=vscode.workspace.workspaceFolders;return folders?.length===1 && folders[0].uri.scheme==='file'?folders[0].uri.fsPath:null;}
async function git(cwd,args){const r=await runProcess('git',args,{cwd,timeout:25000,maxOutput:1000000});if(r.code!==0)throw new AgentError('git',redactError(r.stderr||r.stdout));return r.stdout.trimEnd();}
async function newWorktree(folder){
  const repo=await git(folder,['rev-parse','--show-toplevel']);
  const dirty=await git(repo,['status','--porcelain','--untracked-files=all']);
  if(dirty)throw new AgentError('dirty','Your source repository has uncommitted or untracked files. Commit/checkpoint safely yourself first; The coordinator will not reset or drop changes.');
  await fs.mkdir(ctx.globalStorageUri.fsPath,{recursive:true});
  const base=path.join(ctx.globalStorageUri.fsPath,'task-worktrees');await fs.mkdir(base,{recursive:true});
  const id=crypto.randomBytes(5).toString('hex');const dir=path.join(base,'task-'+id);const branch='mbnsfr-ai/task-'+id;
  await git(repo,['worktree','add','-b',branch,dir,'HEAD']);
  return {dir,branch,original:repo};
}
async function hasModifications(cwd){return Boolean(await git(cwd,['status','--porcelain','--untracked-files=all']));}
async function reportDiff(cwd){
  const status=await git(cwd,['status','--short','--untracked-files=all']);
  const diff=await git(cwd,['diff','--no-ext-diff','HEAD','--']);
  const check=await runProcess('git',['diff','--check'],{cwd,timeout:25000});
  return {status:status.slice(0,20000),diff:diff.slice(0,24000),truncated:diff.length>24000,diffCheck:check.code===0};
}
async function coordinator(task,mode){
  const root=workspaceRoot();if(!root){vscode.window.showWarningMessage('Open exactly one local repository folder to start a coordinated task.');return;}
  if(!vscode.workspace.isTrusted){vscode.window.showWarningMessage('This workspace is not trusted. The coordinator will not execute CLI agents or share workspace content.');return;}
  if(!task?.trim())return;
  const settings=config();
  const maybePaid=settings.allowPaidOrUnverifiedApis;
  const message=mode==='implement'
    ? 'Create an isolated Git worktree and let subscribed CLI agents edit within it? The task/repository may be sent to the selected AI providers. No merge, commit, AWS deployment or release will be performed. Separate provider quotas/charges may apply.'
    : 'Run a read-only multi-model workflow? Your task and, where requested, review context may be sent to the selected connected AI providers. Free tiers have limits; providers may retain data under their policies.';
  const choice=await vscode.window.showWarningMessage(message,{modal:true},'Approve run');if(choice!=='Approve run')return;
  logChannel.clear();logChannel.show(true);
  output(`mbnsfr AI v0.3 · ${mode.toUpperCase()} · ${new Date().toISOString()}`);
  output(`Routing: plan=${settings.routes.plan.join(' > ')}; implement=${settings.routes.implement.join(' > ')}; review=${settings.routes.review.join(' > ')}`);
  output(`API cost policy: ${maybePaid?'paid/unverified API providers enabled':'only free-quota and local APIs'}`);
  let worktree=null,final={},events=[],used=[];
  const abort=new AbortController();
  const execute=async(provider,prompt,stage,opts)=>{
    const r={...opts,cwd:worktree?.dir||root,signal:abort.signal,getKey:key=>ctx.secrets.get('mbAI.key.'+key)};
    if(provider.kind==='cli')return runCLI(provider,prompt,stage,r);
    return runAPI(provider,prompt,stage,r);
  };
  const report=e=>{events.push(e);output(`${e.stage}: ${e.id} · ${e.status}${e.kind?' ('+e.kind+')':''}${e.modelStatus?' ['+e.modelStatus+']':''}`);};
  try{
    await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'mbnsfr AI · coordinated task',cancellable:true},async(progress,token)=>{
      token.onCancellationRequested(()=>abort.abort());
      // Only implementation mode changes files. Separate Git worktrees are mandatory.
      if(mode==='implement'){
        progress.report({message:'Creating isolated Git worktree'});
        worktree=await newWorktree(root);output(`Isolated worktree: ${worktree.dir}\nBranch: ${worktree.branch}`);
      }
      progress.report({message:'Planning using the least-cost eligible available model'});
      let planText='';
      try{
        const plan=await executeStage('plan',`Read-only planning task:\n${task}\n\nGive a short prioritized implementation plan.\n- ${ROOT_RULES}`,settings,execute,report);
        planText=plan.text;final.plan=plan;used.push(plan.id);output(`PLAN (${plan.id}):\n${plan.text.slice(0,9000)}\n`);
      }catch(e){
        if(abort.signal.aborted)throw new AgentError('cancel','Cancelled');
        output('Plan stage unavailable: '+e.message);if(e.attempted)output(JSON.stringify(e.attempted));
      }
      if(mode==='implement'){
        progress.report({message:'Implementing with one approved CLI agent'});
        const implPrompt=`Task:\n${task}\n\nPlan (unverified; inspect code yourself):\n${planText.slice(0,7000)}\n\nFollow repository rules and preserve existing architecture. Execute only safe local tests as permitted. Never commit or deploy.`;
        const impl=await executeStage('implement',implPrompt,settings,execute,report,()=>hasModifications(worktree.dir));
        final.implementation=impl;used.push(impl.id);output(`IMPLEMENTATION (${impl.id}):\n${impl.text.slice(0,9000)}\n`);
        const gitReport=await reportDiff(worktree.dir);final.gitReport=gitReport;
        output(`GIT STATUS:\n${gitReport.status||'(no changes)'}\nGit diff --check: ${gitReport.diffCheck?'PASS':'FAIL'}\n`);
        if(!gitReport.status){output('No file changes detected; cannot claim code was implemented.');}
      }
      progress.report({message:'Requesting independent review'});
      const reviewSettings={...settings,routes:{...settings.routes,review:settings.routes.review.filter(id=>id!==final.implementation?.id && id!==final.plan?.id)}};
      const reviewPrompt=mode==='implement'
        ? `Independent READ-ONLY review. Task:\n${task}\nPlan:\n${planText.slice(0,3000)}\nImplementation report:\n${(final.implementation?.text||'').slice(0,4000)}\nGit status:\n${final.gitReport.status.slice(0,3000)}\nGit diff (may be truncated):\n${final.gitReport.diff}\n${final.gitReport.truncated?'WARNING: Diff truncated; do not assert exhaustive review.':''}\nIdentify concrete defects, missing tests, safety risks. Do not claim you ran tests.\n- ${ROOT_RULES}`
        : `Independent READ-ONLY critical review of the task and plan, NOT a code audit:\nTask: ${task}\nProposed plan: ${planText.slice(0,10000)}\nLook for risks, errors, and a leaner approach.`;
      try{
        const review=await executeStage('review',reviewPrompt,reviewSettings,execute,report);
        final.review=review;used.push(review.id);output(`REVIEW (${review.id}):\n${review.text.slice(0,9000)}\n`);
      }catch(e){if(abort.signal.aborted)throw new AgentError('cancel','Cancelled');output('Independent review unavailable: '+e.message);if(e.attempted)output(JSON.stringify(e.attempted));}
    });
    lastSummary=`${mode} · ${[...new Set(used)].join(' → ')||'none'} · ${worktree?'worktree '+worktree.branch:'read-only'} · ${final.review?'review completed':'review unavailable'}`;
    output('COMPLETE. Manual review required. No branch merged, no deploy/release, no AWS changes initiated by mbnsfr.');
    await ctx.globalState.update('lastRun',{date:new Date().toISOString(),mode,providers:used,branch:worktree?.branch||null});
    vscode.window.showInformationMessage(`mbnsfr AI: ${mode} workflow finished. ${worktree?'Review branch '+worktree.branch+'. ':''}Open mbnsfr AI Output for results.`);
  }catch(err){
    output(`STOPPED · ${err.kind||'error'}: ${redactError(err.message)}`);
    if(err.attempted)output('Attempts: '+JSON.stringify(err.attempted));
    if(worktree)output(`Partial worktree preserved for review: ${worktree.dir} (${worktree.branch}). Do not delete without reviewing.`);
    lastSummary=`Stopped (${err.kind||'error'}). ${worktree?'Worktree preserved.':''}`;
    vscode.window.showWarningMessage('mbnsfr AI stopped safely: '+redactError(err.message)+' (details in mbnsfr AI Output)');
  }
  refresh();
}
async function startTask(mode){const task=await vscode.window.showInputBox({prompt:mode==='implement'?'Describe the implementation task (edits happen ONLY in a new worktree)':'Describe the read-only planning/review task',ignoreFocusOut:true,validateInput:x=>x.length>8000?'Keep the task under 8000 characters':undefined});if(task?.trim())return coordinator(task,mode);}
function html(){const nonce=crypto.randomBytes(12).toString('base64');const state=providerStatus();const cards=Object.entries(OFFICIAL).map(([id,p])=>`<article><header><h3>${esc(p.name)}</h3><span class="pill">${id==='microsoft'?'Browser handoff':id==='github'?'Optional, separate':state[id].installed?'Extension installed':'Needs setup'}</span></header><p>${esc(p.guide)}</p><div class="actions"><button data-act="open:${id}" class="primary">${id==='microsoft'?'Open Copilot':'Open agent'}</button><button data-act="guide:${id}">Setup</button></div></article>`).join('');
  const APIs=Object.entries(API_PROVIDERS).map(([id,p])=>`<span class="chip">${esc(p.label)}${p.tier==='paid-or-free-eligibility'?' · opt-in':''}</span>`).join('');
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>body{background:var(--vscode-editor-background);color:var(--vscode-foreground);font:13px var(--vscode-font-family);padding:22px;max-width:1150px;margin:auto}h1{font-size:26px;margin:0 0 10px}h2{font-size:17px;margin:23px 0 12px}h3{font-size:15px;margin:0}p{line-height:1.55;color:var(--vscode-descriptionForeground)}.lead{font-size:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}article,.coordinator{border:1px solid var(--vscode-panel-border);border-radius:10px;padding:16px;background:var(--vscode-sideBar-background)}header{display:flex;align-items:start;gap:10px;justify-content:space-between}.pill{font-size:11px;color:var(--vscode-descriptionForeground)}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:13px}button{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);border:0;border-radius:5px;padding:9px 12px;cursor:pointer}button.primary{color:var(--vscode-button-foreground);background:var(--vscode-button-background)}button:hover{filter:brightness(1.13)}textarea{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:12px;border-radius:5px;min-height:105px;resize:vertical;font:inherit}.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{padding:6px 9px;border-radius:14px;background:var(--vscode-editorWidget-background);font-size:11px}.note{font-size:12px;color:var(--vscode-descriptionForeground);line-height:1.6}.summary{margin-top:8px;padding:9px 11px;border-left:3px solid var(--vscode-focusBorder);background:var(--vscode-editorWidget-background)}</style></head><body><h1>mbnsfr AI Coding Assistant <small>v0.3</small></h1><p class="lead">Coordinator for existing CLI subscriptions and free/API/local models. Microsoft Copilot is personal-account browser access, not GitHub Copilot.</p><section class="coordinator"><h2>Coordinated workflow</h2><p>One task → cost-aware plan → isolated implementation (optional) → independent review. Automatic retry for quotas; stop if an implementation attempt has already modified files.</p><textarea id="task" maxlength="8000" placeholder="Describe the task. Never paste API keys or secrets here."></textarea><div class="actions"><button class="primary" data-act="plan">Plan + review (read-only)</button><button data-act="implement">Implement in isolated worktree</button><button data-act="log">Show run log</button></div><div class="summary"><strong>Last result:</strong> ${esc(lastSummary)}</div></section><h2>Existing subscriptions & apps</h2><section class="grid">${cards}</section><h2>Free, local and optional paid API engines</h2><section class="chips">${APIs}</section><div class="actions"><button class="primary" data-act="api">Configure API or local model</button><button data-act="pin">Pin official CLI model</button><button data-act="rules">Add repository safety instructions</button><button data-act="copy">Copy handoff for Microsoft Copilot</button><button data-act="byok">VS Code BYOK</button><button data-act="docs">Setup guide</button></div><p class="note">Limits/downgrades can only be detected from returned status/model metadata. Installed ≠ signed in. Unverified model IDs are reported, never assumed. API keys are stored in VS Code SecretStorage. Default routing excludes API providers without confirmed free eligibility. Review worktree changes before merging anything.</p><script nonce="${nonce}">const vscode=acquireVsCodeApi();document.addEventListener('click',e=>{const b=e.target.closest('button[data-act]');if(b)vscode.postMessage({action:b.dataset.act,task:document.getElementById('task').value});});</script></body></html>`;}
function refresh(){if(panel)panel.webview.html=html();}
async function onMessage(m){const action=m?.action;if(typeof action!=='string')return;
  if(action==='plan'||action==='implement')return coordinator(String(m.task||'').slice(0,8000),action);
  if(action==='api')return configureAPI();if(action==='pin')return pinModel();if(action==='rules')return installInstructions();if(action==='copy')return copyHandoff();
  if(action==='byok')return safeCommand('workbench.action.chat.manageLanguageModels');if(action==='log')return logChannel.show();
  if(action==='docs')return vscode.window.showTextDocument(vscode.Uri.joinPath(ctx.extensionUri,'README.md'));
  if(action.startsWith('open:')&&OFFICIAL[action.slice(5)])return openProvider(action.slice(5));
  if(action.startsWith('guide:')&&OFFICIAL[action.slice(6)])return guideProvider(action.slice(6));
}
function start(){if(panel){panel.reveal();refresh();return;}
  panel=vscode.window.createWebviewPanel('mbAIhub','mbnsfr AI · Multi-Agent Coordinator',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,enableCommandUris:false,localResourceRoots:[]});
  panel.webview.html=html();panel.webview.onDidReceiveMessage(onMessage,null,ctx.subscriptions);panel.onDidDispose(()=>panel=undefined,null,ctx.subscriptions);
}
function activate(context){ctx=context;logChannel=vscode.window.createOutputChannel('mbnsfr AI Coordinator');context.subscriptions.push(logChannel);
  const reg=(id,fn)=>context.subscriptions.push(vscode.commands.registerCommand(id,fn));
  reg('mbAI.start',start);reg('mbAI.configure',configureAccount);reg('mbAI.configureAPI',configureAPI);reg('mbAI.pinModel',pinModel);
  reg('mbAI.runPlan',()=>startTask('plan'));reg('mbAI.runImplement',()=>startTask('implement'));
  reg('mbAI.openClaude',()=>openProvider('claude'));reg('mbAI.openCodex',()=>openProvider('codex'));reg('mbAI.openGemini',()=>openProvider('antigravity'));
  reg('mbAI.openCopilot',()=>openProvider('microsoft'));reg('mbAI.openGitHubCopilot',()=>openProvider('github'));
  reg('mbAI.copyHandoff',copyHandoff);reg('mbAI.installGuardrails',installInstructions);
  reg('mbAI.showGuide',()=>vscode.window.showTextDocument(vscode.Uri.joinPath(ctx.extensionUri,'README.md')));
  context.subscriptions.push(vscode.extensions.onDidChange(refresh));
  const item=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right,65);item.text='$(hubot) mbnsfr AI';item.command='mbAI.start';item.tooltip='mbnsfr AI · multi-agent coordinator';item.show();context.subscriptions.push(item);
}
function deactivate(){panel=undefined;}
module.exports={activate,deactivate};
