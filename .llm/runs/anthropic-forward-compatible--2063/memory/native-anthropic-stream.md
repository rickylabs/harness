# Mock native Anthropic transport

TanStack 0.18.3 uses `/v1/messages?beta=true` for these request options; assert native origin/path and selected model without forbidding the SDK query. SSE fixtures need message_start, thinking/text/tool block events, message_delta usage, and message_stop. 0.18.3 reports usage from message_delta only. TanStack 0.52.3 defaults to three model iterations; the owned single-turn port must set maxIterations(1) to avoid placeholder client-tool retries.
