const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const script = fs.readFileSync(__dirname + "/app.js", "utf8");
const pause = () => new Promise(resolve => setTimeout(resolve, 15));
function setup({enabled=true,auth={},fetch,qr}={}) {
  const dom = new JSDOM(html, {url:"https://staff.example.com",runScripts:"outside-only"});
  const w = dom.window;
  w.DIAMOND_ECHO_STAFF_CONFIG = {enabled, staffOrigin:w.location.origin, apiBase:"https://api.example.com"};
  w.DIAMOND_ECHO_STAFF_AUTH = {signIn:async()=>({type:"mfa"}), completeMfa:async()=>({type:"ready"}),
    getToken:async()=>"named-id-token", signOut:async()=>{}, ...auth};
  w.fetch = fetch || (async()=>({ok:true,status:200,json:async()=>({items:[]})}));
  if (qr) w.DIAMOND_ECHO_STAFF_QR = qr;
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
test("a message about a failed attempt is cleared once a later attempt succeeds",async()=>{
  let codes=0, signIns=0;
  const ui=setup({auth:{
    signIn:async()=>{ if(signIns++===0) throw new Error("wrong password"); return {type:"mfa"}; },
    completeMfa:async()=>{ if(codes++===0) throw new Error("wrong code"); return {type:"ready"}; }}});
  ui.submit("signin-form");await pause();
  assert.equal(ui.el("alert").hidden,false);assert.match(ui.el("alert").textContent,/^Sign-in failed/);
  ui.submit("signin-form");await pause();
  assert.equal(ui.el("mfa-form").hidden,false);assert.equal(ui.el("alert").hidden,true);
  ui.el("code").value="000000";ui.submit("mfa-form");await pause();
  assert.equal(ui.el("alert").hidden,false);assert.match(ui.el("alert").textContent,/^Verification failed\. Retry the current authenticator code/);
  ui.el("code").value="123456";ui.submit("mfa-form");await pause();
  assert.equal(ui.el("queue-section").hidden,false);assert.equal(ui.el("alert").hidden,true);
});
test("a failed enrolment says to check the setup key and keeps the key on screen",async()=>{
  const ui=setup({auth:{signIn:async()=>({type:"enroll",secret:"TESTSECRET"}),completeEnrollment:async()=>{throw new Error("bad code");}}});
  ui.submit("signin-form");await pause();
  ui.el("code").value="000000";ui.submit("mfa-form");await pause();
  assert.match(ui.el("alert").textContent,/setup key in your authenticator matches the one shown/);
  assert.match(ui.el("alert").textContent,/sign in again for a new key/);
  assert.equal(ui.el("secret").textContent,"TESTSECRET");assert.equal(ui.el("queue-section").hidden,true);
});
test("the acknowledgement notice survives the list refresh that follows it",async()=>{
  const item={kind:"buyer",status:"queued",request_id:"ref",full_name:"Test",email:"visitor@example.com"};
  const ui=setup({fetch:async(_,init)=>({ok:true,status:200,json:async()=>init.method==="PATCH"?{request_id:"ref",status:"acknowledged"}:{items:[item]}})});
  await login(ui);
  ui.el("inquiries").querySelector("button").click();await pause();await pause();
  assert.equal(ui.el("notice").hidden,false);assert.equal(ui.el("notice").textContent,"Request acknowledged.");
});
const listOf = item => async()=>({ok:true,status:200,json:async()=>({items:[{kind:"tour",status:"queued",request_id:"ref",full_name:"Test",email:"visitor@example.com",...item}]})});
const shown = (ui,label) => { const dt=[...ui.el("inquiries").querySelectorAll("dt")].find(n=>n.textContent===label); return dt.nextElementSibling.textContent; };
test("the submitted time is shown in Eastern time with the zone named, not in UTC",async()=>{
  const ui=setup({fetch:listOf({submitted_at:"2026-10-05T16:45:19.123456+00:00"})});
  await login(ui);
  assert.match(shown(ui,"Submitted"),/^Mon, Oct 5, 2026, 12:45\sPM EDT$/);
});
test("a winter time is shown as standard time",async()=>{
  const ui=setup({fetch:listOf({submitted_at:"2026-12-01T15:00:00+00:00"})});
  await login(ui);
  assert.match(shown(ui,"Submitted"),/^Tue, Dec 1, 2026, 10:00\sAM EST$/);
});
test("a requested tour time is shown in Eastern time, including one that falls on the previous day there",async()=>{
  const ui=setup({fetch:listOf({preferred_tour_time:"2026-10-11T02:30:00Z",submitted_at:"2026-10-05T16:45:19+00:00"})});
  await login(ui);
  assert.match(shown(ui,"Tour time"),/^Sat, Oct 10, 2026, 10:30\sPM EDT$/);
});
test("a time that cannot be read is shown as it was sent",async()=>{
  const ui=setup({fetch:listOf({submitted_at:"not-a-time"})});
  await login(ui);
  assert.equal(shown(ui,"Submitted"),"not-a-time");
});

// ---- QR code at enrolment ----
const jsQR = require("jsqr");
const KEY = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const qrModule = import("./qr.js");
// The address is put together the way the Firebase SDK does it: the two names go in as given.
const setupUri = async () => { const {setupAccount,setupIssuer} = await qrModule;
  return "otpauth://totp/"+setupIssuer()+":"+setupAccount("staff@example.com","demo-diamondecho")+"?secret="+KEY+"&issuer="+setupIssuer()+"&algorithm=SHA1&digits=6"; };
const enrolling = async (options={}) => { const {qrMatrix} = await qrModule; const uri = await setupUri();
  const ui = setup({qr:qrMatrix, ...options, auth:{signIn:async()=>({type:"enroll",secret:KEY,uri}),completeEnrollment:async()=>({type:"enrolled"}), ...(options.auth||{})}});
  ui.submit("signin-form"); await pause(); return {ui,uri}; };
// Reads the drawn squares back out of the SVG and paints them as pixels, the way a camera would see them.
function pixels(svg, scale=4) {
  const size = Number(svg.getAttribute("viewBox").split(" ")[2]), width = size*scale;
  const data = new Uint8ClampedArray(width*width*4).fill(255);
  const squares = [...svg.querySelector("path").getAttribute("d").matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(m=>[Number(m[1]),Number(m[2])]);
  for (const [x,y] of squares) for (let dy=0; dy<scale; dy++) for (let dx=0; dx<scale; dx++) {
    const i = ((y*scale+dy)*width + x*scale+dx)*4; data[i]=data[i+1]=data[i+2]=0; }
  return {data,width,size,squares};
}
test("the enrolment code, read back as a camera would read it, is exactly the setup address",async()=>{
  const {ui,uri} = await enrolling();
  assert.equal(ui.el("qr-block").hidden,false);
  const image = pixels(ui.el("qr").querySelector("svg"));
  const read = jsQR(image.data,image.width,image.width);
  assert.ok(read,"the code could not be read"); assert.equal(read.data,uri);
});
test("the setup address names the issuer, the account with its project, and the same key that is shown",async()=>{
  const {ui,uri} = await enrolling(); const parsed = new URL(uri);
  assert.equal(parsed.protocol,"otpauth:"); assert.equal(parsed.host,"totp");
  assert.equal(decodeURIComponent(parsed.pathname),"/DiamondEcho staff:staff@example.com (demo-diamondecho)");
  assert.equal(parsed.searchParams.get("issuer"),"DiamondEcho staff");
  assert.equal(parsed.searchParams.get("secret"),ui.el("secret").textContent);
  assert.doesNotMatch(uri,/ /);
});
test("the code is plain SVG with a quiet border: no image, no canvas, no style attribute, and it has a name",async()=>{
  const {ui} = await enrolling(); const box = ui.el("qr"), svg = box.querySelector("svg");
  assert.equal(ui.w.document.querySelectorAll("img, canvas, [style], style").length,0);
  assert.equal(svg.getAttribute("role"),"img"); assert.match(svg.getAttribute("aria-label"),/QR code/);
  const {size,squares} = pixels(svg); assert.ok(squares.length>200);
  for (const [x,y] of squares) assert.ok(x>=4 && y>=4 && x<size-4 && y<size-4);
  assert.equal(svg.querySelector("rect").getAttribute("fill"),"#ffffff");
  assert.equal(svg.querySelector("path").getAttribute("fill"),"#000000");
});
test("the setup key stays on screen as the way in for someone who cannot scan",async()=>{
  const {ui} = await enrolling();
  assert.equal(ui.el("secret").textContent,KEY); assert.equal(ui.el("secret").hidden,false);
  assert.equal(ui.el("secret-label").textContent,"Cannot scan? Enter this setup key in the app instead:");
  assert.match(ui.el("enrollment").textContent,/Never share this screen, or a picture of it/);
});
test("with no code available, or one that fails to draw, enrolment still works from the key alone",async()=>{
  for (const qr of [undefined, ()=>{throw new Error("no");}, ()=>[]]) {
    const {ui} = await enrolling({qr});
    assert.equal(ui.el("qr-block").hidden,true); assert.equal(ui.el("qr").children.length,0);
    assert.equal(ui.el("secret").textContent,KEY);
    assert.equal(ui.el("secret-label").textContent,"Enter this setup key in the app:");
    ui.el("code").value="123456"; ui.submit("mfa-form"); await pause();
    assert.match(ui.el("notice").textContent,/Authenticator enrolled/);
  }
});
test("the code and the key are removed on cancel, after enrolment, and are never drawn at an ordinary sign-in",async()=>{
  const gone = ui => { assert.equal(ui.el("qr").children.length,0); assert.equal(ui.el("qr-block").hidden,true);
    assert.equal(ui.el("secret").textContent,""); assert.equal(ui.el("secret-label").hidden,true); };
  let {ui} = await enrolling(); ui.el("cancel-button").click(); await pause(); gone(ui);
  ({ui} = await enrolling()); ui.el("code").value="123456"; ui.submit("mfa-form"); await pause(); gone(ui);
  const {qrMatrix} = await qrModule; let calls = 0;
  ui = setup({qr:text=>{calls++;return qrMatrix(text);}}); ui.submit("signin-form"); await pause();
  assert.equal(ui.el("mfa-form").hidden,false); gone(ui); assert.equal(calls,0);
});
test("a failed enrolment code keeps the same QR code and key on screen for another try",async()=>{
  const {ui,uri} = await enrolling({auth:{completeEnrollment:async()=>{throw new Error("bad code");}}});
  ui.el("code").value="000000"; ui.submit("mfa-form"); await pause();
  assert.match(ui.el("alert").textContent,/Verification failed/);
  const image = pixels(ui.el("qr").querySelector("svg"));
  assert.equal(jsQR(image.data,image.width,image.width).data,uri); assert.equal(ui.el("secret").textContent,KEY);
});
test("the built staff site keeps its security headers, uses https only, and is not listed by search engines",()=>{
  const build = fs.readFileSync(__dirname + "/build.mjs", "utf8");
  for (const header of ["Cache-Control: no-store","X-Content-Type-Options: nosniff","Referrer-Policy: no-referrer","X-Frame-Options: DENY",
    "Strict-Transport-Security: max-age=15552000","X-Robots-Tag: noindex, nofollow"]) assert.ok(build.includes(header), header);
  // Nothing follows the age: no includeSubDomains (it would reach the mail hosts) and no preload.
  assert.ok(build.includes("Strict-Transport-Security: max-age=15552000\\n"));
});
