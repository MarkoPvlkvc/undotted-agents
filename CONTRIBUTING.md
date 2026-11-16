# Contributing

The skills here are written and tested in a private repo and exported to
this one. That shapes everything below: issues are where the work happens,
and pull requests are ported by hand instead of merged.

## Open an issue first

Every change starts as an issue. Use the form that fits:

- **Skill misbehavior:** an agent running one of these skills did something
  the skill should have prevented, or failed to do something it asks for.
- **Script bug:** a script shipped with a skill crashed or gave wrong output.
- **New skill request:** a skill you would like to see here.

A pull request with no linked issue is closed without review. Open the
issue, link it from the PR with `Closes #<number>`, and the PR gets read.

## How a pull request is handled

A PR is never merged here. Its change is ported by hand into the private
repo, tested there, and re-exported, so the commit that lands in this repo
is a new one. The PR is then closed with a link to that commit.

You are still credited: the export commit carries a
`Co-authored-by: Your Name <you@example.com>` trailer, which GitHub shows on
the commit, and its message names the PR. Give the name and email you want
used in the PR description.

## Reporting a skill misbehavior

The goal is a report someone else can rerun and, if your fix did not land,
fix from the report alone. Agent behavior varies run to run, so the details
that look obvious to you are the ones that make it repeatable.

**What happened.** What the agent did, and what you expected it to do
instead.

**How it happened.**

- The prompt or task you gave, word for word.
- The skill's name and which copy you ran: the commit SHA of this repo, or
  the date you installed it, and how you installed it.
- The harness and its version, and the model.
- The transcript excerpt where it went wrong: the turns leading up to the
  wrong step and the step itself. Attach the session file if you can.
  Remove secrets and anything private first.
- Repo state, when the agent's behavior depended on it (files present, git
  status, a config it read).
- How often: once, or 3 of 5 runs of the same prompt.

**Why it happened.** Point at the instruction in the skill: quote it, or
name its heading. Say which of these it was:

- it fired at the wrong moment, or fired where it should not have;
- it was missing, so nothing covered this moment;
- it was there, and the agent read it in a way that let it skip the act it
  asks for.

Then name the general practice the agent broke, not only this case. "It
listed the directory when the map already answered" is the case; "it ran a
discovery command whose answer was already in its context" is the practice.
A fix written against the case passes your one example and misses the next.

**Proposed fix.** The old text of the instruction and your new text. A good
fix names the moment the rule applies, names what it forbids or requires
there, and closes the reading the agent used to get around it.

**Evidence the fix works**, if you have it. Run the same prompt several
times under the old text and under the new text, and report the counts
(for example, old 1/10, new 10/10). Also run a near-miss prompt where the
rule must not fire, and show the new text still lets the agent proceed
normally there, so the fix does not win by firing everywhere.

You do not need all of this to open an issue. The form marks what a
reproduction needs as required; the cause, fix, and evidence are optional,
and an issue without them is still useful.

## Reporting a script bug

Give the script's path inside the skill, the exact command you ran, the full
output or error, what you expected, and your OS and runtime versions (for
example `node --version`). Say which copy of the skill you ran, as above.

## Requesting a new skill

Describe the task you want an agent to handle, how you handle it today, and
what goes wrong without a skill. A request is a suggestion, not a promise
that the skill will be written.
