# Read registry metadata through Deno

2026-10-05: Python urllib and generic web access to jsr.io metadata returned403, while Deno fetch with User-Agent Deno/2.9.7 returned200. Use deno eval --no-config --no-lock with fetch; metadata endpoint https://jsr.io/@netscript/ai/meta.json contains latest and versions, API endpoint https://api.jsr.io/scopes/netscript/packages/ai contains latestVersion. Lateststable0.0.7;0.0.8 absent;0.0.8-canary.1 exists. Record exact timestamp and version presence rather than inferring publication from a milestone or a release plan. Never delete caches or use reload.
