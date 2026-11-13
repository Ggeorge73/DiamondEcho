// The one way SRE scripts talk to GitHub (issues and labels only). It uses
// the standard fetch, so there is nothing to install, and fetch is passed in
// so a test never touches the network.
//
// Without a token the client is a dry run: every method logs what it would
// have done and returns an empty answer, so a script behaves the same on a
// laptop, in a pull request and in the scheduled workflow.
//
// Everything sent through here is public (the repository is public). Callers
// must never pass a secret, a token or visitor data in a title, body or
// comment. The token itself is only ever placed in the Authorization header.

const API_VERSION = "2022-11-28";
const USER_AGENT = "DiamondEcho-SRE-Monitor/1";
const TIMEOUT_MS = 15_000;

export function githubClient({
  token = process.env.GITHUB_TOKEN,
  repository = process.env.GITHUB_REPOSITORY,
  fetch: fetcher = globalThis.fetch,
  apiUrl = process.env.GITHUB_API_URL || "https://api.github.com",
  log = (line) => console.log(line),
} = {}) {
  const dryRun = !token || !repository;
  if (repository && !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("repository must look like owner/name");
  const base = `${apiUrl.replace(/\/+$/, "")}/repos/${repository}`;

  // One request. A failure is reported by method, path and status only: never
  // the token, never the body GitHub sent back.
  async function call(method, path, body) {
    let response;
    try {
      response = await fetcher(`${base}${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": API_VERSION,
          "User-Agent": USER_AGENT,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new GithubError(method, path, 0, error?.name === "TimeoutError" ? "timed out" : "no answer");
    }
    if (!response.ok) throw new GithubError(method, path, response.status, "refused");
    if (response.status === 204) return null;
    return response.json();
  }

  const would = (text) => log(`[github dry run] would ${text}`);
  const names = (labels) => (labels || []).map((label) => (typeof label === "string" ? label : label.name));
  const issuePath = (number) => {
    if (!Number.isInteger(number) || number < 1) throw new Error("issue number must be a whole number");
    return `/issues/${number}`;
  };

  return {
    dryRun,

    // Create the label if the repository does not have it yet.
    async ensureLabel(name, color = "ededed", description = "") {
      if (dryRun) return would(`make sure label "${name}" exists`);
      try {
        await call("GET", `/labels/${encodeURIComponent(name)}`);
      } catch (error) {
        if (error.status !== 404) throw error;
        try {
          await call("POST", "/labels", { name, color, description: description.slice(0, 100) });
        } catch (second) {
          // 422: another run created it in the same moment. That is fine.
          if (second.status !== 422) throw second;
        }
      }
    },

    async createIssue({ title, body, labels = [] }) {
      if (dryRun) {
        would(`open issue "${title}" [${labels.join(", ")}]`);
        return { number: null, html_url: null };
      }
      const issue = await call("POST", "/issues", { title, body, labels });
      return { number: issue.number, html_url: issue.html_url };
    },

    async comment(number, body) {
      if (dryRun) return would(`comment on issue #${number}`);
      await call("POST", `${issuePath(number)}/comments`, { body });
    },

    async closeIssue(number) {
      if (dryRun) return would(`close issue #${number}`);
      await call("PATCH", issuePath(number), { state: "closed", state_reason: "completed" });
    },

    // Open issues carrying the label, pull requests left out. At most 100:
    // more than that many open incidents is its own incident.
    async listOpenIssues(label) {
      if (dryRun) return [];
      const rows = await call("GET", `/issues?state=open&per_page=100&labels=${encodeURIComponent(label)}`);
      return rows.filter((row) => !row.pull_request)
        .map((row) => ({ number: row.number, title: row.title, html_url: row.html_url, labels: names(row.labels) }));
    },

    // The methods below go beyond the five in scripts/sre/README.md. The alert
    // engine needs them to tell whether a person has acknowledged an incident,
    // to change a severity label and title, and to reopen an issue that
    // started failing again. They follow the same rules: dry run without a
    // token.

    // Who commented and when; never the comment text (the engine has no use
    // for it, and it is not ours to copy around).
    async listComments(number) {
      if (dryRun) return [];
      const rows = await call("GET", `${issuePath(number)}/comments?per_page=100`);
      return rows.map((row) => ({
        login: row.user?.login || "",
        bot: row.user?.type === "Bot" || /\[bot\]$/.test(row.user?.login || ""),
        created_at: row.created_at,
      }));
    },

    async addLabels(number, labels) {
      if (dryRun) return would(`add labels [${labels.join(", ")}] to issue #${number}`);
      await call("POST", `${issuePath(number)}/labels`, { labels });
    },

    async removeLabel(number, name) {
      if (dryRun) return would(`remove label "${name}" from issue #${number}`);
      try {
        await call("DELETE", `${issuePath(number)}/labels/${encodeURIComponent(name)}`);
      } catch (error) {
        if (error.status !== 404) throw error; // already gone
      }
    },

    // A new title when an incident's severity changes ("has a minor
    // problem" to "is down"). Only the title: the body stays the record.
    async editIssue(number, { title }) {
      if (dryRun) return would(`retitle issue #${number} "${title}"`);
      await call("PATCH", issuePath(number), { title });
    },

    async reopenIssue(number) {
      if (dryRun) return would(`reopen issue #${number}`);
      await call("PATCH", issuePath(number), { state: "open" });
    },
  };
}

export class GithubError extends Error {
  constructor(method, path, status, what) {
    // The path can hold a label or an issue number, never a secret. Query
    // strings are dropped to keep the line short.
    super(`GitHub ${method} ${path.split("?")[0]} ${what}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "GithubError";
    this.status = status;
  }
}
