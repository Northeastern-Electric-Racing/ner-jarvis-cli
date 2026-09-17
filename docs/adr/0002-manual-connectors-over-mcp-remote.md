# Manual Connector setup over `mcp-remote` automation

The Bundle depends on Anthropic's native remote MCP Connectors (Atlassian, GitHub) for live queries. Adding a Connector to Claude Desktop is a manual UI action (Settings > Connectors > Add custom connector). We considered automating it via the community `mcp-remote` gateway shipped as a `claude_desktop_config.json` snippet, but rejected that path.

Verified gaps in any Anthropic-supported automation:
- The Admin API does not expose connectors ([Admin API docs](https://platform.claude.com/docs/en/manage-claude/admin-api)).
- No `claude://add-connector` URL scheme exists — only `/new`, `/code/new`, `/cowork/new` ([custom connectors article](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)).
- Team / Enterprise org-level pre-add is still a manual UI action by an Owner.
- MDM push of `claude_desktop_config.json` only seeds local stdio MCPs, not Anthropic-secured remote Connectors — and is organizationally implausible for an undergrad student club.

**Decision:** each user adds Atlassian + GitHub Connectors manually through the Claude Desktop UI. A `/ner-setup` Skill walks them through it interactively and points at Anthropic's docs.

**Trade-offs accepted:** ~2 minutes of click-through per user vs. the alternative — shipping a community-maintained gateway as a hard dependency, which introduces a third-party supply-chain risk and breaks Anthropic's first-party OAuth model. The friction is bounded (one-time, per-user); the supply-chain cost is not. A future Anthropic-shipped automation hook (URL scheme, Admin API endpoint) would let us swap this out without changing the Skills themselves.

**Amended 2026-06-27:** Slack is now a third manually-added Connector (consumed by `ner-escalation-router`). The decision and rationale are unchanged — `/ner-setup` walks users through all three; Slack is optional, so users who skip it still get full Atlassian + GitHub functionality.
