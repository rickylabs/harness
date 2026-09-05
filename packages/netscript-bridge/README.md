# @rickylabs/netscript-bridge

Polyglot task dispatch to netscript services — the adapter that keeps netscript a runtime
dependency and not a build-time one.

**Status: stub.** Owned by **E7 · [#37](https://github.com/rickylabs/harness/issues/37)**. The only
export is `PACKAGE_NAME`. Nothing here calls a netscript service.

## What it will own

The outbound half of the netscript relationship: handing work to workers, sagas and triggers that
live in `rickylabs/netscript` and run on Deno, from a Node workspace that must keep building when
none of them are present.

This package exists because of a ratified decision, not a convenience:

> **Node + pnpm.** netscript stays a service behind an adapter, not a build-time dependency.

Everything that decision buys is downstream of it being kept. `pnpm install` needs no Deno; CI needs
no running netscript; a contributor with neither can still typecheck the whole workspace. The moment
something imports across that line those three stop being true simultaneously, and the check that
would have caught it does not exist because the import compiled fine on the machine that had both.

## The other direction is already solved, differently

The cockpits are the inbound half and they do not come through here. They live in netscript and
reach this layer over [`contracts`](../contracts/README.md), published to npm as
`@rickylabs/harness-contracts` — which is *why* that package is published at all, and the only one
that is. Two directions, two mechanisms, and neither is a workspace import.

## Why it is empty

E7 shipped its first half as [`forge`](../forge/README.md): the board taxonomy and the process
skill, which needed no daemon and no netscript. This is the half that needs something running to
talk to, so it lands with the daemon rather than ahead of it.

Writing it early would also mean pinning a wire shape against a service whose own surface is still
moving, on the wrong side of an adapter boundary whose entire purpose is to absorb exactly that.

---

Workspace conventions: [`packages/README.md`](../README.md). What this layer owes the cockpits:
[`docs/concepts/01`](../../docs/concepts/01-what-this-is.md).
