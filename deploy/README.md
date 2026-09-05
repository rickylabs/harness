# deploy

How the harness runs on the N5. Two files:

| file | what it is |
|---|---|
| [`compose/dsh.yaml`](compose/dsh.yaml) | the stack: one container serving the dsh web surface on `:3080` |
| [`dsh/web-bind.cordis.patch.yml`](dsh/web-bind.cordis.patch.yml) | the `--patch` overlay that binds it to the container's interfaces |

This directory is the deployment, not the product. Everything under `packages/` runs anywhere;
what is here encodes one box — its paths, its pool, its network, and the two or three things
about it that are surprising enough to be worth writing down rather than rediscovering.

## Before the first boot

Three host directories, because every bind sets `create_host_path: false` — a bind whose source
is missing should fail at start with the path in the message, not silently materialise an empty
root-owned directory that looks like data loss the next morning:

```bash
mkdir -p /home/rickylabs/main/syspool/AI/dsh/data /home/rickylabs/main/syspool/AI/dsh/tmp
```

and the checkout, in the shared projects tree the agents already use:

```bash
git clone https://github.com/rickylabs/harness /home/rickylabs/main/syspool/AI/agents/home/projects/harness/repo
```

`projects/<name>/repo` is the layout the dev stack settled on; `/workspace/harness/repo` is the
same directory seen from inside the container. If it is not there the container says so and
exits 1 rather than booting something half-configured.

## What the container does on every start

1. Creates its `/data` subtree, installs `tini` and pnpm, and moves uid 1000's home to
   `/data/home` (`usermod -d`), the same trick the ai-agents stack uses.
2. `pnpm install --frozen-lockfile && pnpm run build` in the checkout.
3. `dsh-profile install --name rickylabs-web --surface web` — writes the profile manifest naming
   `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app` and `@rickylabs/dsh-app`, and links this
   checkout into it. Idempotent, so this is also the repair step: a profile someone hand-edited
   is put back on the next restart.
4. Execs `dsh --profile rickylabs-web --patch deploy/dsh/web-bind.cordis.patch.yml --no-open`.

Steps 2–4 run as `node` (uid 1000). Only `/data` and `/tmp` are chowned; `/workspace` is the
agents' tree and this stack never touches its ownership.

`--no-open` matters more than it looks: without it the web bundle hands the URL to the operating
system's default browser, and the container has neither.

## Security: what actually gates the surface

Upstream's Docker image warns that "DeepSeek Harness has no authentication and its Web API can
execute code". The first half is no longer true of the version this profile composes, and the
difference decides how the port may be published, so here is what the code does.

Two independent gates, both in `@deepseek-ai/dsh-client-connection`:

- **A Host/Origin fence on every `/api` request.** It accepts loopback, plus any LAN IP literal
  dsh derived from the live interfaces (only when the bind is `0.0.0.0`), plus every authority
  named in `--trusted-host`. Everything else is a 403. Its own doc is careful to say this is not
  an auth layer — it defends against DNS rebinding and cross-site requests, not against someone
  who can reach the port and knows the address to send.
- **A browser session token.** The process prints a URL carrying a per-process launch token; that
  token mints an HMAC-signed cookie, and every request without one gets the same minimal 401. The
  signing secret is persistent (it lives in the credential store under `/data`), so the cookie
  survives restarts — the launch token does not. **After every restart, take the URL from the
  log**, because the old one no longer authenticates:

  ```bash
  nerdctl --namespace=rickylabs-main logs dsh | grep 'dsh web:' | tail -n 1
  ```

So `DSH_TRUSTED_HOST` is the switch that actually opens the surface, not `ports:`. It ships
empty. With it empty the port is published but the fence answers 403 to any non-loopback Host,
which leaves exactly one way in — an SSH port-forward — and that is the default on purpose.

To reach it from the Tailscale address instead, set `DSH_TRUSTED_HOST` to the authority the
browser will send (`<address>` for any port, or `<address>:3080` to pin the port) and restart.
That is a deliberate edit by someone who has read this paragraph. The neighbouring stacks
already publish an unauthenticated root shell on the same boundary, so this is not a new
exposure — but it is one worth making on purpose rather than by default.

The bind itself cannot come from the command line: `--host 0.0.0.0` is a usage error dsh raises
deliberately. [`dsh/web-bind.cordis.patch.yml`](dsh/web-bind.cordis.patch.yml) overrides the
`webserver` row instead, and says why in its own header.

## Why `/tmp` is a disk bind and not a tmpfs

The obvious way to give this container a `/tmp` is the service-level `tmpfs:` key the ai-agents
stack uses for `/ephemeral`. Don't.

`/ephemeral` on that box is `tmpfs … rw,nosuid,nodev,noexec`, and nerdctl's default tmpfs options
include `noexec` too. A build that unpacks a native module into `TMPDIR` and then dlopens it
fails on a `noexec` mount, and the error names the module rather than the mount — which is a bad
afternoon. So `/tmp` is a bind onto the pool (ext4, exec permitted), `TMPDIR=/tmp`, and
`DSH_HOME` is nowhere near `/ephemeral`.

The cost is that `/tmp` now survives restarts. That is the right trade here; if it ever needs to
be reclaimed, remove the directory's contents on the host, not the mount.

## Why its own config tree

`HOME`, `DSH_HOME` and all three `XDG_*` variables point inside `/data`, which is dsh's alone.
The ai-agents stack bind-shares `/home/agent/.claude` with the claude-desktop webtop so they have
one session store; a dsh container writing into that tree would be writing into a live store
belonging to ten running agent sessions. Nothing here is shared with any `*-desktop` container.

## Compose keys that do not survive the MinisCloud UI

The Compose editor silently drops `group_add`, top-level `volumes:` and `network_mode`. A stack
using them looks correct in the editor and boots wrong, which is the worst available failure
mode. None of the three appear in `compose/dsh.yaml`, and
[`packages/dsh-app/src/deploy.test.ts`](../packages/dsh-app/src/deploy.test.ts) fails if one
reappears. Top-level `networks:` is fine — ai-agents uses it.

## Checking it

```bash
nerdctl --namespace=rickylabs-main port dsh 3080
```

should print a published `3080`. Then the log line above for the URL. To see what actually
composed, without booting a second server:

```bash
nerdctl --namespace=rickylabs-main exec -i dsh bash -c 'cd $HARNESS_REPO && pnpm --filter @rickylabs/dsh-app exec dsh --profile rickylabs-web --patch deploy/dsh/web-bind.cordis.patch.yml --dump-config'
```

`--dump-config` composes the entry list without booting and without evaluating `!!js`, which is
why the overlay writes `port: 3080` as a literal.
