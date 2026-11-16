---
name: autopilot
description: Claude Code only. Runs any long goal to completion unattended (a refactor, a migration, a finished plan, "run <skill> until done"), recycling fresh background orchestrators before their context fills so nobody checkpoints and resumes by hand. Use when the user wants a task run hands-off, autonomously, or until done, says "leave it to work" or "just finish this", or wants to walk away while a long build runs. Needs a checkable done condition (a command or a checklist); open-ended work with none is out of scope.
argument-hint: "<goal | plan-file> [instructions] [--done '<cmd>'] [--thresholds soft/hard] [--commit|--no-commit]"
license: MIT
metadata:
  author: markopvlkvc
  kind: solo
---

# Autopilot

Claude Code only: the supervisor runs each orchestrator as a background agent
whose transcript file a script reads, and wakes on that script's output through
a background watcher. When `CLAUDE_CODE_SESSION_ID` is unset, tell the user
autopilot is unavailable in this session and stop; do not supervise by other
means.

You are the supervisor. You drive one goal to a passing done check across as
many fresh orchestrator lifetimes as it takes, recycling each before its
context fills. You do no goal work yourself: you spawn, watch, recycle, and
verify. Between the user's `go` and your final report nobody answers a
question, so a step that stalls, asks, or stops when it need not is a defect.
Paths below (`scripts/`, `references/`) are relative to the directory holding
this SKILL.md; run them by absolute path.

## Supervisor loop

1. **Recover.** Whenever you do not know the live orchestrator's agent id or
   transcript path, re-read `run.md` (see "Run state") before anything else,
   including before handling an event or message that just arrived. That
   covers every turn after your own context was compacted: an id or path a
   compaction summary mentions does not count as known; only `run.md` or a
   spawn result still in your context does. If the slug is lost too, list
   `.autopilot/` at the repository root.
2. **Pre-launch.** Read the invocation and route it ("Invocation and
   routing"), resolve the commit policy ("Commit policy and finish"), check
   the slug for an earlier run ("Run state"); when one exists, ask resume or
   a new slug first and wait for that answer. Then on route `generic` create
   the worktree (`git worktree add <worktree path> -b autopilot/<slug>`;
   local and removable) for a new run or a new slug, never on a resume,
   dry-run the done check
   ("Done check"), then show the "Pre-launch checklist" block and wait for
   `go`. Spawn no orchestrator before `go`. On a cancel, remove a worktree
   this pre-launch created with `git worktree remove <worktree path>` and
   delete its branch with `git branch -d autopilot/<slug>` (it holds no
   commits yet), so a rerun on the slug is not offered a resume with nothing
   behind it.
3. **Launch**, once, after `go`: write `run.md` with the approved values. On
   a resumed run, keep it (the work part stays; goal, route, route target,
   and done check stay unless the checklist changed them), update the
   Supervisor values the checklist changed, set lifetime N to 1, and clear the
   `RESUME` count history, the degraded-lifetimes list, the live agent id,
   transcript path, and watcher task id, so the guard, the cap, and the
   lifetime numbers count from this launch. Add a `.autopilot/` line to `.git/info/exclude` when no line
   there holds it. On a run the branch rule covers ("Commit policy and
   finish"), when the repository root is on its default branch, run
   `git switch -c autopilot/<slug>` (uncommitted files carry over), or
   `git switch autopilot/<slug>` on a resumed run whose branch exists;
   otherwise stay on the current branch.
4. **Spawn lifetime N.** Fill every slot of `references/orchestrator-brief.md`
   as below and send only its filled "Brief body" section as the spawn message
   of a background `general-purpose` agent with no `model` override (see "The
   fill sensor" for why). Record the agent id and the transcript output file
   path the spawn result returns into `run.md` with N, then arm one background
   watcher running the sensor and record its task id in `run.md`. Arm it as a
   background command whose exit wakes you, never a tool whose description
   caps its runtime: a usage-limit wait inside it lasts hours.

   | Slot | Value |
   |---|---|
   | `{{lifetime_n}}` | N |
   | `{{goal}}` | the goal as invoked (the plan path for a plan) |
   | `{{route}}` | `sdd`, `skill`, or `generic` |
   | `{{route_target}}` | the plan path (`sdd`), the skill name (`skill`), empty (`generic`) |
   | `{{run_file}}` | absolute path of `run.md` |
   | `{{workdir}}` | the worktree path (`generic`), else the repository root; a skill that sets up its own worktree (issues-sdd) works where it puts it |
   | `{{done_check}}` | the approved done check, verbatim |
   | `{{commit_policy}}` | `commit` or `no-commit` |
   | `{{finish}}` | the approved finish line; `skip` under `no-commit` |
   | `{{outward_allowed}}` | the checklist's outward actions, one per line; `none` if empty |
   | `{{additional_instructions}}` | the user's instructions from `run.md`, verbatim, every lifetime; empty if none |

5. **Wait on events**, one line each:
   - `RESUME landed=<n> next=<step id>` → record n for this lifetime in
     `run.md`; apply "Forward-progress guard".
   - `HEARTBEAT landed=<n>` → counted only on the degraded path.
   - `SOFT`, `HARD`, `DEGRADED` from the watcher → "Recycle".
   - `LIMIT-RESET <window>` from the watcher → mark lifetime N `ended: limit`
     in `run.md`, then step 6.
   - `LIMIT-FAR <window> <epoch>` from the watcher → step 8.
   - `ACK landed=<n> next=<step id>` → record both in `run.md` and wait; the
     terminal line that follows it decides, with `HARD` the backstop meanwhile.
   - `RECYCLE-READY` → step 6.
   - `PARKED <step id>: <action>` → append it to `run.md` ("Outward actions").
   - `DONE` → step 7.
   - `BLOCKED(<class>): <what is left>` → step 8 with the class and what is
     left. Every class ends the run, `scope-gap` from a finished `sdd` or
     `skill` run whose done check still fails included.
   - the live orchestrator's task (the agent id in `run.md`) ends with none
     of the terminal lines above → read its status file first: when it holds
     `limit=`, wait for the watcher's `LIMIT-RESET` or `LIMIT-FAR` line
     instead of step 6; otherwise step 6, as after a forced stop. A task-end
     notice for any other id is a lifetime already replaced: ignore it.
6. **Recycle.** Every recycle trigger comes here: `RECYCLE-READY`, `HARD`,
   `LIMIT-RESET`, a task end with no terminal line, and a failing DONE check.
   When N+1 would
   exceed 20, step 8 instead: the lifetime cap. Otherwise run the sequence in
   "Recycle", then step 4 as lifetime N+1.
7. **DONE.** Verify it ("Done check"). A failing check is step 6, the full
   recycle with its cap check; a passing one runs "Second opinion on
   rulings" where it applies, then step 8.
8. **Final report.** Every ending comes here: first stop any live
   orchestrator and its watcher (their ids in `run.md`), then report the
   outcome (verified DONE, `BLOCKED` with what is left, or halted by the
   guard, the cap, or a usage limit resetting more than 24h out, with its
   reset time), the done check's last result, the finish result or, under
   `no-commit`, the path
   holding the uncommitted work, every parked action, any degraded lifetime,
   lifetimes used, and any second-opinion recommendations beside it.

## Invocation and routing

`<goal | plan-file> [instructions] [--done '<cmd>'] [--thresholds soft/hard] [--commit|--no-commit]`

- **Goal or plan file (required).** Any goal with a checkable done condition.
  Open-ended work with no done check, or several goals in one run, is out of
  scope: say so and stop.
- **Instructions (optional).** Free-form directives for every orchestrator.
  Store them in `run.md` and pass them to every lifetime, not only the first.
- **`--done`.** The done check; asked for when absent ("Done check").
- **`--thresholds`.** Soft / hard fill percentages, default 25 / 35.
- **`--commit` / `--no-commit`.** Top of the commit precedence.

| Input | Route | Orchestrator runs | Work state |
|---|---|---|---|
| path to a superpowers plan | `sdd` | `subagent-driven-development` (SDD) | SDD's `progress.md` |
| goal naming a skill | `skill` | that skill | that skill's own ledger if it has one (issues-sdd: SDD's `progress.md`), else `run.md` |
| anything else | `generic` | the generic orchestrator in the brief | `run.md` |

When `subagent-driven-development` is not among your available skills, a plan
routes `generic` with the plan as its goal; tell the user once, on the
checklist's route line.

## Pre-launch checklist

Show this block verbatim with the `<...>` values filled, keeping every line
(the worktree line only on route `generic`), and wait for `go`. After any
correction, re-resolve what it touches (re-run the dry run if the done check
changed) and show the block again. A correction to the slug or the worktree
line removes the worktree this pre-launch made and its `autopilot/<slug>`
branch (`git worktree remove`, `git branch -d`), creates them again from the
corrected values, and re-runs the dry run there.

On route `skill`, read the named skill before showing the block and list its
own outward steps on the outward-actions line (issues-sdd: claims and assigns
its part, keeps its board status, files discovered issues, closes the finished
plan, squash-merges each part). A step left off that line parks, and a parked
first step, such as issues-sdd's claim, ends the run at once.

> **Autopilot pre-launch**
> · permission mode → must be **auto**. I cannot set it, you do. Any other mode stalls the run on the first prompt.
> · goal → `<goal as invoked>`
> · route → `<sdd | skill <name> | generic>` `<(subagent-driven-development not installed, so this plan runs generic)>`
> · done check → `<command or checklist>` · dry run `<pass | fail>` `<weak: why, the stronger check, the gap it closes>` `<(the repository root is on <branch>, not <default branch>, where <skill> merges and this check runs: switch before go, or use a location-free check such as <check>, because <reason>)>`
> · finish → `<push <branch> and open a PR set to squash, no merge | skip (no-commit)>`
> · commit policy → `<commit | no-commit>` (source: `<--commit | --no-commit | <skill>'s own flow | the repo's CLAUDE.md | default>`) `<(<skill>'s flow needs commits and parks at its first one; drop --no-commit to let it run)>`
> · outward actions → `<actions the goal implies, plus the named skill's own outward steps | none>`
> · orchestrator → inherits this session's model, `<model>` · window `<N>` tokens (fill % is measured against this)
> · thresholds → soft `<soft>`% / hard `<hard>`% (soft must exceed the orchestrator's base fill)
> · worktree → `<repo parent>/<repo name>-autopilot-<slug>` on branch `autopilot/<slug>` `<(made from HEAD: the checkout's uncommitted changes do not carry over: <files>)>`
> · run file → `<repo root>/.autopilot/<slug>/run.md` `<(resuming the earlier run) | (new run)>`
>
> Reply `go` to start, or correct any line first.

## Done check

- **Fixed at pre-launch.** Use `--done` when given; otherwise ask the user for
  one, a command or a checklist of concrete conditions.
- **Dry run, once, before the checklist,** where the run will work: the
  worktree on route `generic` (made at pre-launch for this), else the
  repository root. Run a command there; hand a checklist to a fresh read-only
  `general-purpose` verifier that returns pass or fail per item with its
  evidence. When the check errors (the command cannot run, or the verifier
  cannot judge an item), say so and ask for a working one; that holds for an
  error in the worktree too (often a gitignored or uncommitted file it lacks,
  such as `node_modules` or `.env`), which is a pre-launch error, never a
  mid-run blocker. A failing result is the expected case and is fine.
- **Weak check.** A check that passes already never blocks launch, but the
  done-check line flags it weak, because it cannot tell a finished run from an
  unfinished one; the line then suggests a stronger check and says what gap
  the original leaves and what the suggestion closes. A suggested command with
  no reason beside it is the failure this rule exists to prevent.
- **Merge-elsewhere skills.** On a route whose skill merges its work into
  the default branch from its own worktree (issues-sdd), asking for a done
  check means proposing a location-free one (for issues-sdd, a `gh` query
  that the plan's issues are all closed), since each merge already waited on
  its PR's checks and a test command rebuilds the project on every `DONE`
  claim. A command done check runs at the repository root on the default
  branch, after `git pull --ff-only` there, since only that tree holds every
  merge. At pre-launch, check the root is on the default branch. When it is
  not, the done-check line says so and suggests switching before `go`, or a
  location-free check, with the reason: the work lands on the default branch,
  not the branch the root is on. Nothing mid-run switches the user's checkout.
- **DONE verification.** An orchestrator's `DONE` is a claim: run the command
  yourself in `{{workdir}}` (on a merge-elsewhere skill, at the repository
  root after `git pull --ff-only`, as above), or spawn a fresh verifier for a
  checklist. A failure starts another lifetime. A check that errors mid-run is an
  `environment` blocker at once: step 8, never another lifetime. A named
  skill stopping on its own is never DONE.

## Commit policy and finish

Resolve before the checklist, highest first:

1. `--commit` or `--no-commit` at invocation.
2. The target repo's CLAUDE.md or AGENTS.md forbidding commits unless asked:
   `no-commit`.
3. Default `commit`.

On route `skill`, when the named skill's own flow commits and opens PRs
(issues-sdd), the commit policy is that skill's: the checklist shows `commit`
with that source, and the repo's no-commit default does not apply to it. An
explicit `--no-commit` still wins (precedence 1); the commit-policy line then
flags that the skill's flow needs commits (issues-sdd opens and merges PRs)
and parks at its first one, so the user can drop the flag before `go`.

The branch rule covers every run that works in the repository root under
`commit`: route `sdd`, and route `skill` when the named skill makes no
worktree of its own (a skill that does, such as issues-sdd, is exempt). On
such a run, when the repository root is on its default branch, launch moves
the run to the branch `autopilot/<slug>` (loop step 3); otherwise the run
stays on the current branch. The `finish →` line names the branch it will
push.

In `commit` mode each landed step that passes its verify gets one commit; a
plan follows its `Commit:` lines. In `no-commit` mode the finish is skipped
and the work stays uncommitted where the run worked (the `generic` worktree,
a worktree the route's skill made for itself, or the repository root); the
final report names that path.

The `finish →` line pre-answers the end-of-run choice that autopilot or SDD's
`finishing-a-development-branch` would otherwise ask about. Default: push the
branch and open a PR set to squash, then stop, with no merge. A skill that
merges in its own flow (issues-sdd) keeps its merge, listed on the outward
actions line.

## Run state

`.autopilot/<slug>/run.md` at the root of the repository you were invoked in;
the slug is the plan file's base name or a short kebab-case form of the goal.
`.autopilot/` lives in `.git/info/exclude`, so the run never touches a tracked
file.

At pre-launch, check for an earlier run on the slug: an existing
`.autopilot/<slug>/`, the branch `autopilot/<slug>` on route `generic` and on
every run the branch rule covers ("Commit policy and finish"), and on route
`generic` the worktree path. When one exists, step 2 offers resuming it (keep
`run.md`, create no worktree or branch; a run the branch rule covers switches
to the existing branch at launch) or a new slug, before the checklist, so
nothing collides after `go`.

The file has two parts. Its `## Supervisor` section is yours alone: goal,
route, route target, done check, thresholds, commit policy with its source,
finish, outward actions, instructions, worktree path (`generic` only), model
and window, lifetime N, the live agent id, transcript path, and watcher task
id, the `RESUME` landed count per lifetime, degraded
lifetimes, lifetimes `ended: limit`, and parked actions. Rewrite it at
launch, each spawn, each `RESUME`,
each `PARKED`, and each recycle; leave the rest of the file to the
orchestrator.

The work part belongs to the orchestrator. On every route it holds the
progress tally: one `landed: <unit id>` line appended as each unit lands.
`landed=<n>` in `RESUME`, `HEARTBEAT`, and `ACK` is the count of those lines.
The tally is a progress count, not work state, and it lives here because a
ledger can reset (issues-sdd deletes each part's ledger when the part
finishes). A run whose work state lives in its own ledger (see the routing
table) keeps that state there and nothing else of it in `run.md`, since two
copies would disagree after a forced stop. On every other run the work part
also holds the todo list as
`- [ ] <id>: <what>; verify: <how>`, ticked `[x]` as each step lands; in-flight
marks listing a step's files, with that file list kept on the step once it
lands; rulings as
`Ruling: <what>; why: <why>; cost if wrong: <cost>`; parked marks; and the
resume point.

## The fill sensor

No agent can read its own context, so you measure each orchestrator from
outside, off the transcript file the spawn result names. Arm a fresh watcher
per lifetime, in loop mode (`--once` is for a single manual spot check only):

```
sh scripts/context-monitor.sh <transcript_path> <window_tokens> <soft_pct> <hard_pct> <status_file>
```

- `<transcript_path>`: the transcript output file path from the spawn result.
- `<window_tokens>`: the orchestrator's window. It inherits your model because
  you pass no `model` override; a short alias such as `opus` can resolve to a
  smaller-window variant, and a window that differs from the orchestrator's
  real one silently breaks the percentage.
- `<soft_pct>` / `<hard_pct>`: the run's thresholds. Soft must exceed the
  orchestrator's base fill (a few percent on a 1M window, about 15-25% on a
  200k one), else it fires before any work lands.
- `<status_file>`: `/tmp/orch-<agentId>.status`, per orchestrator so
  concurrent supervisors never collide. The sensor owns it: its first tick
  creates it with `>`, and every tick writes
  `pct=<n> tokens=<n> window=<n> source=usage|estimate|none` (`none`: the
  transcript is still too small to read). You never write or reset it; read
  it for a spot check.

The sensor prints one line per event and nothing between: `SOFT <pct>`,
`HARD <pct>` (then it exits), or `DEGRADED transcript-missing` /
`DEGRADED bad-window` (exit 3, no fill reading). After a usage-limit hit in
the transcript it writes `limit=<epoch> window=<window>` to the status file,
prints nothing until 2 minutes past the reset, then prints `LIMIT-RESET
<window>` and exits; a reset more than 24h out prints `LIMIT-FAR <window>
<epoch>` at once and exits. The pct is a safe recycle point, not a precise
gauge.

## Recycle

- **Soft.** On `SOFT`, send the orchestrator a message asking it to run its
  cooperative stop. It stops at the next clean boundary (SDD runs: the wave
  gap; other runs: the step gap, with every subagent it dispatched returned
  and the current step landed or not started), sends `ACK`, then sends its
  terminal line. Only the terminal line acts: `RECYCLE-READY` goes to loop
  step 6, `DONE` and `BLOCKED` to loop steps 7 and 8.
- **Hard.** On `HARD`, at any point before the terminal line arrives, go to
  loop step 6 at once; its sequence stops the orchestrator's background task
  without waiting. This loses only the interrupted step, which the next
  lifetime re-runs.
- **Degraded.** On `DEGRADED` the sensor is blind and has exited. Count that
  lifetime's `HEARTBEAT` lines and take the soft path after every 3 (landed
  waves or steps), in place of fill. Tell the user once that the lifetime runs
  degraded and record it in `run.md`.

Sequence, run only from loop step 6 after its cap check, which then spawns:

1. Stop the orchestrator's background task.
2. Stop the old watcher (its task id in `run.md`) before arming another; a
   stale one polls a dead transcript.
3. In `run.md`, set N+1 and clear the live agent id, transcript path, and
   watcher task id.

## Forward-progress guard

`RESUME landed=` is the count of the work part's `landed:` lines ("Run
state"), cumulative across lifetimes on every route, so a lifetime's landed
units are the next lifetime's `RESUME` count minus its own. Every lifetime sends
`RESUME` on spawn, so this holds whether the prior one ended on an `ACK` or a
forced stop. When two consecutive lifetimes land zero units (three `RESUME`
counts in a row equal), go to loop step 8; a step that does not fit one
lifetime will not fit the next. Skip a lifetime marked `ended: limit` when
comparing. The 20-lifetime cap is the backstop.

## Second opinion on rulings

Runs on route `generic`, and on route `skill` when that skill does not go
through SDD (SDD runs get their own rulings review), once the done check is
verified and the run's rulings list is non-empty. Spawn two read-only
`general-purpose` advisors in parallel, one with the `model` override set to
Fable and one to Sonnet. Give each the goal, `{{workdir}}`, and the rulings;
each tries to refute every ruling (a ruling also fails when it breaks a
constraint the goal or the user stated, read in their words, handles only some
of the cases something will feed it while a ruling handling them all exists,
rests on an all-or-none claim (nothing reads it, no other caller) from a search
that could miss a case (the name built in a string, the file loaded by path, a
reader outside the repo), or rests on a fact about a tool, service, or library
(a limit, default, flag, version) that nothing read this run confirms; a
partial ruling that stands names what it leaves unhandled) and returns only the
rulings it would change (the ruling, the change, the one reason, the fact it
hinges on as `file:line` or the doc or command output it read, a fact it could
not read marked unchecked), or `no change`, editing, running, and committing
nothing.

Refute each recommendation against the code yourself, with the same four
tests; drop any that fails and name it. Show the survivors beside the final
report. Apply nothing without the user's yes.

## Outward actions

This policy is complete as stated here; it assumes nothing from the user's own
instruction files. Without asking, the orchestrator may push the branch this
run created, open or update the PR this run opened, comment on or label the
issue a unit's brief names, and take the outward actions the checklist
listed and its finish line, both of which `go` authorizes. Anything else outward (a merge elsewhere,
publish, deploy, force-push, deleting a remote branch, a global install,
spending, a comment on an upstream repo) parks only the unit that needs it and
reaches you as `PARKED <step id>: <action>`. Record it and let the run go on;
neither take the action yourself nor stop the run for it. The final report
lists every parked action.

## Limits

- **Your own context.** `run.md` holds every fact you act on, so your own
  compaction loses nothing (loop step 1). Stay lean anyway: one status line
  per lifetime, bare event lines, no goal work.
- **Unattended has edges.** Auto mode stops prompts, not human-only blockers.
  The only endings besides a verified DONE are `BLOCKED` (sent once nothing
  workable is left), the forward-progress guard, the 20-lifetime cap, and a
  usage limit resetting more than 24h out.
