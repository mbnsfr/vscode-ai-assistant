'use strict';
const {spawn}=require('child_process');
const {AgentError,classifyError,redactError}=require('./core');
const MAX_RESPONSE=4*1024*1024;
const timeoutMs=240000;

function runProcess(bin,args,{cwd,stdin='',timeout=timeoutMs,signal,maxOutput=MAX_RESPONSE}={}) {
  return new Promise((resolve,reject)=>{
    let child,stdout='',stderr='',done=false;
    const finish=(err,data)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(err)reject(err);else resolve(data);};
    const abort=()=>{try{child?.kill();}catch{} finish(new AgentError('cancel','Cancelled'));};
    if(signal?.aborted) return reject(new AgentError('cancel','Cancelled'));
    try{child=spawn(bin,args,{cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:process.env});}
    catch(err){return reject(new AgentError('unavailable',`${bin} could not start: ${redactError(err.message)}`));}
    const timer=setTimeout(()=>{child.kill();finish(new AgentError('timeout',`${bin} timed out`));},timeout);
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',e=>finish(new AgentError(e.code==='ENOENT'?'unavailable':'other',`${bin}: ${redactError(e.message)}`)));
    const append=(which,part)=>{
      if(which==='out')stdout+=part;else stderr+=part;
      if(stdout.length+stderr.length>maxOutput){child.kill();finish(new AgentError('output-limit',`${bin} output limit exceeded`));}
    };
    child.stdout.on('data',x=>append('out',String(x)));
    child.stderr.on('data',x=>append('err',String(x)));
    child.on('close',(code)=>{if(!done)finish(null,{code,stdout,stderr});});
    if(stdin){child.stdin.on('error',()=>{}); child.stdin.end(stdin);} else child.stdin.end();
  });
}
function parseCli(id,payload){
  if(id==='codex') {
    let result='',model=null,usage=null,kind=null;
    for(const line of payload.split(/\r?\n/)){
      if(!line.trim())continue;
      try{
        const obj=JSON.parse(line);
        if(obj.type==='item.completed' && (obj.item?.type==='agent_message'||obj.item?.type==='message')) result=obj.item.text||obj.item.content||result;
        if(obj.type==='turn.completed')usage=obj.usage||usage;
        if(obj.type==='turn.failed') kind=JSON.stringify(obj.error||{});
        if(obj.model && typeof obj.model==='string')model=obj.model;
      }catch{}
    }
    return {text:typeof result==='string'?result:JSON.stringify(result),model,usage,failed:kind};
  }
  let obj;try{obj=JSON.parse(payload.trim());}catch{return {text:payload.trim(),model:null,usage:null,failed:null};}
  if(id==='claude') {
    const text=(typeof obj.result==='string'?obj.result:null)||(typeof obj.response==='string'?obj.response:null)||'';
    return {text,model:obj.model||obj.model_id||null,usage:obj.usage||null,failed:obj.is_error?String(obj.result||'Claude Code error'):null};
  }
  if(id==='antigravity'){
    const result=obj.result||{};
    const status=obj.status||result.status||'';
    return {text:obj.response||result.response||'',model:obj.model||result.model||null,usage:obj.usage||result.usage||null,failed:status&&status!=='SUCCESS'?String(obj.error||status):null};
  }
  return {text:payload.trim(),model:null,usage:null};
}
async function runCLI(candidate,prompt,stage,options={}){
  const bin=candidate.bin;
  const model=options.cliModels?.[candidate.id]||'';
  const task=stage==='implement' ? `Implement the task in this isolated worktree. Do not deploy, commit, merge, release or modify production resources. Do not execute Terraform apply/destroy or modify AWS/Marketplace metering. Work within this worktree only. Keep a concise report of exact changes and tests run.\n\n${prompt}` : `READ-ONLY ${stage.toUpperCase()} task. Do not edit files, execute modifying commands, deploy, or reveal secrets.\n\n${prompt}`;
  const args=candidate.id==='codex'
    ? ['exec','--sandbox',stage==='implement'?'workspace-write':'read-only','--json',...(model?['--model',model]:[]),'-']
    : candidate.id==='claude'
      ? ['-p',task,'--output-format','json','--permission-mode',stage==='implement'?'acceptEdits':'plan',...(model?['--model',model]:[])]
      : ['-p',task,'--output-format','json','--mode',stage==='implement'?'accept-edits':'plan','--sandbox',...(model?['--model',model]:[])];
  const r=await runProcess(bin,args,{cwd:options.cwd,stdin:candidate.id==='codex'?task:'',timeout:options.timeout||timeoutMs,signal:options.signal});
  if(r.code!==0)throw new AgentError(classifyError(r.code,r.stderr+' '+r.stdout),`${bin} exited ${r.code}: ${redactError(r.stderr||r.stdout)}`);
  const parsed=parseCli(candidate.id,r.stdout);
  if(parsed.failed)throw new AgentError(classifyError(0,parsed.failed),`${bin}: ${redactError(parsed.failed)}`);
  // stderr can include permission-denial diagnostics even when Antigravity exits 0.
  if(candidate.id==='antigravity' && /soft.denied|permission.*denied|tool.*blocked/i.test(r.stderr))
    throw new AgentError('permission','Antigravity reported blocked tools: '+redactError(r.stderr));
  return {...parsed,requestedModel:model||undefined};
}

async function runAPI(candidate,prompt,stage,options={}) {
  const key=candidate.key?await options.getKey(candidate.key):null;
  if(candidate.key && !key) throw new AgentError('unavailable',`${candidate.id} API key not configured`);
  const controller=new AbortController();
  const abort=()=>controller.abort(); options.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,options.timeout||60000);
  try {
    let url,body,headers={'Content-Type':'application/json'};
    if(candidate.kind==='gemini'){
      url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate.model)}:generateContent`;
      headers['x-goog-api-key']=key;
      body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:2048}};
    }else{
      url=candidate.url;
      if(key)headers.Authorization=`Bearer ${key}`;
      if(candidate.id==='openrouter-free')headers['X-Title']='mbnsfr AI Coding Assistant (Personal)';
      body={model:candidate.model,messages:[{role:'system',content:'Be accurate. Never claim you edited files or ran tests when you have not. Never expose secrets.'},{role:'user',content:prompt}],temperature:0.1,max_tokens:2048,stream:false};
    }
    let response;
    try{response=await (options.fetch||global.fetch)(url,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,redirect:'error'});}
    catch(err){throw new AgentError(err.name==='AbortError'?'timeout':'temporary','Provider request failed: '+redactError(err.message));}
    const raw=await response.text();
    if(raw.length>MAX_RESPONSE)throw new AgentError('output-limit','Provider response was too large');
    if(!response.ok){let msg='';try{const j=JSON.parse(raw);msg=j.error?.message||j.message||'';}catch{}throw new AgentError(classifyError(response.status,msg||raw),`HTTP ${response.status}: ${redactError(msg||raw)}`);}
    let obj;try{obj=JSON.parse(raw);}catch{throw new AgentError('invalid','Invalid provider JSON response');}
    if(candidate.kind==='gemini'){
      const text=(obj.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');
      if(obj.promptFeedback?.blockReason)throw new AgentError('blocked','Gemini blocked the prompt');
      return {text,model:obj.modelVersion||null,requestedModel:candidate.model,usage:obj.usageMetadata||null};
    }
    const content=obj.choices?.[0]?.message?.content;
    const text=typeof content==='string'?content:Array.isArray(content)?content.filter(x=>x.type==='text').map(x=>x.text).join('') :'';
    if(!text && obj.choices?.[0]?.finish_reason==='tool_calls')throw new AgentError('unsupported','API model called tools; no custom tools were enabled');
    return {text,model:obj.model||null,requestedModel:candidate.model,usage:obj.usage||null};
  }finally{clearTimeout(timer); options.signal?.removeEventListener('abort',abort);}
}
module.exports={runProcess,parseCli,runCLI,runAPI};
