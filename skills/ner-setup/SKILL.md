---
name: ner-setup
description: Get a user set up to use the NER skills — connect the Atlassian (Confluence/Jira) and Slack integrations, set up GitHub access, and verify they work. Use for first-time setup, when the user says the NER skills aren't returning results, or when a source seems disconnected or unauthenticated.
---

# Set up the NER Connectors

> **In Claude Code**, the `ner-jarvis` installer handles setup — it installs the
> skills and the Slack + Atlassian plugins, and GitHub is accessed via the **`gh`
> CLI** (run `gh auth login`). The Connector steps below are for **Claude Desktop**.

## In Claude Code: install ≠ authenticate

`ner-jarvis setup` (or `setup atlassian` / `setup slack`) **installs** the plugins,
registering their MCP servers. It does **not** log you in — authentication is a
separate, one-time OAuth step you do yourself:

1. Run **`/mcp`** in Claude Code.
2. Select each NER server (Atlassian, Slack) and complete the browser login.

> **Let Claude Code recommend the auth — don't do it for the user.** Claude Code itself
> tells the user how to authenticate a source that needs it (its "needs authentication ·
> run /mcp" prompt). Surface that and let them complete it, then re-check — don't
> authenticate on their behalf or hand-roll the OAuth flow yourself.

The banner **"N MCP servers need authentication · run /mcp"** means exactly this: the
servers are installed, they just aren't logged in yet.

- **A disconnected-but-installed source is an auth gap, not an install gap** → the fix
  is `/mcp`, not `ner-jarvis setup`. Re-running `ner-jarvis setup` is idempotent (it
  won't reinstall or touch your login) but won't connect anything either.
- **Don't uninstall/reinstall to "reset" a connection.** OAuth tokens are stored per
  server endpoint and survive reinstall, so reinstalling can't restore a missing or
  expired login — re-authenticating in `/mcp` does.
- **Tell the two apart with `claude mcp list`:** a line ending **`Needs authentication`**
  = installed, run `/mcp`; a server **absent** from the list = not installed, run
  `ner-jarvis setup <name>`. (`ner-jarvis doctor` reports the same distinction.)

The NER skills query Confluence, GitHub, and Slack live. **Atlassian** and
**GitHub** are essential; **Slack** is recommended (ner-escalation-router uses it
to find the current channel). Add each manually in Claude Desktop — there's no
automated install — and verify it. Anyone needs this once, not just new members.

## Add the Connectors

In **Settings → Connectors**, add each (use the built-in entry if present, else
**Add custom connector**), authenticating as an account that can see NER:

- **Atlassian** → NER's Confluence (https://nerdocs.atlassian.net). The `NER`
  space is public; membership is only needed for restricted pages.
- **GitHub** → the Northeastern-Electric-Racing org
  (https://github.com/Northeastern-Electric-Racing). Public repos work without
  membership; private repos need it.
- **Slack** → NER's workspace. Optional — without it, ner-escalation-router falls
  back to Confluence for channel names (which lag).

The UI moves around; trust Anthropic's current steps over the exact clicks:
https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp

## Verify

Run one real query per source and confirm it returns cited NER content:

- **Confluence:** "Find the NER software onboarding page." → a
  `nerdocs.atlassian.net/wiki/spaces/NER/...` link.
- **GitHub:** "What does one NER repo's README say?" → content from a
  `Northeastern-Electric-Racing/...` repo.
- **Slack:** "Find the #software channel in NER's Slack." → the channel resolves.
  (Skip if you didn't add Slack.)

## If it fails

- **In Claude Code, a source "needs authentication" (or a `/mcp` banner appears)** →
  it's installed but not logged in. Run `/mcp` and authenticate — don't reinstall.
- **Confluence** returns nothing for NER → wrong Atlassian account; remove and
  re-add it.
- **GitHub** 401/404 on org repos → re-auth with org access, or the repo is
  private and you're not a member.
- **Slack** finds no NER channels → wrong workspace, or the channel was renamed
  (search `software`).

## Then what

- New to NER → **ner-onboard**. Otherwise → **ner-ask**,
  **ner-repo-explainer**, or **ner-escalation-router**.
