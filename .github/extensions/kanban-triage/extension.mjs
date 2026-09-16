import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[character]));
}

function parseJson(value) {
    try {
        return JSON.parse(value);
    } catch {
        throw new Error("GitHub returned invalid issue data.");
    }
}

async function getRepositoryIssues() {
    const { stdout } = await execFileAsync("gh", [
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,title,body,labels,comments,updatedAt,url,assignees",
    ], { cwd: process.cwd(), maxBuffer: 2_000_000 });
    return parseJson(stdout);
}

function rankIssue(issue) {
    const labels = (issue.labels ?? []).map((label) => String(label.name ?? "").toLowerCase());
    const priorityLabel = labels.some((label) => ["priority: high", "high priority", "urgent", "critical"].includes(label));
    const bugLabel = labels.some((label) => label === "bug" || label.includes("security"));
    const updatedAt = Date.parse(issue.updatedAt ?? "");
    const ageInDays = Number.isFinite(updatedAt) ? Math.max(0, (Date.now() - updatedAt) / 86_400_000) : 999;
    const recencyScore = Math.max(0, 20 - Math.min(20, ageInDays));
    const score = (priorityLabel ? 100 : 0) + (bugLabel ? 45 : 0) + recencyScore + Math.min(15, (issue.comments ?? []).length * 3) + (issue.assignees?.length ? 0 : 5);
    const reasons = [];
    if (priorityLabel) reasons.push("priority label");
    if (bugLabel) reasons.push("bug or security label");
    if (ageInDays < 7) reasons.push("recent activity");
    if ((issue.comments ?? []).length > 0) reasons.push(`${issue.comments.length} comment${issue.comments.length === 1 ? "" : "s"}`);
    if (!issue.assignees?.length) reasons.push("unassigned");
    return {
        ...issue,
        score,
        rationale: reasons.length ? `Ranked highly because of ${reasons.join(", ")}.` : "Ranked highly because it is among the most recently updated open issues.",
    };
}

async function triageIssues() {
    const issues = (await getRepositoryIssues()).map(rankIssue);
    issues.sort((left, right) => right.score - left.score || Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || right.number - left.number);
    return { top: issues.slice(0, 3), remainder: issues.slice(3), total: issues.length };
}

function issueCard(issue, featured) {
    const body = issue.body?.trim() || "No description provided.";
    return `<article class="issue-card${featured ? " featured" : ""}" data-testid="issue-card-${issue.number}">
      <div class="card-heading"><span class="issue-number">#${issue.number}</span><span class="score">Attention score ${issue.score}</span></div>
      <h3><a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)}</a></h3>
      <p class="description">${escapeHtml(body)}</p>
      ${featured ? `<p class="rationale"><strong>Why it is here:</strong> ${escapeHtml(issue.rationale)}</p>` : ""}
      <button type="button" class="context-button" data-issue-number="${issue.number}" data-testid="add-issue-${issue.number}">Add to current context</button>
    </article>`;
}

function renderHtml() {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Issue triage board</title>
    <style>
      :root { color-scheme: light dark; --surface: color-mix(in srgb, var(--background-color-default, #fff) 94%, var(--text-color-default, #1f2328) 6%); --surface-strong: color-mix(in srgb, var(--background-color-default, #fff) 86%, var(--text-color-default, #1f2328) 14%); }
      * { box-sizing: border-box; } body { margin: 0; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font: var(--text-body-medium, 14px)/var(--leading-body-medium, 20px) var(--font-sans, system-ui, sans-serif); }
      main { max-width: 980px; margin: 0 auto; padding: clamp(16px, 4vw, 32px); } header { border-bottom: 1px solid var(--border-color-default, #d0d7de); margin-bottom: 24px; padding-bottom: 18px; } h1 { font-size: clamp(26px, 4vw, 36px); line-height: 1.1; margin: 0; } .lede { color: var(--text-color-muted, #59636e); margin: 8px 0 0; }
      h2 { font-size: 18px; margin: 28px 0 12px; } .board { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(245px, 1fr)); } .issue-card { background: var(--surface); border: 1px solid var(--border-color-default, #d0d7de); border-radius: 12px; padding: 16px; } .issue-card.featured { border-color: color-mix(in srgb, var(--true-color-blue, #0969da) 55%, var(--border-color-default, #d0d7de)); box-shadow: 0 8px 24px color-mix(in srgb, var(--true-color-blue, #0969da) 14%, transparent); }
      .card-heading { align-items: center; display: flex; justify-content: space-between; gap: 8px; } .issue-number, .score { color: var(--text-color-muted, #59636e); font-size: 12px; } .score { background: var(--surface-strong); border-radius: 999px; padding: 2px 7px; } h3 { font-size: 16px; line-height: 1.35; margin: 10px 0; } h3 a { color: var(--text-color-default, #1f2328); } .description { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow: auto; } .rationale { background: color-mix(in srgb, var(--true-color-blue-muted, #ddf4ff) 65%, transparent); border-left: 3px solid var(--true-color-blue, #0969da); padding: 8px 10px; } button { background: var(--true-color-blue, #0969da); border: 1px solid var(--true-color-blue, #0969da); border-radius: 7px; color: var(--color-white, #fff); cursor: pointer; font: inherit; font-weight: var(--font-weight-semibold, 600); min-height: 36px; padding: 7px 11px; } button:hover:not(:disabled) { filter: brightness(.9); } button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px; } button:disabled { cursor: wait; opacity: .65; } #status { color: var(--text-color-muted, #59636e); margin: 18px 0 0; } .error { color: var(--true-color-red, #cf222e) !important; } .empty { border: 1px dashed var(--border-color-default, #d0d7de); border-radius: 10px; color: var(--text-color-muted, #59636e); padding: 18px; }
      @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
    </style>
  </head>
  <body><main><header><h1>Issue triage board</h1><p class="lede">The three open issues most likely to need attention now, followed by the rest of the backlog.</p></header><p id="status" role="status" aria-live="polite">Loading open issues...</p><section aria-labelledby="top-heading"><h2 id="top-heading">Needs attention now</h2><div id="top" class="board"></div></section><section aria-labelledby="remainder-heading"><h2 id="remainder-heading">Remaining open issues</h2><div id="remainder" class="board"></div></section></main>
    <script>
      const status = document.querySelector("#status");
      const render = (data) => {
        document.querySelector("#top").innerHTML = data.top.length ? data.top.map((issue) => issueCard(issue, true)).join("") : '<p class="empty">No open issues found.</p>';
        document.querySelector("#remainder").innerHTML = data.remainder.length ? data.remainder.map((issue) => issueCard(issue, false)).join("") : '<p class="empty">No other open issues.</p>';
        status.textContent = data.total + " open issue" + (data.total === 1 ? "" : "s") + " loaded.";
      };
      const escapeHtml = ${escapeHtml.toString()};
      const issueCard = ${issueCard.toString()};
      const load = async () => { try { const response = await fetch("/api/issues"); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load issues."); render(data); } catch (error) { status.textContent = error.message; status.className = "error"; } };
      document.addEventListener("click", async (event) => { const button = event.target.closest(".context-button"); if (!button) return; button.disabled = true; try { const response = await fetch("/api/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueNumber: Number(button.dataset.issueNumber) }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not add issue to context."); button.textContent = "Added to current context"; status.textContent = data.message; } catch (error) { button.disabled = false; status.textContent = error.message; status.className = "error"; } });
      load();
    </script>
  </body>
</html>`;
}

async function startServer() {
    const server = createServer(async (request, response) => {
        try {
            if (request.url === "/api/issues" && request.method === "GET") {
                const data = await triageIssues();
                response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                response.end(JSON.stringify(data));
                return;
            }
            if (request.url === "/api/context" && request.method === "POST") {
                let body = "";
                request.setEncoding("utf8");
                for await (const chunk of request) body += chunk;
                const { issueNumber } = JSON.parse(body);
                if (!Number.isInteger(issueNumber) || issueNumber < 1) throw new Error("A valid issue number is required.");
                const issue = (await getRepositoryIssues()).find((candidate) => candidate.number === issueNumber);
                if (!issue) throw new Error(`Open issue #${issueNumber} was not found.`);
                await session.send({ prompt: `Add this GitHub issue to the current working context and start working on it:\n\nIssue #${issue.number}: ${issue.title}\nURL: ${issue.url}\n\nDescription:\n${issue.body?.trim() || "No description provided."}` });
                response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                response.end(JSON.stringify({ message: `Issue #${issueNumber} added to the current context.` }));
                return;
            }
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(renderHtml());
        } catch (error) {
            response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            response.end(JSON.stringify({ error: error instanceof Error ? error.message : "The request failed." }));
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    return { server, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/` };
}

const session = await joinSession({
    canvases: [createCanvas({
        id: "kanban-triage",
        displayName: "Issue triage board",
        description: "Triage open repository issues, highlighting the three most urgent and add them to the current session context.",
        actions: [
            { name: "list_issues", description: "List and rank the repository's open GitHub issues.", handler: async () => triageIssues() },
            {
                name: "add_issue_to_context",
                description: "Add an open GitHub issue to the current session context so work can start on it.",
                inputSchema: { type: "object", properties: { issueNumber: { type: "integer", minimum: 1 } }, required: ["issueNumber"], additionalProperties: false },
                handler: async (ctx) => {
                    const issueNumber = ctx.input?.issueNumber;
                    const issue = (await getRepositoryIssues()).find((candidate) => candidate.number === issueNumber);
                    if (!issue) throw new CanvasError("issue_not_found", `Open issue #${issueNumber} was not found.`);
                    await session.send({ prompt: `Add this GitHub issue to the current working context and start working on it:\n\nIssue #${issue.number}: ${issue.title}\nURL: ${issue.url}\n\nDescription:\n${issue.body?.trim() || "No description provided."}` });
                    return { message: `Issue #${issueNumber} added to the current context.` };
                },
            },
        ],
        open: async (ctx) => {
            let entry = servers.get(ctx.instanceId);
            if (!entry) { entry = await startServer(); servers.set(ctx.instanceId, entry); }
            return { title: "Issue triage board", url: entry.url };
        },
        onClose: async (ctx) => {
            const entry = servers.get(ctx.instanceId);
            if (entry) { servers.delete(ctx.instanceId); await new Promise((resolve) => entry.server.close(resolve)); }
        },
    })],
});
