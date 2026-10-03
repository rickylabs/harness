# Q6 native default effort

OpenCode's verified normalized empty variant map establishes the native default. Harness previously published it as unknown effort support, leaving Kimi and local Flash Next rows without a selectable default.

This run implements issue [#577](https://github.com/rickylabs/harness/issues/577) on baseline `73aacb88667740cdb714301f25fd51383c52d990`. The coordinator approved the producer SHAPE. Independent implementation review evaluates the pushed head; merge and live integration remain coordinator-owned.

The change is confined to `packages/routing/src/discovery.ts`, its paired strict validator, native version/source metadata, and disposable metadata fixtures. Concrete model identities remain JSON data. There is no public vocabulary or contracts version change. Consumers must pin producer and validator together.

Read [plan.md](plan.md) for source proof and [verification.md](verification.md) for actual results. Private operational measurements, pool configuration proposals and credential observations are excluded from this committed record. Served catalog repair belongs to the cockpit consumer.
