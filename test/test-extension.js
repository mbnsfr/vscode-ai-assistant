'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const {EventEmitter} = require('node:events');

(async () => {
  const fakeFs = new Map();
  const registered = new Map();
  const events = new EventEmitter();
  const external = [];
  const ran = [];
  const infos = [];
  const warning = [];
  const notifications = [];
  const installed = new Map([
    ['OpenAI.chatgpt', {packageJSON:{contributes:{commands:[
      {command:'codex.openPanel', title:'Open Codex Panel'},
      {command:'codex.logout', title:'Sign Out'},
      {command:'codex.erase', title:'Delete All Chats'}
    ]}}}],
    ['GitHub.copilot-chat', {packageJSON:{contributes:{commands:[]}}}]
  ]);
  let pickReturn;
  let confirmReturn='Create files';
  let inputReturn='Fix flaky test';
  let clipboard='';
  let html='';
  let postHandler;
  const vscode = {
    extensions: {getExtension:id=>installed.get(id), onDidChange:cb=>({dispose(){}})},
    Uri: {
      parse:s=>({toString:()=>s, path:s}),
      joinPath:(base,...parts)=>({path:path.posix.join(base.path,...parts)})
    },
    commands: {
      registerCommand:(id,cb)=>{registered.set(id,cb);return {dispose(){}};},
      executeCommand:async (id,...args)=>{ran.push([id,...args]); if(id==='codex.openPanel'||id==='workbench.action.chat.open')return true; throw new Error('Unknown command');}
    },
    workspace: {
      workspaceFolders:[{name:'safe-repo',uri:{path:'/safe-repo'}}],
      fs: {
        stat:async uri=>{if(fakeFs.has(uri.path)) return {type:1};const e=new Error('not found'); e.code='FileNotFound'; throw e;},
        createDirectory:async uri=>{},
        writeFile:async (uri,bytes)=>{fakeFs.set(uri.path,bytes.toString('utf8'));}
      }
    },
    env: {openExternal:async uri=>{external.push(uri.path);},clipboard:{writeText:async text=>{clipboard=text;}}},
    window: {
      showQuickPick:async (items, opts)=>typeof pickReturn==='function'?pickReturn(items,opts):pickReturn,
      showInformationMessage:async (message,...rest)=>{infos.push(message);return notifications.shift();},
      showWarningMessage:async (message,...rest)=>{warning.push(message);return confirmReturn;},
      showErrorMessage:async message=>{throw new Error('Unexpected UI error: '+message);},
      showInputBox:async ()=>inputReturn,
      showTextDocument:async ()=>{},
      createStatusBarItem:()=>({show(){},dispose(){}}),
      createWebviewPanel:()=>{
        const panel={
          webview: {
            get html(){return html;},set html(value){html=value;},
            onDidReceiveMessage:(fn)=>{postHandler=fn;return {dispose(){}};}
          },
          reveal:()=>{},onDidDispose:()=>({dispose(){}})
        };
        return panel;
      }
    },
    StatusBarAlignment:{Right:1}, ViewColumn:{One:1}
  };
  const original = Module._load;
  Module._load = function(request,parent,isMain) {
    if (request==='vscode') return vscode;
    return original.apply(this,arguments);
  };
  const mod=require('../extension.js');
  Module._load = original;
  const ctx={subscriptions:[],extensionUri:{path:'/extension'}};
  mod.activate(ctx);
  assert.equal(registered.size,9);
  await registered.get('mbAI.start')();
  assert.match(html,/Official extension installed/);
  assert.match(html,/Official extension not installed/);
  assert.match(html,/Google Antigravity/);
  assert.match(html,/script-src 'nonce-[a-zA-Z0-9+/=]+'/);
  assert.ok(typeof postHandler==='function');

  // Never claim provider sign-in merely from installation.
  assert.match(html,/Installed does not mean signed in/);

  // Non-installed Claude offers only official Marketplace link with confirmation.
  notifications.push('Open Marketplace');
  await registered.get('mbAI.openClaude')();
  assert.ok(external.some(x=>x.includes('anthropic.claude-code')));

  // Installed Codex exposes official command (not a made-up command / login flow).
  pickReturn=items=>{
    assert.ok(items.some(i=>i.value==='codex.openPanel'));
    assert.ok(!items.some(i=>i.value==='codex.logout'));
    assert.ok(!items.some(i=>i.value==='codex.erase'));
    return items.find(i=>i.value==='codex.openPanel');
  };
  await registered.get('mbAI.openCodex')();
  assert.ok(ran.some(x=>x[0]==='codex.openPanel'));

  // Guardrails skip existing files without writes and write only selected files.
  fakeFs.set('/safe-repo/AGENTS.md','Existing user rules: preserve!');
  pickReturn=items=>items.filter(i=>i.path);  // select all three
  await registered.get('mbAI.installGuardrails')();
  assert.equal(fakeFs.get('/safe-repo/AGENTS.md'),'Existing user rules: preserve!');
  assert.ok(fakeFs.get('/safe-repo/CLAUDE.md').includes('authorization'));
  assert.ok(fakeFs.get('/safe-repo/.github/instructions/ai-coding.instructions.md').includes('applyTo:'));

  // Copy handoff: manually transferred by user, no automatic API call.
  await registered.get('mbAI.copyHandoff')();
  assert.ok(clipboard.includes('Fix flaky test'));
  assert.ok(clipboard.includes('Avoid parallel modification'));
  assert.ok(!ran.some(x=>String(x[0]).includes('sendMessage')));

  // Hub untrusted arbitrary messages do nothing.
  const before=ran.length;
  await postHandler({action:'open:nonexistent'});
  assert.equal(ran.length,before);
  await postHandler({action:'refresh'});
  assert.match(html,/Google Antigravity/);
  console.log('PASS: hub, installation detection, official commands, non-overwrite guardrails, handoff, message whitelist');
})().catch(e=>{console.error(e);process.exitCode=1;});
