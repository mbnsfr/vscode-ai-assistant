const test = require('node:test');
const assert = require('node:assert/strict');
const {modelCheck,classifyError,routeCandidates,executeStage,AgentError,assertEndpoint}=require('../lib/core');

test('quota and authentication classification',()=>{
  assert.equal(classifyError(429,'quota exceeded'),'quota');
  assert.equal(classifyError(401,'not logged in'),'auth');
  assert.equal(classifyError(503,'overloaded'),'temporary');
});
test('model downgrade and unknown telemetry are distinct',()=>{
  assert.equal(modelCheck('premium-model','basic-model').status,'downgraded');
  assert.equal(modelCheck('premium-model',null).status,'unverified');
  assert.equal(modelCheck('premium-model',null,true).status,'unverified-block');
});
test('paid and unverified APIs require opt-in',()=>{
  assert(!routeCandidates('plan').includes('gemini-api'));
  assert(routeCandidates('plan',{routes:{plan:['gemini-api']},allowPaidOrUnverifiedApis:true}).includes('gemini-api'));
});
test('endpoint rejects insecure public transport',()=>{
  assert.throws(()=>assertEndpoint('http://remote.example/v1/chat/completions','custom'));
  assert.match(assertEndpoint('http://127.0.0.1:11434/v1/chat/completions','ollama'),/^http:/);
});
test('failed planning model routes to next eligible engine',async()=>{
  const res=await executeStage('plan','test',{routes:{plan:['groq-oss','groq-qwen']},maxAttempts:2},async candidate=>{
    if(candidate.id==='groq-oss')throw new AgentError('quota','quota exceeded');
    return {text:'plan text',model:candidate.model};
  });
  assert.equal(res.id,'groq-qwen');assert.deepEqual(res.attempted.map(x=>x.status),['failed','completed']);
});
test('implementation failure with modified worktree halts fallback',async()=>{
  let started=0;
  await assert.rejects(()=>executeStage('implement','test',{routes:{implement:['codex','claude']}},async()=>{
    started++;throw new AgentError('quota','usage limit');
  },null,async()=>true),e=>e.kind==='partial-work');
  assert.equal(started,1);
});
