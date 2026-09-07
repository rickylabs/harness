# durable-state--e6a — drift

No locked plan yet. Baseline is the synchronized main revision in supervisor.md, newer than the brief’s illustrative head.

## Draft corrections before Stage F/G

Coordinator rejected the first planning draft’s tail-sealing/truncation API, reduced-durability success and shared generation ledger. These contradict issue 245 or admit concurrent generations. Same author session is preparing a binding amendment; no product code exists. The original draft is retained as evidence and must not be implemented without its superseding amendment. The planner also claimed tool execution with tools disabled; coordinator rejected that fabricated receipt and wrote the extracted documents directly.

## Root README clarification

The original supervisor allowed README.md, but the final exact manifest omitted it. The coordinator adds only the paragraph around the orchestration boundary: the local effect store does not schedule runtime work or produce the planner CLI state input. This is a bounded documentation correction required by the implemented behavior, with no additional product surface.
