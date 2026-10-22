const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function analytics(){
 const source=fs.readFileSync('src/analytics.ts','utf8');
 const context={exports:{},window:{},document:{createElement:()=>({}),head:{appendChild(){}},getElementsByTagName:()=>[{parentNode:{insertBefore(){}}}]}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
 return context;
}
test('replay disabled and text/input defenses explicit',()=>{
 const c=analytics(),config=c.window.posthog._i[0][1];
 assert.equal(config.disable_session_recording,true);
 assert.equal(config.session_recording.maskAllInputs,true);
 assert.equal(config.session_recording.maskTextSelector,'*');
 assert.equal(config.autocapture,false);
 assert.equal(config.person_profiles,'never');
});
test('event allowlist drops names, filenames, error text and account data',()=>{
 const c=analytics(),events=[];c.window.posthog.capture=(...a)=>events.push(a);
 c.exports.captureEvent('skill_downloaded',{target:'claude',file_count:2,email:'private@example.invalid',name:'private',file_name:'secret.md',skill_name:'confidential',error:'email in error',user_agent:'ua',referrer:'url',session_id:'opaque'});
 assert.equal(JSON.stringify(events[0][1]),JSON.stringify({target:'claude',file_count:2,session_id:'opaque'}));
 assert.equal(c.exports.identifyUser,undefined);
});
test('app no longer identifies Clerk users or emits document names',()=>{
 const app=fs.readFileSync('src/App.tsx','utf8');
 assert.equal(app.includes('identifyUser('),false);
 for(const line of app.split('\n').filter(x=>x.includes('captureEvent('))){
  assert.equal(/skill_name:|file_name:|email:/.test(line),false,line);
 }
});
