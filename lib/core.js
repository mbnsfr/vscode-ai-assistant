'use strict';

// Pure policy engine; no network calls or VS Code dependencies.
const {randomUUID} = require('crypto');
const API_PROVIDERS = Object.freeze({
  'groq-oss': {label:'Groq · GPT-OSS 120B', kind:'openai', key:'groq', url:'https://api.groq.com/openai/v1/chat/completions', model:'openai/gpt-oss-120b', tier:'free-quota'},
  'groq-qwen': {label:'Groq · Qwen3.8 27B', kind:'openai', key:'groq', url:'https://api.groq.com/openai/v1/chat/completions', model:'qwen/qwen3.8-27b', tier:'free-quota'},
  'openrouter-free': {label:'OpenRouter · Free model router', kind:'openai', key:'openrouter', url:'https://openrouter.ai/api/v1/chat/completions', model:'openrouter/free', tier:'free-quota', dynamic:true},
  'ollama': {label:'Ollama · Local', kind:'openai', key:null, url:'http://127.0.0.1:11434/v1/chat/completions', model:'', tier:'local'},
  'lmstudio': {label:'LM Studio / llama.cpp · Local', kind:'openai', key:null, url:'http://127.0.0.1:1234/v1/chat/completions', model:'', tier:'local'},
  'gemini-api': {label:'Google Gemini API', kind:'gemini', key:'gemini', model:'gemini-3.8-flash', tier:'paid-or-free-eligibility'},
  'cloudflare': {label:'Cloudflare Workers AI', kind:'openai', key:'cloudflare', url:'', model:'@cf/openai/gpt-oss-120b', tier:'paid-or-free-eligibility'},
  'nvidia': {label:'NVIDIA NIM API', kind:'openai', key:'nvidia', url:'https://integrate.api.nvidia.com/v1/chat/completions', model:'', tier:'paid-or-free-eligibility'},
  'cerebras': {label:'Cerebras API', kind:'openai', key:'cerebras', url:'https://api.cerebras.ai/v1/chat/completions', model:'', tier:'paid-or-free-eligibility'},
  'deepseek': {label:'DeepSeek API', kind:'openai', key:'deepseek', url:'https://api.deepseek.com/chat/completions', model:'', tier:'paid-or-free-eligibility'},
  'custom': {label:'Custom compatible API / Hugging Face endpoint', kind:'openai', key:'custom', url:'', model:'', tier:'paid-or-free-eligibility'}
});
const CLI_PROVIDERS = Object.freeze({
  codex: {label:'Codex CLI · ChatGPT sign-in', bin:'codex'},
  claude: {label:'Claude Code CLI · subscription sign-in', bin:'claude'},
  antigravity: {label:'Antigravity CLI · Google sign-in', bin:'agy'}
});
const ROUTES = Object.freeze({
  plan:['groq-oss','groq-qwen','openrouter-free','ollama','lmstudio','claude','codex','antigravity'],
  implement:['codex','claude','antigravity'],
  review:['groq-qwen','groq-oss','openrouter-free','ollama','lmstudio','claude','antigravity','codex']
});
const ROOT_RULES = [
  'Be concise, precise, and inspect actual repository state; never claim tests were run unless you ran them.',
  'Never deploy, merge, commit, publish, release, enable live metering, modify production billing, or execute Terraform apply/destroy.',
  'Never disclose secrets or weaken access controls. Review any change to authentication, authorization, billing, or multi-tenant boundaries.',
  'Do not reset/clean/overwrite previous agent work. Document any blocked tools, failures, and remaining work.',
  'For code changes, work only in the provided isolated worktree, and do not alter another repository/worktree.'
].join('\n- ');

class AgentError extends Error {
  constructor(kind, message, extras={}) { super(message); this.name='AgentError'; this.kind=kind; Object.assign(this, extras); }
}
function classifyError(status, text='') {
  const s=String(text).slice(0,4000).toLowerCase();
  if (Number(status)===429 || /rate.limit|quota (?:exceeded|reached)|usage limit (?:reached|exceeded)|too many requests|resource_exhausted|daily limit|billing limit/.test(s)) return 'quota';
  if (Number(status)===401 || Number(status)===403 || /authentication required|unauthorized|invalid api key|permission denied|not logged in/.test(s)) return 'auth';
  if (/model (?:not (?:available|found|supported)|unavailable)|model_not_found|unknown model/.test(s)) return 'model';
  if (/permission.*(?:denied|not granted)|approval required|tool.*blocked|soft.denied/.test(s)) return 'permission';
  if (/timeout|timed out|etimedout/.test(s)) return 'timeout';
  if (Number(status)>=500 || /service unavailable|overloaded/.test(s)) return 'temporary';
  return 'other';
}
function modelCheck(requested, actual, strict=false, dynamic=false) {
  if (dynamic) return {status:'dynamic-free', actual:actual || 'not reported'};
  if (!requested) return {status:'not-pinned',actual:actual || 'not reported'};
  if (!actual) return {status:strict?'unverified-block':'unverified',actual:'not reported'};
  const normalize=x=>String(x).toLowerCase().replace(/^models\//,'').replace(/-latest$/,'');
  return {status:normalize(requested)===normalize(actual)?'matched':'downgraded', actual};
}
function assertEndpoint(endpoint, providerId) {
  let url;
  try {url=new URL(endpoint);} catch {throw new AgentError('config',`Invalid endpoint URL for ${providerId}`);}
  if (url.username || url.password || url.hash || url.search) throw new AgentError('config','Endpoint may not contain credentials, fragments or query parameters');
  const isLocal=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.protocol!=='https:' && !(isLocal && url.protocol==='http:')) throw new AgentError('config','Only HTTPS endpoints or loopback HTTP are allowed');
  if (providerId!=='custom' && ['ollama','lmstudio'].includes(providerId) && !isLocal) throw new AgentError('config','Local providers must use a loopback endpoint');
  return url.toString();
}
function getCandidate(id,config={}) {
  const cli=CLI_PROVIDERS[id]; if(cli) return {...cli,id,kind:'cli',tier:'subscription'};
  const base=API_PROVIDERS[id]; if(!base) throw new AgentError('config','Unknown provider '+id);
  const prefix=config.models||{};
  const configured=prefix[id]||{};
  const model=String(configured.model||base.model||'').trim();
  const url=String(configured.endpoint||base.url||'').trim();
  if(!model || (base.kind==='openai' && !url)) throw new AgentError('config',`${id} needs a model${url?'':' and endpoint'} in mbnsfr AI settings`);
  return {...base,id,model,url:base.kind==='openai'?assertEndpoint(url,id):undefined};
}
function routeCandidates(stage, options={}) {
  const configured=options.routes?.[stage];
  const ids=Array.isArray(configured)?configured:ROUTES[stage];
  if(!ids) throw new AgentError('config','Unknown stage');
  const seen=new Set();
  return ids.filter(id => (API_PROVIDERS[id]||CLI_PROVIDERS[id]) && !seen.has(id) && seen.add(id)).filter(id => {
    if(stage==='implement') return Boolean(CLI_PROVIDERS[id]);
    if(API_PROVIDERS[id] && API_PROVIDERS[id].tier==='paid-or-free-eligibility' && !options.allowPaidOrUnverifiedApis) return false;
    return true;
  });
}
function redactError(s) { return String(s||'').replace(/sk-[A-Za-z0-9_\-]{12,}/g,'[REDACTED]').replace(/AIza[A-Za-z0-9_-]{20,}/g,'[REDACTED]').replace(/Bearer\s+[A-Za-z0-9._-]{12,}/ig,'Bearer [REDACTED]').slice(0,700); }

// Runs stages sequentially, with a maximum attempt count. No provider is retried
// in the same stage. Mutation guard is checked before every implementation fallback.
async function executeStage(stage, prompt, options, runProvider, onEvent, wasModified=async()=>false) {
  const attempted=[];
  const max=Math.max(1,Math.min(12,Number(options.maxAttempts)||4));
  for(const id of routeCandidates(stage,options).slice(0,max)) {
    if(stage==='implement' && attempted.length && await wasModified())
      throw new AgentError('partial-work','An implementation attempt changed files; switching is paused to protect partial work',{attempted});
    onEvent?.({stage,id,status:'starting'});
    try {
      const candidate=getCandidate(id,options);
      const response=await runProvider(candidate,prompt,stage,options);
      const check=modelCheck(response.requestedModel||candidate.model, response.model, Boolean(options.requireModelEvidence),Boolean(candidate.dynamic));
      if(['downgraded','unverified-block'].includes(check.status)) {
        const error=new AgentError('model-downgrade',`Expected ${response.requestedModel||candidate.model} but got ${check.actual}`);
        if(stage==='implement' && await wasModified()) throw new AgentError('partial-work', 'Model discrepancy after edits; inspect worktree before continuing',{attempted});
        throw error;
      }
      if(!response.text?.trim() && !response.allowEmpty) throw new AgentError('empty','Agent returned no usable text');
      attempted.push({id,status:'completed',modelStatus:check.status,model:check.actual});
      onEvent?.({stage,id,status:'completed',modelStatus:check.status});
      return {id, text:response.text||'', usage:response.usage||null, modelStatus:check.status, actualModel:check.actual, attempted};
    }catch(err){
      const kind=err.kind||classifyError(err.status,err.message);
      attempted.push({id,status:'failed',kind,detail:redactError(err.message)});
      onEvent?.({stage,id,status:'failed',kind});
      if(kind==='partial-work') throw new AgentError(kind,err.message,{attempted});
      if(stage==='implement' && await wasModified()) throw new AgentError('partial-work','An agent failed after modifying files; inspect the isolated worktree before choosing another agent',{attempted});
      // Unsupported/unconfigured candidates are omitted without charging the user.
    }
  }
  throw new AgentError('exhausted',`No eligible ${stage} provider completed successfully`,{attempted});
}
module.exports={API_PROVIDERS,CLI_PROVIDERS,ROUTES,ROOT_RULES,AgentError,classifyError,modelCheck,assertEndpoint,getCandidate,routeCandidates,executeStage,redactError};
