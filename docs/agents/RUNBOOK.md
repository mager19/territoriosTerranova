# Runbook — Running the Agents in OpenCode

Operating guide for the human orchestrator. You are the gate between agents.

## Model reality check — read this first

The agents in this project are configured for DeepSeek and Qwen class models.
They are capable at bounded code generation, but they have three weaknesses that
collide with this project:

| Weakness | Consequence here | Mitigation built in |
| --- | --- | --- |
| Long constraint lists get partially dropped | An agent satisfies 7 of 12 acceptance criteria and reports success | Every brief has a machine-checkable definition of done; you verify each box |
| Lower multi-file tool-calling reliability | Edits land in the wrong place or silently fail | Strict file-ownership boundaries; one agent at a time |
| Tendency to fabricate completion rather than report blocked | Exactly what killed the first attempt — fake test scripts | Every agent prompt says "stop and report" explicitly; A7 re-runs claimed evidence |

**A1 is your calibration run.** It is low-risk and fully verifiable. If a model
cannot complete A1 cleanly, it will not complete A2 or A3. Do not proceed on
hope — change the model.

## Model assignment

Set the default in `opencode.json` (`model` field), and override per agent in the
`model:` frontmatter of `.opencode/agent/<id>.md` where you want something else.

| Agent | Recommendation |
| --- | --- |
| A1, A5, A6 | Your best **coder** model. Mechanical, well-specified work. |
| A2, A3, A4 | Your best **reasoning** model. These decide invariants and the security boundary. |
| A7 | **A different model family than the implementers.** Non-negotiable — a model auditing its own family shares its blind spots. If you run DeepSeek for implementation, run Qwen here, or vice versa. |

## Setup

```bash
cd /Users/mager19/Documents/vibecoding/territorios
opencode
```

Inside the TUI:

```
/connect          # pick DeepSeek, paste API key; repeat for Qwen
/models           # confirm the exact provider/model ids
```

Then put the confirmed id into `opencode.json` as `"model"`. List ids without
launching the TUI with:

```bash
opencode models
opencode models deepseek
```

OpenCode reads `AGENTS.md` from the repository root automatically as project
instructions, so the architecture guardrails apply to every agent without you
pasting them.

Switch agents inside the TUI with **Tab** / **Shift+Tab** (cycles through primary
agents), or press **`<leader>a`** to open the agent list dialog and pick one.

For a non-interactive single run:

```bash
opencode run --agent a1-bootstrap "<kickoff prompt>"
```

`--agent` only accepts a **primary** agent. All seven agents here are
`mode: primary` on purpose: a primary agent cannot be spawned by another agent.
That is the mechanism that stops any single model from trying to orchestrate the
whole project by itself. **You** are the orchestrator — you select each agent,
one at a time, and gate its output before selecting the next.

OpenCode also ships `build` (default), `plan` (read-only), and a `general`
subagent invoked with `@general`. Do not use them for this project's work units.

## Launch order

Run one at a time. Do not run two agents that share paths.

| Step | Agent | Gate before starting |
| --- | --- | --- |
| 1 | `a1-bootstrap` | none |
| 2 | `a2-data` | A1 accepted |
| 3 | `a3-domain` slice 1 | A2 accepted |
| 4 | `a5-admin-web` slice 1 | A3 slice 1 accepted |
| — | **M1 review** | A7 audit; a human draws a territory and sees it persist |
| 5 | `a3-domain` slices 2–3 | M1 accepted |
| 6 | `a5-admin-web` slice 2 | A3 slice 3 accepted |
| — | **M2 review** | A7 audit |
| 7 | `a4-sharing` | M2 accepted |
| 8 | `a6-public-web` | A4 accepted |
| — | **M3 review** | A7 full audit and verdict |

A4 and A5 are the only pair safe to run in parallel, and only if you use separate
git worktrees. With weaker models, sequential is safer.

## Kickoff prompt

Paste this as the first message to each agent, substituting the id:

```
Execute your brief at docs/agents/A1-bootstrap.md.

Before writing any code:
1. Read your brief in full.
2. Read docs/agents/README.md for the universal rules and stack decisions.
3. Restate the definition of done as a checklist and confirm you understand
   every path you own and every path you must not touch.

Then implement, committing each work unit as you go.

Do not mark a criterion met without running a command and showing its output.
If anything is ambiguous, blocked, or fails, STOP and report it. A blocked
report is a good outcome. A fabricated success is the worst outcome available.

Finish with the handoff block from docs/agents/README.md, filled in completely.
```

## The review chain for every work unit

Four layers, cheapest first. Each catches what the previous one cannot.

| Layer | Who | Catches | Cost |
| --- | --- | --- | --- |
| 1 | **A0 gate** (read-only agent) | Fake tests, ownership violations, missing commits, unreproducible evidence | Cheap, mechanical |
| 2 | **You** | Judgment calls A0 flagged; whether the work is actually what you wanted | Minutes |
| 3 | **External review** (different model family) | Design errors, missed invariants, security gaps | One diff read |
| 4 | **A7 verifier** | Cross-boundary defects, at milestone boundaries only | Expensive |

Run A0 on every handoff. Run A7 only at M1, M2, M3.

### Running A0

```bash
git switch -c wu/a1-bootstrap        # you create the branch
# ... run a1-bootstrap, it commits here ...

opencode                             # Tab to a0-gate
```

Kickoff prompt for A0:

```
Audit branch wu/a1-bootstrap against docs/agents/A1-bootstrap.md.

Here is the handoff block the agent produced:
<paste it>

Run all eight checks from your brief. Re-run every command the handoff offers
as evidence and compare the output. Quote everything verbatim.

You may not edit, merge, push, or launch anything. Emit your verdict block.
```

Then hand the branch diff to an external reviewer:

```bash
git diff main...wu/a1-bootstrap
```

**You merge. No agent merges.** `git merge` is denied in `opencode.json`.

## Gate checklist — your job between agents

Do not accept a handoff until all of these hold. This is where the previous
attempt failed, and no model will do it for you.

- [ ] Every definition-of-done box has a **command and its output** as evidence
- [ ] You re-ran `pnpm test` yourself and saw real assertions, not a print statement
- [ ] `git log` shows the commits the handoff claims
- [ ] `git status` is clean — nothing important left uncommitted
- [ ] Every file the handoff cites actually exists
- [ ] No file outside the agent's ownership was modified: `git show --stat <sha>`
- [ ] The "Not done" section is filled in — an empty one on a large slice is a
      red flag, not a good sign

Fast audit of the failure mode that killed attempt #1:

```bash
# Any test script that cannot fail?
cat package.json apps/*/package.json | grep -A1 '"test'

# Did anyone touch paths they do not own?
git show --stat HEAD

# Do the tests actually assert?
pnpm test 2>&1 | tail -40
```

## When an agent goes wrong

- **Reports success but boxes are unmet** — reject, quote the specific unmet
  criterion, and send it back. Do not fix it yourself; that hides the pattern.
- **Weakened a test to make it pass** — revert the commit. This is the one
  behavior that must never be tolerated once.
- **Edited another agent's files** — revert those paths, remind it of the
  ownership table, and re-run.
- **Loops or degrades** — the brief slice is too large for that model. Split it
  into individual definition-of-done items and run them one at a time.
- **Invents an answer to an open decision** — those are listed in
  `docs/agents/README.md` under "Still open". Only you resolve them.

## Cost control

A2, A3, and A4 are the expensive runs. Keep them cheap by never letting an agent
explore the repo to figure out what to do: the brief plus the named files is the
whole context it needs. If an agent starts reading unrelated files, stop it and
restate the scope.
