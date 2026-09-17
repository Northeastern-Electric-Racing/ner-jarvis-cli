# v1 ships Skills only; question-log MCP held back

The original v1 sketch included a custom question-logging MCP server (general usage analytics — skill invocations, tool calls, query text, feedback signals) packaged into the Bundle alongside the Skills. It was the empirical input feeding the live-first design in [0001](./0001-live-first-with-question-log.md).

v1 instead ships **five Skills only** (`ner-setup`, `ner-onboard`, `ner-ask`, `ner-repo-explainer`, `ner-escalation-router`) — distributed as per-Skill ZIPs that users drag into Claude Desktop's Customize > Skills UI. The question-log MCP is built but **does not ship in v1**; it runs on the maintainer's machine only, dogfooded by one user.

Reason: a useful question-log MCP for the team needs a remote flush endpoint (logs from N users' machines aggregating somewhere we can query) and a disclosure surface (users know what's logged before they install). Neither exists. Shipping a local-only MCP to every user gives us no aggregated signal and creates a disclosure liability for zero value.

**When to revisit:** once a remote-flush endpoint exists and the data-handling story is clear. At that point the MCP gets packaged as a `.mcpb` and added to the Bundle alongside the Skills.

**Trade-offs accepted:** v1 launches without the analytics signal the live-first design assumes. We compensate by relying on direct dogfooding feedback during the initial test cohort — slower and noisier than instrumented signal, but sufficient for the first iteration.
