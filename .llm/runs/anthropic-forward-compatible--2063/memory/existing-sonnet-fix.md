# Existing Sonnet 5.5 patch is partial

NetScript PR 2071 merged as 25ece573 and hardcodes Sonnet 5.5 using public TanStack `createModel` / `extendAdapter`; it does not expose `models` in provider config. Issue 2063 remains open for the additive seam, Opus/Fable wire compatibility and published-consumer qualification. Preserve the existing Sonnet default and upstream catalog.
