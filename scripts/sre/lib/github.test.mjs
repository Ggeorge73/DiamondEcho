import { test } from "node:test";
import assert from "node:assert/strict";
import { githubClient, GithubError } from "./github.mjs";

// A stand-in for fetch: records every request and answers from a list.
function fakeFetch(answers) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected request ${init.method} ${url}`);
    if (answer instanceof Error) throw answer;
    const [status, json] = answer;
    return new Response(status === 204 ? null : JSON.stringify(json ?? {}), { status });
  };
  return { fetcher, calls };
}

const live = (answers, extra = {}) => {
  const { fetcher, calls } = fakeFetch(answers);
  const lines = [];
  const client = githubClient({ token: "t0ken-value", repository: "owner/repo", fetch: fetcher, apiUrl: "https://api.github.test", log: (line) => lines.push(line), ...extra });
  return { client, calls, lines };
};

test("without a token every method is a logged dry run and nothing is sent", async () => {
  const lines = [];
  const client = githubClient({ token: "", repository: "owner/repo", fetch: async () => { throw new Error("must not be called"); }, log: (line) => lines.push(line) });
  assert.equal(client.dryRun, true);
  await client.ensureLabel("sre-incident", "b60205", "x");
  assert.deepEqual(await client.createIssue({ title: "Website is down", body: "b", labels: ["sre-incident", "sev1"] }), { number: null, html_url: null });
  await client.comment(7, "still failing");
  await client.closeIssue(7);
  assert.deepEqual(await client.listOpenIssues("sre-incident"), []);
  assert.deepEqual(await client.listComments(7), []);
  await client.addLabels(7, ["sev1"]);
  await client.removeLabel(7, "sev2");
  await client.reopenIssue(7);
  await client.editIssue(7, { title: "Website is down" });
  assert.equal(lines.length, 8);
  assert.ok(lines.every((line) => line.startsWith("[github dry run] would ")));
  assert.match(lines[1], /open issue "Website is down" \[sre-incident, sev1\]/);
});

test("without a repository the client is also a dry run", () => {
  assert.equal(githubClient({ token: "x", repository: "", fetch: async () => {} }).dryRun, true);
});

test("a repository that is not owner/name is refused", () => {
  assert.throws(() => githubClient({ token: "x", repository: "https://github.com/a/b", fetch: async () => {} }), /owner\/name/);
});

test("createIssue posts once, with the token only in the header", async () => {
  const { client, calls } = live([[201, { number: 12, html_url: "https://github.test/owner/repo/issues/12", body: "ignored" }]]);
  const issue = await client.createIssue({ title: "Website is down", body: "text", labels: ["sre-incident", "sev1"] });
  assert.deepEqual(issue, { number: 12, html_url: "https://github.test/owner/repo/issues/12" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.test/repos/owner/repo/issues");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer t0ken-value");
  assert.deepEqual(calls[0].body, { title: "Website is down", body: "text", labels: ["sre-incident", "sev1"] });
  assert.ok(!JSON.stringify(calls[0].body).includes("t0ken-value"));
});

test("ensureLabel creates the label only when it is missing", async () => {
  const present = live([[200, { name: "sev1" }]]);
  await present.client.ensureLabel("sev1", "b60205", "d");
  assert.deepEqual(present.calls.map((c) => c.method), ["GET"]);

  const missing = live([[404, {}], [201, {}]]);
  await missing.client.ensureLabel("sre-incident", "b60205", "Opened by the SRE monitor");
  assert.deepEqual(missing.calls.map((c) => c.method), ["GET", "POST"]);
  assert.deepEqual(missing.calls[1].body, { name: "sre-incident", color: "b60205", description: "Opened by the SRE monitor" });

  const raced = live([[404, {}], [422, {}]]);
  await assert.doesNotReject(raced.client.ensureLabel("sev2"));
});

test("listOpenIssues leaves pull requests out and returns label names", async () => {
  const { client, calls } = live([[200, [
    { number: 3, title: "Website is down", html_url: "u3", labels: [{ name: "sre-incident" }, { name: "sev1" }] },
    { number: 4, title: "A pull request", html_url: "u4", labels: [], pull_request: {} },
  ]]]);
  assert.deepEqual(await client.listOpenIssues("sre-incident"), [{ number: 3, title: "Website is down", html_url: "u3", labels: ["sre-incident", "sev1"] }]);
  assert.match(calls[0].url, /\/issues\?state=open&per_page=100&labels=sre-incident$/);
});

test("comment, close and reopen go to the right place", async () => {
  const { client, calls } = live([[201, {}], [200, {}], [200, {}]]);
  await client.comment(12, "Still failing.");
  await client.closeIssue(12);
  await client.reopenIssue(12);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace("https://api.github.test/repos/owner/repo", "")}`),
    ["POST /issues/12/comments", "PATCH /issues/12", "PATCH /issues/12"]);
  assert.deepEqual(calls[1].body, { state: "closed", state_reason: "completed" });
  assert.deepEqual(calls[2].body, { state: "open" });
});

test("listComments reports who, when and only the first line, and marks bots", async () => {
  const { client } = live([[200, [
    { user: { login: "github-actions[bot]", type: "Bot" }, created_at: "2026-11-13T00:10:00Z", body: "opened" },
    { user: { login: "someone", type: "User" }, author_association: "OWNER", created_at: "2026-11-13T00:20:00Z", body: "  Status: rolling back now\r\nprivate words below" },
    { user: { login: "long", type: "User" }, created_at: "2026-11-13T00:30:00Z", body: "x".repeat(500) },
  ]]]);
  const comments = await client.listComments(12);
  assert.deepEqual(comments.slice(0, 2), [
    { login: "github-actions[bot]", bot: true, author_association: "NONE", created_at: "2026-11-13T00:10:00Z", first_line: "opened" },
    { login: "someone", bot: false, author_association: "OWNER", created_at: "2026-11-13T00:20:00Z", first_line: "Status: rolling back now" },
  ]);
  assert.equal(comments[2].first_line.length, 300);
  assert.ok(!JSON.stringify(comments).includes("private words"));
});

test("removing a label that is already gone is not an error", async () => {
  const { client } = live([[404, {}]]);
  await assert.doesNotReject(client.removeLabel(12, "sev2"));
});

test("a refusal names the method, path and status, never the token", async () => {
  const { client } = live([[403, { message: "secret detail from GitHub" }]]);
  await assert.rejects(client.comment(12, "x"), (error) => {
    assert.ok(error instanceof GithubError);
    assert.equal(error.status, 403);
    assert.equal(error.message, "GitHub POST /issues/12/comments refused (HTTP 403)");
    return true;
  });
});

test("a network failure is reported without the address or the cause", async () => {
  const { client } = live([new TypeError("fetch failed: https://api.github.test/?token=abc")]);
  await assert.rejects(client.closeIssue(12), { message: "GitHub PATCH /issues/12 no answer" });
});

test("a bad issue number is refused before anything is sent", async () => {
  const { client, calls } = live([]);
  await assert.rejects(client.comment("12; rm", "x"), /whole number/);
  assert.equal(calls.length, 0);
});

test("editIssue changes only the title", async () => {
  const { client, calls } = live([[200, { number: 7 }]]);
  await client.editIssue(7, { title: "Website is down" });
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].url, "https://api.github.test/repos/owner/repo/issues/7");
  assert.deepEqual(calls[0].body, { title: "Website is down" });
});

test("listComments reads every page, so an ack after the hundredth comment is seen", async () => {
  const filler = Array.from({ length: 100 }, (_, i) => ({ user: { login: "github-actions[bot]", type: "Bot" }, created_at: "2026-11-13T00:10:00Z", body: `update ${i}` }));
  const { client, calls } = live([
    [200, filler],
    [200, [{ user: { login: "someone", type: "User" }, author_association: "OWNER", created_at: "2026-11-14T00:00:00Z", body: "ack" }]],
  ]);
  const comments = await client.listComments(12);
  assert.equal(comments.length, 101);
  assert.equal(comments.at(-1).first_line, "ack");
  assert.deepEqual(calls.map((call) => new URL(call.url).searchParams.get("page")), ["1", "2"]);
});

test("listCheckRuns reads a commit's check runs and refuses anything that is not a commit", async () => {
  const { client, calls } = live([[200, { check_runs: [
    { name: "Cloudflare Pages: diamondecho", status: "completed", conclusion: "success", output: { text: "ignored" } },
    { name: "Backend tests", status: "in_progress", conclusion: null },
  ] }]]);
  assert.deepEqual(await client.listCheckRuns("0d53bd10aeedd0ab438a84d91c07b2c883b65ade"), [
    { name: "Cloudflare Pages: diamondecho", status: "completed", conclusion: "success" },
    { name: "Backend tests", status: "in_progress", conclusion: null },
  ]);
  assert.match(calls[0].url, /\/repos\/owner\/repo\/commits\/0d53bd10aeedd0ab438a84d91c07b2c883b65ade\/check-runs\?per_page=100$/);
  assert.equal(calls[0].method, "GET");
  await assert.rejects(client.listCheckRuns("main/../../x"), /a commit is needed/);
});
