const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const script = fs.readFileSync(__dirname + "/app.js", "utf8");
const pause = () => new Promise(resolve => setTimeout(resolve, 15));
function setup({enabled=true,auth={},fetch}={}) {
  const dom = new JSDOM(html, {url:"https://staff.example.com",runScripts:"outside-only"});
  const w = dom.window;
  w.DIAMOND_ECHO_STAFF_CONFIG = {enabled, staffOrigin:w.location.origin, apiBase:"https://api.example.com"};
  w.DIAMOND_ECHO_STAFF_AUTH = {signIn:async()=>({type:"mfa"}), completeMfa:async()=>({type:"ready"}),
    getToken:async()=>"named-id-token", signOut:async()=>{}, ...auth};
  w.fetch = fetch || (async()=>({ok:true,status:200,json:async()=>({items:[]})}));
  w.eval(script);
  const el = id => w.document.getElementById(id);
  const submit = id => el(id).dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true}));
  return {w,el,submit};
}
async function login(ui) {
  ui.el("email").value="staff@example.com"; ui.el("password").value="not-a-real-password";
  ui.submit("signin-form"); await pause();
  ui.el("code").value="123456"; ui.submit("mfa-form"); await pause();
}
test("unconfigured deployment blocks sign-in",()=>{
  const ui=setup({enabled:false}); assert.equal(ui.el("signin-button").disabled,true);
});
test("MFA required before any queue request and password cleared",async()=>{
  let calls=0;
  const ui=setup({fetch:async()=>{calls++;return {ok:true,status:200,json:async()=>({items:[]})};}});
  ui.submit("signin-form"); await pause();
  assert.equal(calls,0); assert.equal(ui.el("password").value,"");
  ui.submit("mfa-form"); await pause();
  assert.equal(calls,1); assert.equal(ui.el("queue-section").hidden,false);
});
test("token request omits cookies and visitor HTML is rendered as text",async()=>{
  let options;
  const ui=setup({fetch:async(_,init)=>{options=init;return {ok:true,status:200,json:async()=>({items:[{
    kind:"buyer",status:"queued",request_id:"ref",full_name:"<script>attack</script>",email:"visitor@example.com"}]})};}});
  await login(ui);
  assert.equal(options.credentials,"omit");assert.equal(options.cache,"no-store");
  assert.equal(options.headers.Authorization,"Bearer named-id-token");
  assert.equal(ui.el("inquiries").querySelector("script"),null);
  assert.match(ui.el("inquiries").textContent,/<script>attack<\/script>/);
  ui.el("signout-button").click();await pause();
  assert.equal(ui.el("inquiries").textContent,"");
});
test("first login enrollment requires fresh MFA sign-in",async()=>{
  const ui=setup({auth:{signIn:async()=>({type:"enroll",secret:"TESTSECRET"}),completeEnrollment:async()=>({type:"enrolled"})}});
  ui.submit("signin-form");await pause();assert.equal(ui.el("secret").textContent,"TESTSECRET");
  ui.submit("mfa-form");await pause();assert.equal(ui.el("secret").textContent,"");
  assert.equal(ui.el("queue-section").hidden,true);
});
test("signout prevents late response from restoring visitor data",async()=>{
  let release;
  const ui=setup({fetch:()=>new Promise(resolve=>{release=resolve;})});
  await login(ui);ui.el("signout-button").click();await pause();
  release({ok:true,status:200,json:async()=>({items:[{kind:"buyer",status:"queued",full_name:"Private"}]})});
  await pause();assert.equal(ui.el("inquiries").textContent,"");assert.equal(ui.el("queue-section").hidden,true);
});
test("403 clears queue and demands approved identity",async()=>{
  const ui=setup({fetch:async()=>({ok:false,status:403})});
  await login(ui);assert.equal(ui.el("queue-section").hidden,true);
  assert.match(ui.el("alert").textContent,/Access denied/);
});
test("acknowledgement uses verified API receipt then refreshes",async()=>{
  const paths=[];
  const ui=setup({fetch:async(path,opts)=>{
    paths.push([path,opts.method]);
    return {ok:true,status:200,json:async()=>opts.method==="PATCH"?{status:"acknowledged"}:{items:[{kind:"buyer",status:"queued",request_id:"ref"}]}};
  }});
  await login(ui);ui.el("inquiries").querySelector("button").click();await pause();
  assert.equal(paths[1][0],"https://api.example.com/api/v1/inquiries/staff/ref/acknowledge");
  assert.equal(paths[1][1],"PATCH");assert.equal(paths.length,3);
});
