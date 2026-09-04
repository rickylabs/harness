You are doing a factual research extraction. No opinions, no plan, no code. Cite a URL for every
claim. If you cannot verify something, write UNVERIFIED. Output well-structured Markdown.

Research these four targets and write ONE report.

## 1. github.com/runzhliu/deepseek-harness-docker
- What exactly does it package (base image, entrypoint, ports, volumes, env vars)?
- Reproduce the Dockerfile and docker-compose.yml verbatim if present.
- How does it pin/track the upstream deepseek-ai/deepseek-harness release?
- Licence, activity, open issues, fork count.

## 2. github.com/sorsama/deepseek-harness-mobile
- Stack (React Native? Expo? native?), architecture, folder layout.
- HOW does it talk to a running `dsh`? Exact transport: HTTP? WebSocket? JSON-RPC? Which
  dsh surface/profile does it target (web :3080, sdk JSON-RPC, acp)? Quote the client code.
- What features does it implement (session list, streaming, approvals, tool output, file diffs)?
- What is missing / what are its stated limitations?

## 3. github.com/GithungDang/dsh-client-ui-mobile
- Same questions as #2. Explicitly contrast its transport + architecture choice against #2.

## 4. t3.codes (also written "t3 code" / "t3 chat" by the same author, Theo)
- How does it dispatch work to MULTIPLE vendor CLIs (Claude Code, Codex, opencode, Copilot)?
  What is the actual mechanism - PTY wrapper? SDK? headless flags? Find the source if public.
- Find and summarise their "agent swarm" work: merged PRs, architecture, how swarm members are
  spawned, coordinated, and merged.
- How do they handle auth so that a user's SUBSCRIPTION (not API billing) is used?
- What does their mobile/remote surface look like and how does it attach to a local machine?

## Output
One Markdown report, sections 1-4, then a final section "## Transport comparison table"
comparing every remote-attach mechanism you found across all four targets:
columns = project | transport | auth | streaming? | steer/interrupt? | subscription-safe?
