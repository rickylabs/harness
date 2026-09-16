# Research

CURRENT: the existing Codex provider port performs start/turn verification but no handshake/stdio transport. The new surface is telemetry only.

CITED: https://developers.openai.com/codex/app-server . The installed 0.154.0 generated experimental TypeScript/JSON schemas are pinned by digest in protocol-source.json. JSON Schema declares tokenBudget, tokensUsed, timeUsedSeconds and updatedAt as int64 integers, so unsafe or fractional JavaScript numbers are refused.

MEASURED: initialize, initialized, thread/list and thread/goal/get work over the plain app-server command. The final probe includes archives and all declared source kinds. Three goal RPCs refuse; source coverage is incomplete, valid rows remain. Zero natural notifications in the bounded window is INCONCLUSIVE.

MEASURED: NetScript find_guidance and literal docs searches returned no task-specific adapter guidance. search_exports(query=codex) returned total 0, truncated false. Runtime-source inspection found remote app-server health/repair adapters, not a thread/goal read transport. Package-source absence in the sparse research checkout is not evidence of absence in all NetScript code.

CURRENT: no dispatcher, goal mutation or process restart is in scope. Only the reader-owned plain app-server child is created and closed.
