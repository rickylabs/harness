# Research Extraction Report: DeepSeek Harness Ecosystem & T3 Code

---

## 1. github.com/runzhliu/deepseek-harness-docker

### What It Packages
* **Upstream runtime packaged:** `@deepseek-ai/dsh` AI agent runtime ([runzhliu/deepseek-harness-docker/README.md](https://github.com/runzhliu/deepseek-harness-docker/blob/main/README.md#deepseek-harness-docker-community)).
* **Base image:** Multi-stage build based on official `node:24-trixie` (Debian 13 Trixie, providing glibc 2.41 and C/C++ build tools) ([runzhliu/deepseek-harness-docker/Dockerfile#L3-L36](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile#L3-L36)).
  * *Installer stage:* Installs `build-essential`, `ca-certificates`, `python3`, and installs `@deepseek-ai/dsh@${DSH_VERSION}` and `pnpm@${PNPM_VERSION}` via `npm install --global` ([runzhliu/deepseek-harness-docker/Dockerfile#L13-L25](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile#L13-L25)).
  * *Runtime stage:* Installs Debian system utilities and desktop environment tools: `ca-certificates`, `chromium`, `curl`, `file`, `fonts-liberation`, `fonts-noto-cjk`, `git`, `jq`, `less`, `novnc`, `openbox`, `openssh-client`, `procps`, `python3`, `ripgrep`, `rsync`, `tini`, `unzip`, `websockify`, `wget`, `x11-utils`, `x11vnc`, `xterm`, `xvfb`, `zip` ([runzhliu/deepseek-harness-docker/Dockerfile#L40-L68](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile#L40-L68)).
  * *Host compatibility shims:* Adds fake `/usr/local/bin/wslpath` and fake `/usr/local/bin/powershell.exe` shims routing to a Tcl/Tk GUI mini-editor `/usr/local/bin/dsh-editor.tcl` on display `:99` so that DSH does not crash with `ENOENT` when misdetecting Docker Desktop’s WSL2 kernel ([runzhliu/deepseek-harness-docker/Dockerfile#L70-L178](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile#L70-L178)).
  * *Embedded plugins:* Bundles `/opt/deepseek-harness/plugins/dsh-browser-desktop` ([runzhliu/deepseek-harness-docker/Dockerfile#L184](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile#L184)).
* **Entrypoint & CMD:**
  * `ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/deepseek-harness-entrypoint"]` ([runzhliu/deepseek-harness-docker/Dockerfile#L255](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile#L255)).
  * `CMD ["web", "--patch", "/opt/deepseek-harness/web.cordis.patch.yml", "--no-open"]` ([runzhliu/deepseek-harness-docker/Dockerfile#L256](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile#L256)).
  * Entrypoint script behavior ([runzhliu/deepseek-harness-docker/scripts/deepseek-harness-entrypoint#L7-L163](https://github.com/runzhliu/deepseek-harness-docker/blob/main/scripts/deepseek-harness-entrypoint)):
    1. Symlinks `dsh-browser-desktop` into `${DSH_HOME}/profiles/web/node_modules/@runzhliu/dsh-browser-desktop`.
    2. If launched with `web` mode and `DSH_DESKTOP_ENABLED=1`, starts Xvfb on display `:99`, Openbox, x11vnc on `:5900`, websockify/noVNC on `:6080`, and a background Chromium process listening on remote debugging port `9222`.
    3. Runs `node --expose-internals /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js "$@"`.
* **Ports:**
  * `3080`: DeepSeek Harness Web UI / HTTP JSON-RPC API ([runzhliu/deepseek-harness-docker/Dockerfile#L231](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile#L231), [compose.yaml#L12](https://github.com/runzhliu/deepseek-harness-docker/blob/main/compose.yaml#L12)).
  * `6080`: noVNC interactive virtual browser desktop via websockify ([runzhliu/deepseek-harness-docker/Dockerfile#L231](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile#L231), [compose.yaml#L13](https://github.com/runzhliu/deepseek-harness-docker/blob/main/compose.yaml#L13)).
  * `9222`: Internal Chromium DevTools Protocol (CDP) remote debugging port ([runzhliu/deepseek-harness-docker/scripts/deepseek-harness-entrypoint#L62](https://github.com/runzhliu/deepseek-harness-docker/blob/main/scripts/deepseek-harness-entrypoint#L62)).
* **Volumes:**
  * `dsh-home`: Mounted to `/home/node/.dsh` (persists profiles, configurations, Chrome profile, npm cache) ([runzhliu/deepseek-harness-docker/compose.yaml#L19](https://github.com/runzhliu/deepseek-harness-docker/blob/main/compose.yaml#L19)).
  * `${DSH_WORKSPACE:-dsh-workspace}`: Mounted to `/workspace` (working directory for agent code) ([runzhliu/deepseek-harness-docker/compose.yaml#L20](https://github.com/runzhliu/deepseek-harness-docker/blob/main/compose.yaml#L20)).
  * tmpfs: `/tmp:rw,noexec,nosuid,nodev,size=512m` ([runzhliu/deepseek-harness-docker/compose.yaml#L23](https://github.com/runzhliu/deepseek-harness-docker/blob/main/compose.yaml#L23)).
  * Shared memory: `shm_size: "1gb"` for Chromium renderer processes ([runzhliu/deepseek-harness-docker/compose.yaml#L27](https://github.com/runzhliu/deepseek-harness-docker/blob/main/compose.yaml#L27)).
* **Environment Variables:**
  * Declared in `Dockerfile` ([runzhliu/deepseek-harness-docker/Dockerfile#L208-L221](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile#L208-L221)):
    * `DSH_HOME=/home/node/.dsh`
    * `DSH_TELEMETRY_DISABLED=1`
    * `HOME=/workspace`
    * `NPM_CONFIG_CACHE=/home/node/.dsh/npm-cache`
    * `DISPLAY=:99`
    * `XDG_RUNTIME_DIR=/tmp/runtime-node`
    * `CHROME_BIN=/usr/local/bin/chromium-docker`
    * `CHROME_PATH=/usr/local/bin/chromium-docker`
    * `CHROME_USER_DATA_DIR=/home/node/.dsh/chrome-profile`
    * `BROWSER=/usr/local/bin/chromium-docker`
    * `PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chromium-docker`
    * `XDG_CACHE_HOME=/tmp/.cache`
    * `XDG_CONFIG_HOME=/tmp/.config`
    * `XDG_DATA_HOME=/tmp/.local/share`
  * Declared in `compose.yaml` / `.env.example` ([runzhliu/deepseek-harness-docker/compose.yaml#L14-L18](https://github.com/runzhliu/deepseek-harness-docker/blob/main/compose.yaml#L14-L18), [runzhliu/deepseek-harness-docker/.env.example#L1-L26](https://github.com/runzhliu/deepseek-harness-docker/blob/main/.env.example)):
    * `DSH_VERSION` (default `0.1.2-rc.1`)
    * `DSH_IMAGE_VERSION` (default `0.1.2-rc.1-r1`)
    * `DSH_IMAGE_REPOSITORY` (default `runzhliu/deepseek-harness`)
    * `NODE_IMAGE` (default `node:24-trixie`)
    * `PNPM_VERSION` (default `10.15.1`)
    * `DSH_PORT` (default `3080`)
    * `DSH_DESKTOP_PORT` (default `6080`)
    * `DSH_DESKTOP_ENABLED` (default `1`)
    * `DSH_DESKTOP_PUBLIC_PORT` (default `${DSH_DESKTOP_PORT:-6080}`)
    * `DSH_WORKSPACE` (default `dsh-workspace`)
  * Declared in entrypoint script ([runzhliu/deepseek-harness-docker/scripts/deepseek-harness-entrypoint#L68-L85](https://github.com/runzhliu/deepseek-harness-docker/blob/main/scripts/deepseek-harness-entrypoint#L68-L85)):
    * `DSH_DESKTOP_WIDTH` (default `1440`)
    * `DSH_DESKTOP_HEIGHT` (default `900`)
    * `DSH_DESKTOP_DEPTH` (default `24`)
    * `CHROME_START_URL` (default `about:blank`)

---

### Verbatim Reproductions

#### Dockerfile
The repository contains `Dockerfile` at the root ([runzhliu/deepseek-harness-docker/Dockerfile](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile)):

```dockerfile
# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-trixie
FROM ${NODE_IMAGE} AS installer

ARG DSH_VERSION=0.1.2-rc.1
ARG PNPM_VERSION=10.15.1

# node-pty publishes prebuilds for only some Linux architectures. Keep the
# installer requirements explicit so linux/arm64 can fall back to node-gyp,
# even if a maintainer experiments with another NODE_IMAGE. The default
# non-slim runtime separately retains its development toolchain on purpose.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      build-essential \
      ca-certificates \
      python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --omit=dev --no-audit --no-fund \
      --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs \
      "@deepseek-ai/dsh@${DSH_VERSION}" \
      "pnpm@${PNPM_VERSION}" \
    && test "$(dsh --version)" = "${DSH_VERSION}" \
    && test "$(pnpm --version)" = "${PNPM_VERSION}" \
    && npm cache clean --force

FROM ${NODE_IMAGE}

ARG NODE_IMAGE
ARG DSH_VERSION=0.1.2-rc.1
ARG PNPM_VERSION=10.15.1

# Use Node's official non-slim Trixie variant intentionally: its buildpack-deps
# base provides the compiler and common development utilities a coding agent or
# native plugin may need at runtime, while glibc 2.41 accepts newer binaries
# than Bookworm's glibc 2.36. Install the remaining user-facing CLI tools
# explicitly so their availability is covered by the smoke test. Chromium is
# installed from Debian so linux/amd64 and linux/arm64 stay native; Noto CJK
# keeps Chinese pages and screenshots readable.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates \
      chromium \
      curl \
      file \
      fonts-liberation \
      fonts-noto-cjk \
      git \
      jq \
      less \
      novnc \
      openbox \
      openssh-client \
      procps \
      python3 \
      ripgrep \
      rsync \
      tini \
      unzip \
      websockify \
      wget \
      x11-utils \
      x11vnc \
      xterm \
      xvfb \
      zip \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/lib/node_modules/@deepseek-ai

# dsh misdetects Docker Desktop's WSL2 kernel as WSL and spawns
# wslpath/powershell.exe (absent in the container) to open native paths.
# Fake wslpath echoes the target path; fake powershell.exe hands it to wish
# on the VNC display (:99, viewable through noVNC), so "Open configuration
# file" and host.openPath open the editor instead of failing with ENOENT.
RUN cat > /usr/local/bin/wslpath <<'SHIM'
#!/bin/sh
# Fake wslpath: dsh calls `wslpath -w <path>`; echo the path unchanged.
out=""
for arg in "$@"; do
  case "$arg" in
    -w|-u|-m|--*) ;;
    *) out="$arg" ;;
  esac
done
printf '%s\n' "${out:-/}"
exit 0
SHIM
RUN cat > /usr/local/bin/powershell.exe <<'SHIM'
#!/bin/sh
# Fake powershell.exe: dsh runs
#   powershell.exe -NoProfile -Command "Invoke-Item -LiteralPath '<path>'"
# Extract the path and open it with wish on the VNC desktop, then exit 0 so
# dsh reports the open as successful.
command_text=""
for arg in "$@"; do
  case "$arg" in
    -NoProfile|-Command) ;;
    *) command_text="$arg" ;;
  esac
done
path=""
if [ -n "$command_text" ]; then
  path=$(printf '%s' "$command_text" \
    | sed -n "s/.*-LiteralPath[[:space:]]*'\([^']*\)'[[:space:]]*$/\1/p" \
    | sed "s/''/'/g")
fi
if [ -z "$path" ] || [ ! -e "$path" ]; then exit 0; fi
DISPLAY="${DISPLAY:-:99}" /usr/bin/wish /usr/local/bin/dsh-editor.tcl "$path" >/dev/null 2>&1 &
exit 0
SHIM
RUN cat > /usr/local/bin/dsh-editor.tcl <<'SHIM'
#!/usr/bin/wish
# VNC desktop mini editor, opened by the fake powershell.exe above.
# File mode: edit and Save (Ctrl+S). Directory mode: double-click to descend.
set target [lindex $argv 0]
if {$target eq ""} { exit }

if {[file isdirectory $target]} {
  wm title . "Pick: $target"
  wm geometry . 680x520
  listbox .lb -width 90 -height 30 -yscrollcommand {.vs set}
  scrollbar .vs -command {.lb yview}
  pack .lb -side left -fill both -expand true
  pack .vs -side right -fill y
  foreach f [lsort [glob -nocomplain -directory $target *]] {
    .lb insert end [file tail $f]
  }
  bind .lb <Double-Button-1> {
    set sel [lindex [.lb curselection] 0]
    if {$sel ne ""} {
      exec wish [info script] [file join $target [.lb get $sel]] &
    }
  }
  return
}

wm title . "Edit: $target"
wm geometry . 900x640
frame .bar
button .bar.save -text "Save (Ctrl+S)" -command saveFile
button .bar.close -text "Close (Ctrl+W)" -command exit
label .bar.path -text $target -anchor w
pack .bar.save .bar.close -side left -padx 3 -pady 3
pack .bar.path -side left -fill x -expand true -padx 6
pack .bar -side top -fill x

text .txt -wrap word -undo true -yscrollcommand {.vs set} -font {TkFixedFont 11}
scrollbar .vs -command {.txt yview}
pack .txt -side left -fill both -expand true
pack .vs -side right -fill y

if {[catch {set fd [open $target r]; fconfigure $fd -encoding utf-8; set content [read $fd]; close $fd} err]} {
  tk_messageBox -message "Open failed: $err" -type ok -icon warning
  exit
}
.txt insert 1.0 $content
focus .txt

proc saveFile {} {
  global target
  if {[catch {
    set fd [open $target w]
    fconfigure $fd -encoding utf-8
    puts -nonewline $fd [.txt get 1.0 end-1c]
    close $fd
  } err]} {
    tk_messageBox -message "Save failed: $err" -type ok -icon error
    return
  }
  .bar.save configure -text "Saved ✓"
  after 1200 { .bar.save configure -text "Save (Ctrl+S)" }
}
bind .txt <Control-s> saveFile
bind .txt <Control-w> exit
bind . <Control-s> saveFile
bind . <Control-w> exit
SHIM
RUN chmod 0755 /usr/local/bin/wslpath /usr/local/bin/powershell.exe /usr/local/bin/dsh-editor.tcl

COPY --from=installer /usr/local/lib/node_modules/@deepseek-ai/dsh /usr/local/lib/node_modules/@deepseek-ai/dsh
COPY --from=installer /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm
COPY scripts/chromium-docker /usr/local/bin/chromium-docker
COPY scripts/deepseek-harness-entrypoint /usr/local/bin/deepseek-harness-entrypoint
COPY plugins/dsh-browser-desktop /opt/deepseek-harness/plugins/dsh-browser-desktop

RUN chmod 0755 /usr/local/bin/chromium-docker \
        /usr/local/bin/deepseek-harness-entrypoint \
    && mkdir -p \
      /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@runzhliu \
      /opt/deepseek-harness/plugins/dsh-browser-desktop/node_modules/@deepseek-ai \
    && ln -s /opt/deepseek-harness/plugins/dsh-browser-desktop \
      /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@runzhliu/dsh-browser-desktop \
    && ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/schemastery \
      /opt/deepseek-harness/plugins/dsh-browser-desktop/node_modules/@deepseek-ai/schemastery \
    && ln -s ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh \
    && ln -s ../lib/node_modules/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm \
    && ln -s ../lib/node_modules/pnpm/bin/pnpx.cjs /usr/local/bin/pnpx \
    && ln -s chromium-docker /usr/local/bin/chrome \
    && ln -s chromium-docker /usr/local/bin/google-chrome \
    && ln -s chromium-docker /usr/local/bin/google-chrome-stable \
    && if [ ! -e /usr/share/novnc/index.html ]; then \
      ln -s vnc.html /usr/share/novnc/index.html; \
    fi \
    && test "$(dsh --version)" = "${DSH_VERSION}" \
    && test "$(pnpm --version)" = "${PNPM_VERSION}" \
    && chromium-docker --version

ENV DSH_HOME=/home/node/.dsh \
    DSH_TELEMETRY_DISABLED=1 \
    HOME=/workspace \
    NPM_CONFIG_CACHE=/home/node/.dsh/npm-cache \
    DISPLAY=:99 \
    XDG_RUNTIME_DIR=/tmp/runtime-node \
    CHROME_BIN=/usr/local/bin/chromium-docker \
    CHROME_PATH=/usr/local/bin/chromium-docker \
    CHROME_USER_DATA_DIR=/home/node/.dsh/chrome-profile \
    BROWSER=/usr/local/bin/chromium-docker \
    PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chromium-docker \
    XDG_CACHE_HOME=/tmp/.cache \
    XDG_CONFIG_HOME=/tmp/.config \
    XDG_DATA_HOME=/tmp/.local/share

COPY --chown=node:node web.cordis.patch.yml /opt/deepseek-harness/web.cordis.patch.yml

RUN mkdir -p "${DSH_HOME}" /workspace \
    && chown -R node:node "${DSH_HOME}" /workspace

USER node
WORKDIR /workspace

EXPOSE 3080 6080

# Keep source metadata after every filesystem-producing instruction so a new
# commit revision updates only image configuration instead of invalidating the
# large Debian/Chromium installation layers.
ARG IMAGE_VERSION=0.1.2-rc.1-r1
ARG IMAGE_REVISION=unknown
LABEL org.opencontainers.image.title="DeepSeek Harness Docker (Community)" \
      org.opencontainers.image.description="Community container image for the DeepSeek Harness CLI, Web UI, and browser-accessible Chromium desktop" \
      org.opencontainers.image.source="https://github.com/runzhliu/deepseek-harness-docker" \
      org.opencontainers.image.url="https://github.com/runzhliu/deepseek-harness-docker" \
      org.opencontainers.image.documentation="https://aik8s.run/ai-k8s/rag-agent/deepseek-harness-runtime-containerization/" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}" \
      io.github.runzhliu.deepseek-harness.base-image="${NODE_IMAGE}" \
      io.github.runzhliu.deepseek-harness.debian-codename="trixie" \
      io.github.runzhliu.deepseek-harness.upstream.repository="https://github.com/deepseek-ai/deepseek-harness" \
      io.github.runzhliu.deepseek-harness.upstream.release="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v${DSH_VERSION}" \
      io.github.runzhliu.deepseek-harness.upstream.npm="@deepseek-ai/dsh@${DSH_VERSION}"

# The CLI mounts a config-only HMR watcher after profile boot. Scope Node's
# internal-module access flag to the dsh process instead of exporting it via
# NODE_OPTIONS to every child process the agent starts.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/deepseek-harness-entrypoint"]
CMD ["web", "--patch", "/opt/deepseek-harness/web.cordis.patch.yml", "--no-open"]
```

#### docker-compose.yml / compose.yaml
*Note:* The repository uses the modern Docker Compose specification file named `compose.yaml` (an alternative market variant is named `compose.market.yaml`). A file named `docker-compose.yml` does not exist in the repository; `compose.yaml` is the canonical compose configuration ([runzhliu/deepseek-harness-docker/compose.yaml](https://github.com/runzhliu/deepseek-harness-docker/blob/main/compose.yaml)):

```yaml
services:
  deepseek-harness:
    build:
      context: .
      args:
        DSH_VERSION: ${DSH_VERSION:-0.1.2-rc.1}
        IMAGE_VERSION: ${DSH_IMAGE_VERSION:-0.1.2-rc.1-r1}
        NODE_IMAGE: ${NODE_IMAGE:-node:24-trixie}
        PNPM_VERSION: ${PNPM_VERSION:-10.15.1}
    image: ${DSH_IMAGE_REPOSITORY:-runzhliu/deepseek-harness}:${DSH_IMAGE_VERSION:-0.1.2-rc.1-r1}
    ports:
      - "127.0.0.1:${DSH_PORT:-3080}:3080"
      - "127.0.0.1:${DSH_DESKTOP_PORT:-6080}:6080"
    environment:
      DSH_TELEMETRY_DISABLED: "1"
      DSH_DESKTOP_ENABLED: "1"
      DSH_DESKTOP_PUBLIC_PORT: ${DSH_DESKTOP_PORT:-6080}
      HOME: /workspace
    volumes:
      - dsh-home:/home/node/.dsh
      - ${DSH_WORKSPACE:-dsh-workspace}:/workspace
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=512m
    # Chromium uses /dev/shm for renderer processes. This mirrors the useful
    # runtime setting from docker-antigravity without adopting its amd64-only
    # desktop base image.
    shm_size: "1gb"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    pids_limit: 512
    restart: unless-stopped
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "Promise.all([fetch('http://127.0.0.1:3080/'), fetch('http://127.0.0.1:6080/vnc.html'), fetch('http://127.0.0.1:9222/json/version')]).then(([web, desktop, cdp]) => { if (web.status !== 401 || !desktop.ok || !cdp.ok) process.exit(1) }).catch(() => process.exit(1))"
      interval: 15s
      timeout: 3s
      start_period: 20s
      retries: 3

volumes:
  dsh-home:
  dsh-workspace:
```

---

### How It Pins & Tracks Upstream Releases
* **Hard Pinned Version:** Hard-pins `DSH_VERSION=0.1.2-rc.1` across `Dockerfile`, `Dockerfile.market`, `compose.yaml`, `.env.example`, and the Helm chart `Chart.yaml` / `values.yaml` ([runzhliu/deepseek-harness-docker/Dockerfile#L6](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile#L6), [compose.yaml#L6](https://github.com/runzhliu/deepseek-harness-docker/blob/main/compose.yaml#L6)).
* **Automated Upstream Watcher:** A scheduled GitHub Actions workflow (`.github/workflows/upstream-dsh.yml`) runs nightly at `01:23 UTC` (`23 1 * * *`) ([runzhliu/deepseek-harness-docker/.github/workflows/upstream-dsh.yml#L4](https://github.com/runzhliu/deepseek-harness-docker/blob/main/.github/workflows/upstream-dsh.yml#L4)).
* **Upstream Verification Script (`scripts/check-upstream-dsh.sh`):**
  1. Queries the GitHub Releases API for `deepseek-ai/deepseek-harness` using `gh api` and extracts the latest non-draft tag starting with `dsh-v*` ([runzhliu/deepseek-harness-docker/scripts/check-upstream-dsh.sh#L15-L27](https://github.com/runzhliu/deepseek-harness-docker/blob/main/scripts/check-upstream-dsh.sh#L15-L27)).
  2. Strips the prefix (`latest_release_version="${latest_tag#dsh-v}"`).
  3. Queries npm dist-tags for `@deepseek-ai/dsh` and verifies if `@deepseek-ai/dsh@${latest_release_version}` is published and installable ([runzhliu/deepseek-harness-docker/scripts/check-upstream-dsh.sh#L28-L53](https://github.com/runzhliu/deepseek-harness-docker/blob/main/scripts/check-upstream-dsh.sh#L28-L53)).
  4. If a newer upstream release is installable on npm, the script exits with code `1`, which triggers the workflow to create or refresh a tracking GitHub issue titled `chore: upgrade the pinned DSH release` ([runzhliu/deepseek-harness-docker/.github/workflows/upstream-dsh.yml#L36-L56](https://github.com/runzhliu/deepseek-harness-docker/blob/main/.github/workflows/upstream-dsh.yml#L36-L56)).
  5. Once the repo maintainer updates the pinned version to match, the workflow closes the issue automatically ([runzhliu/deepseek-harness-docker/.github/workflows/upstream-dsh.yml#L58-L67](https://github.com/runzhliu/deepseek-harness-docker/blob/main/.github/workflows/upstream-dsh.yml#L58-L67)).
* **Consistency Check (`scripts/check-version-consistency.sh`):** Validates in CI that all manifests, Dockerfiles, and Helm charts match the exact pinned version ([runzhliu/deepseek-harness-docker/scripts/check-version-consistency.sh](https://github.com/runzhliu/deepseek-harness-docker/blob/main/scripts/check-version-consistency.sh)).

---

### Metadata, License & Activity
* **License:** MIT License ([runzhliu/deepseek-harness-docker/LICENSE](https://github.com/runzhliu/deepseek-harness-docker/blob/main/LICENSE)).
* **Activity:** Active repository. Created on August 13, 2026; last pushed on September 3, 2026 at `06:59:58Z` (commit `a4e13ee`: "feat: upgrade DSH to 0.1.2-rc.1") ([GitHub API: runzhliu/deepseek-harness-docker](https://api.github.com/repos/runzhliu/deepseek-harness-docker)).
* **Open Issues:** 8 open issues ([GitHub API: runzhliu/deepseek-harness-docker](https://api.github.com/repos/runzhliu/deepseek-harness-docker)).
* **Fork Count:** 8 forks ([GitHub API: runzhliu/deepseek-harness-docker](https://api.github.com/repos/runzhliu/deepseek-harness-docker)).
* **Stargazers:** 62 stars ([GitHub API: runzhliu/deepseek-harness-docker](https://api.github.com/repos/runzhliu/deepseek-harness-docker)).

---

## 2. github.com/sorsama/deepseek-harness-mobile

### Stack, Architecture & Folder Layout
* **Stack:** Android native application built with **Kotlin 2.0**, **Jetpack Compose**, **Hilt** dependency injection, **OkHttp 4**, **kotlinx.serialization**, and Kotlin Coroutines / Flow ([sorsama/deepseek-harness-mobile/README.md#L30-L33](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L30-L33), [sorsama/deepseek-harness-mobile/docs/ARCHITECTURE.md#L3](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/ARCHITECTURE.md#L3)).
* **Architecture:** Split into a 3-module Gradle project ([sorsama/deepseek-harness-mobile/docs/ARCHITECTURE.md#L3-L56](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/ARCHITECTURE.md#L3-L56)):
  1. `core/`: Pure JVM module without Android SDK imports. Encapsulates wire protocol DTOs, OkHttp unary and WebSocket transports, stream multiplexer (`RemoteStreamMux`), connection loop with exponential backoff, event folding into immutable conversation snapshots (`EventFold`), and notification classification.
  2. `app/`: Android application module containing Jetpack Compose UI, host discovery subnet sweep, connection foreground service (`ConnectionService`), DataStore persistence (`HostsStore`), and notification dispatch.
  3. `mock-harness/`: Ktor-based mock server mimicking `/api` endpoints for automated testing.
* **Folder Layout:**
  ```text
  core/
    src/main/kotlin/com/labteto/dshmobile/core/
      wire/             # RpcTransport, Envelopes, JsonRpc, DshApiClient, ConnectionLoop, WsChannel, RemoteStreamMux, RelayTls, RelayPairing
      wire/dto/         # kotlinx.serialization DTOs for sessions, history, goals, llm, subagents, events
      session/          # EventFold (turns, steps, tools, streaming assembly), ConversationSnapshot, ChunkRows
      notify/           # CompletionClassifier (dedup keys, notification rules)
  app/
    src/main/kotlin/com/labteto/dshmobile/app/
      connection/       # HostsStore, DiscoveryEngine, ConnectionManager, ConnectionService, KeepAliveWorker
      data/             # SessionStore, InitialSession
      notify/           # NotificationObserver
      media/            # AttachmentImages (LRU bitmap cache)
      ui/               # Theme tokens, screens (Connect, MainShell, Chat, Settings), components (composer, tool cards)
  mock-harness/         # Test mock server
  tools/capture/        # Node traffic recorder for wire fixtures
  harness/              # cordis.patch.lan.yml and LAN guide
  docs/                 # ARCHITECTURE.md, PROTOCOL.md, COMPATIBILITY.md, SECURITY.md
  ```

---

### Transport & Client Code
* **Target Surface / Profile:** Targets the DeepSeek Harness Web GUI backend (port `3080`, profile `web`), speaking the internal web client JSON-RPC protocol against baseline `0.1.2-alpha.1` ([sorsama/deepseek-harness-mobile/docs/PROTOCOL.md#L3-L6](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/PROTOCOL.md#L3-L6), [docs/COMPATIBILITY.md#L9-L21](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/COMPATIBILITY.md#L9-L21)).
* **Transport Mechanisms:**
  * **Unary RPC:** HTTP `POST /api/<namespace>/<method>` using JSON envelopes formatted as `{"type":"client-request","rpcId":"<uuid>","method":"<ns/method>","payload":{"args":{...}}}` ([sorsama/deepseek-harness-mobile/docs/PROTOCOL.md#L14-L26](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/PROTOCOL.md#L14-L26)).
  * **Streaming & Downlinks:** A single bidirectional WebSocket to `/api/remote.mux` multiplexing logical streams (`open` and `cancel` requests from client to server, `item`, `error`, `end` from server to client). Opens `$events` (for ready handshake and pending waterfalls), `session/control`, `session/follow`, and `workspace/follow` ([sorsama/deepseek-harness-mobile/docs/PROTOCOL.md#L170-L204](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/PROTOCOL.md#L170-L204)).
  * **Approvals & Questions:** Delivered as `waterfall` frames on `$events` and answered via HTTP `POST /api/$events/result` ([sorsama/deepseek-harness-mobile/docs/PROTOCOL.md#L108-L124](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/PROTOCOL.md#L108-L124)).
  * **Binary Downloads:** HTTP `GET /api/session.export?sessionId=<id>` ([sorsama/deepseek-harness-mobile/docs/PROTOCOL.md#L93-L98](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/PROTOCOL.md#L93-L98)).
  * **Auth:**
    * *Direct LAN mode:* Exchanges the CLI launch token once via `GET /?token=<token>` to obtain a signed browser session cookie attached as `Cookie: <cookie>` ([sorsama/deepseek-harness-mobile/core/src/main/kotlin/com/labteto/dshmobile/core/wire/RpcTransport.kt#L202-L216](https://github.com/sorsama/deepseek-harness-mobile/blob/main/core/src/main/kotlin/com/labteto/dshmobile/core/wire/RpcTransport.kt#L202-L216)).
    * *Relay mode:* Reaches the companion plugin `dsh-relay` over TLS with public key pinning and `Authorization: Bearer <token>` ([sorsama/deepseek-harness-mobile/core/src/main/kotlin/com/labteto/dshmobile/core/wire/RpcTransport.kt#L191-L200](https://github.com/sorsama/deepseek-harness-mobile/blob/main/core/src/main/kotlin/com/labteto/dshmobile/core/wire/RpcTransport.kt#L191-L200)).
* **Client Code Quote:**
  From `core/src/main/kotlin/com/labteto/dshmobile/core/wire/RpcTransport.kt#L106-L142` ([sorsama/deepseek-harness-mobile/core/src/main/kotlin/com/labteto/dshmobile/core/wire/RpcTransport.kt#L106-L142]):
  ```kotlin
  override suspend fun post(path: String, body: String): RpcHttpResponse =
      suspendCancellableCoroutine { continuation ->
          val target = base.resolve(path)
              ?: throw RpcTransportException(0, "cannot resolve $path against $base")
          val request = Request.Builder()
              .url(target)
              .header("Host", hostHeader)
              .header("Content-Type", "application/json")
              .authorized(authorization)
              .cookied(cookie)
              .post(body.toRequestBody(JSON_MEDIA_TYPE))
              .build()
          val call = httpClient.newCall(request)
          continuation.invokeOnCancellation { call.cancel() }
          call.enqueue(object : Callback {
              override fun onFailure(call: Call, e: IOException) {
                  if (continuation.isActive) {
                      continuation.resumeWithException(
                          RpcTransportException(0, "transport failure: ${e.message}", e),
                      )
                  }
              }

              override fun onResponse(call: Call, response: Response) {
                  response.use { resp ->
                      val responseBody = resp.body?.string().orEmpty()
                      if (resp.isSuccessful) {
                          continuation.resume(RpcHttpResponse(resp.code, responseBody))
                      } else {
                          continuation.resumeWithException(
                              RpcTransportException(resp.code, carrierMessage(resp.code)),
                          )
                      }
                  }
              }
          })
      }
  ```
  And from `core/src/main/kotlin/com/labteto/dshmobile/core/wire/RpcTransport.kt#L316-L340` for WebSocket initiation:
  ```kotlin
  /** Perform the RFC 6455 handshake and begin reading messages. Idempotent. */
  open fun start() {
      if (started) return
      started = true
      val request = Request.Builder()
          .url(url)
          .authorized(authorization)
          .cookied(cookie)
          .build()
      webSocket = client.newWebSocket(request, listener)
  }

  /**
   * Queue one text message. Returns false when the socket is gone or its send buffer is full —
   * the caller must treat that as the stream having failed rather than retrying, because
   * OkHttp has already begun tearing the socket down by then.
   */
  open fun send(text: String): Boolean = webSocket?.send(text) ?: false
  ```

---

### Features Implemented
* **Session List & Discovery:** Wi-Fi active subnet discovery, auto-connect to recent or LAN hosts, workspace-grouped session drawer ([sorsama/deepseek-harness-mobile/README.md#L66-L71](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L66-L71)).
* **Streaming & Trajectory:** Incremental text chunk assembly, thinking/reasoning disclosure, and a trajectory ledger view ([sorsama/deepseek-harness-mobile/README.md#L56-L57](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L56-L57), [L72-L74](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L72-L74)).
* **Approvals & Questions:** Interactive modal sheets for single-select, multi-select, and custom text user questions; permission approval prompts (`allowed-once` / `rejected`) ([sorsama/deepseek-harness-mobile/docs/PROTOCOL.md#L125-L165](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/PROTOCOL.md#L125-L165)).
* **Tool Output & File Diffs:** Native tool cards for terminal execution, file diffs, file reads, web browsing, and search results ([sorsama/deepseek-harness-mobile/README.md#L72-L74](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L72-L74)).
* **Subagents & Queue:** Subagent catalog (inspecting child transcripts, follow-up messages, interrupting subagents), background jobs, and queued turn management ([sorsama/deepseek-harness-mobile/README.md#L61-L62](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L61-L62), [L78-L81](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L78-L81)).
* **System Notifications:** Foreground service pushes Android notifications for turn completion, goal milestones, and pending questions ([sorsama/deepseek-harness-mobile/README.md#L82-L83](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L82-L83)).

---

### Missing Features & Stated Limitations
* **OS Limitation:** Android only (minSdk 26); no iOS client is provided ([sorsama/deepseek-harness-mobile/README.md#L32](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L32), [L90](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L90)).
* **Protocol Fragility:** Couples directly to the internal unversioned web GUI protocol; strictly pinned to `0.1.2-alpha.1`. It cannot connect to `0.1.1` or `0.9.0` harnesses due to upstream breaking changes ([sorsama/deepseek-harness-mobile/docs/COMPATIBILITY.md#L9-L26](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/COMPATIBILITY.md#L9-L26)).
* **Requires Network Patching / Relay:** Because `dsh web` binds to loopback with Host/Origin protection, direct LAN use requires applying an out-of-tree patch (`cordis.patch.lan.yml`) or installing the `dsh-relay` plugin ([sorsama/deepseek-harness-mobile/README.md#L105-L130](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L105-L130)).
* **Plaintext Over LAN:** Local network mode authenticates via launch token / cookie but does not provide transport encryption unless deployed behind an HTTPS reverse proxy or through `dsh-relay` ([sorsama/deepseek-harness-mobile/README.md#L121-L129](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L121-L129)).
* **No Mid-Stream Resume:** Reconnection on `session/follow` always transfers a full snapshot; mid-stream resumption by sequence number is not supported ([sorsama/deepseek-harness-mobile/docs/PROTOCOL.md#L230-L233](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/PROTOCOL.md#L230-L233)).

---

## 3. github.com/GithungDang/dsh-client-ui-mobile

### Stack, Architecture & Folder Layout
* **Stack:** Browser client-side enhancement built with **TypeScript**, **React** (TSX), **CSS Modules**, and `@deepseek-ai/cordis` (Cordis plugin framework), bundled using `tsdown` ([GithungDang/dsh-client-ui-mobile/package.json#L1-L50](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/package.json#L1-L50)).
* **Architecture:** An **in-browser UI plugin** for `dsh web`, **not a mobile app**. It mounts inside the running web UI in the browser, injecting narrow-screen responsive CSS and inserting controls into `dsh web` layout slots ([GithungDang/dsh-client-ui-mobile/README.md#L1-L22](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/README.md#L1-L22)):
  * *Node half (`src/index.ts`):* An empty stub function (`apply() {}`) satisfying the Cordis plugin loader requirement ([GithungDang/dsh-client-ui-mobile/src/index.ts#L1-L14](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/src/index.ts#L1-L14)).
  * *Client/Browser half (`src/client/`):* Injected into the browser bundle via `@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-client-ui-layout`. It listens to media queries (`(max-width: 768px)`), registers components in the `shell.overlay` slot, and manipulates DOM classes and attributes ([GithungDang/dsh-client-ui-mobile/src/client/index.ts#L15-L98](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/src/client/index.ts#L15-L98)).
* **Folder Layout:**
  ```text
  cordis.patch.yml
  package.json
  PUBLISHING.md
  README.md
  README.zh.md
  tsconfig.json
  tsdown.config.ts
  src/
    index.ts                        # Empty Node entrypoint
    css-modules.d.ts
    client/
      index.ts                      # Client entrypoint: slot injection, matchMedia, DOM observers
      MobileNavButton.tsx           # Floating hamburger button
      MobileNavButton.module.css    # Narrow-screen responsive styling
      TopRightMenu.tsx              # Consolidated dropdown menu
      TopRightMenu.module.css
  docs/
    mobile-official-design.md
  ```

---

### Transport & Client Code (Explicit Contrast Against #2)
* **Transport Mechanism:** **None.** Unlike target #2 (`sorsama`), this project has **zero network transport code**, zero HTTP clients, and zero WebSocket connections. It executes directly in the user's browser runtime on `http://127.0.0.1:3080` and reuses whatever transport `dsh web` already established ([GithungDang/dsh-client-ui-mobile/README.md#L69-L74](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/README.md#L69-L74)).
* **Target Surface:** Built-in web client slots (`shell.overlay`, `slots`, `layout`) provided by `@deepseek-ai/dsh-client-ui-layout` ([GithungDang/dsh-client-ui-mobile/package.json#L37-L44](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/package.json#L37-L44)).
* **Client Code Quote:**
  From `src/client/index.ts#L22-L70` ([GithungDang/dsh-client-ui-mobile/src/client/index.ts#L22-L70]):
  ```typescript
  /** Required services (cordis fiber inject). */
  export const inject = ['slots', 'layout']

  /**
   * Mount the mobile enhancement.
   * @param ctx - browser plugin context.
   */
  export function apply(ctx: ClientContext): void {
    const MOBILE_QUERY = '(max-width: 768px)'
    const FRAME_SELECTOR = '[class$="_frame"]'

    const syncMobileNav = (): void => {
      const mobile = window.matchMedia(MOBILE_QUERY).matches
      const frame = document.querySelector(FRAME_SELECTOR)
      const collapsed = frame?.hasAttribute('data-sidebar-collapsed') ?? true
      if (mobile) {
        document.documentElement.setAttribute('data-mobile-nav', collapsed ? 'closed' : 'open')
      } else {
        document.documentElement.removeAttribute('data-mobile-nav')
      }
    }

    syncMobileNav()

    const toggleSidebar = (): void => {
      ctx.layout.toggleSidebar()
    }

    const injected = (): MobileNavInjected => ({ toggleSidebar })

    ctx.effect(() => {
      const dispose = ctx.slots.register({
        name: 'shell.overlay',
        id: 'mobile-nav-toggle',
        order: -100,
        inject: injected,
      }, MobileNavButton)
      return dispose
    }, 'ui-mobile: floating nav toggle')
  ```

---

### Features Implemented
* **Responsive Breakpoint Layout:** Narrow-screen (≤768px) CSS adapting desktop UI for phone screens ([GithungDang/dsh-client-ui-mobile/README.md#L9-L21](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/README.md#L9-L21)).
* **Floating Navigation Toggle:** A 44×44px touch-friendly floating toggle button opening the built-in sidebar as a drawer ([GithungDang/dsh-client-ui-mobile/src/client/MobileNavButton.tsx](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/src/client/MobileNavButton.tsx)).
* **Auto-Closing Drawer:** Automatically closes the drawer when selecting a session or clicking "New session" to prevent covering chat content ([GithungDang/dsh-client-ui-mobile/src/client/index.ts#L82-L98](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/src/client/index.ts#L82-L98)).
* **Consolidated Top-Right Menu:** Groups the session-log export button and Chat/Trajectory view tabs into a single dropdown menu ([GithungDang/dsh-client-ui-mobile/src/client/TopRightMenu.tsx](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/src/client/TopRightMenu.tsx)).
* **CSS Touch Adaptations:** Truncates long message timestamps, stacks tool-call IN/OUT rows, and adds internal scroll to long question prompt titles ([GithungDang/dsh-client-ui-mobile/README.md#L16-L20](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/README.md#L16-L20)).
* *Note on Core DSH Features:* It does **not** reimplement session lists, streaming, approvals, tool output, or diffs—it merely styles and re-lays out the existing DOM elements rendered by the official `dsh web` frontend.

---

### Stated Limitations
* **Not an Executable App:** Requires a mobile web browser pointed to an already reachable, running `dsh web` instance ([GithungDang/dsh-client-ui-mobile/README.md#L23-L26](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/README.md#L23-L26)).
* **CSS Class Coupling:** Directly targets generated CSS module class-name suffix patterns (e.g. `[class$="_frame"]`, `[class$="_sidebarCol"]`); changes to upstream build bundling break the styling ([GithungDang/dsh-client-ui-mobile/README.md#L77-L81](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/README.md#L77-L81)).
* **No Background Sync or Push Notifications:** Cannot notify users when tasks complete once the browser tab is backgrounded.
* **Scroll Locking:** Background page scrolling is not locked while the navigation drawer is open ([GithungDang/dsh-client-ui-mobile/README.md#L80](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/README.md#L80)).

---

### Explicit Architectural & Transport Contrast: #2 vs. #3

| Criterion | Target #2 (`sorsama/deepseek-harness-mobile`) | Target #3 (`GithungDang/dsh-client-ui-mobile`) |
| :--- | :--- | :--- |
| **Product Type** | Standalone native mobile app (Android APK) | Web UI extension plugin for `dsh web` |
| **Tech Stack** | Kotlin 2.0, Jetpack Compose, OkHttp, Coroutines | TypeScript, React (TSX), CSS Modules, Cordis |
| **Execution Environment** | Runs locally on the phone's Android OS | Runs in the web browser on the host or client |
| **Transport Layer** | Custom OkHttp HTTP POST + WebSocket (`/api/remote.mux`) | None (browser DOM / layout slot injection) |
| **State Management** | Owns `EventFold`, `ConversationSnapshot`, `SessionStore` | Delegates 100% of state to the host web frontend |
| **Notifications** | Native Android foreground service & system notifications | None |

---

### Metadata, License & Activity
* **License:** MIT License ([GithungDang/dsh-client-ui-mobile/LICENSE](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/LICENSE)).
* **Activity:** Created on August 17, 2026; last pushed on August 18, 2026 at `02:12:41Z` ([GitHub API: GithungDang/dsh-client-ui-mobile](https://api.github.com/repos/GithungDang/dsh-client-ui-mobile)).
* **Open Issues:** 0 ([GitHub API: GithungDang/dsh-client-ui-mobile](https://api.github.com/repos/GithungDang/dsh-client-ui-mobile)).
* **Fork Count:** 0 ([GitHub API: GithungDang/dsh-client-ui-mobile](https://api.github.com/repos/GithungDang/dsh-client-ui-mobile)).
* **Stargazers:** 3 stars ([GitHub API: GithungDang/dsh-client-ui-mobile](https://api.github.com/repos/GithungDang/dsh-client-ui-mobile)).

---

## 4. t3.codes (pingdotgg/t3code)

*Source repository:* [github.com/pingdotgg/t3code](https://github.com/pingdotgg/t3code) ([t3.codes](https://t3.codes)).

---

### Multi-Vendor CLI Work Dispatch Mechanisms
T3 Code provides a unified control plane across multiple AI coding agents. It **does not rely on screen-scraping terminal PTY wrappers** to drive vendor agents. Interactive PTYs (`node-pty`) are used exclusively for user shell tabs ([t3code/docs/internals/terminal-runtime.md#L1-L15](https://github.com/pingdotgg/t3code/blob/main/docs/internals/terminal-runtime.md#L1-L15)). For agent integration, each vendor driver uses a dedicated structured communication protocol:

1. **Claude Code (`claudeAgent`):**
   * *Mechanism:* Uses the official Node SDK (`@anthropic-ai/claude-agent-sdk`), invoking its programmatic `query()` API with custom system prompts, tool callbacks, and cancellation signals ([t3code/apps/server/src/provider/Layers/ClaudeAdapter.ts#L10-L21](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/ClaudeAdapter.ts#L10-L21)).
2. **OpenAI Codex (`codex`):**
   * *Mechanism:* Spawns the native executable in headless application server mode via `${options.binaryPath} app-server` using stdio JSON-RPC ([t3code/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1186-L1205](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1186-L1205)).
   * *Implementation:* Handled by the internal package `packages/effect-codex-app-server`, which communicates over stdin/stdout via structured JSON-RPC requests, notifications, and responses ([t3code/packages/effect-codex-app-server/src/client.ts#L38-L60](https://github.com/pingdotgg/t3code/blob/main/packages/effect-codex-app-server/src/client.ts#L38-L60)).
3. **OpenCode (`opencode`):**
   * *Mechanism:* Connects to OpenCode’s native HTTP and Server-Sent Events (SSE) server API. T3 Code manages a local server instance per thread or connects to a shared/remote server, validating health at `/global/health` and consuming event streams via `event.subscribe` ([t3code/docs/internals/providers.md#L231-L260](https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md#L231-L260), [apps/server/src/provider/Layers/OpenCodeAdapter.ts#L2798-L2805](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/OpenCodeAdapter.ts#L2798-L2805)).
4. **GitHub Copilot (`githubCopilot`):**
   * *Mechanism:* Dispatched as an agent/model sub-provider routed through the OpenCode runtime or via ACP extension mappings ([t3code/docs/user/composer.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/composer.md), [apps/server/src/provider/Layers/OpenCodeAdapter.test.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/OpenCodeAdapter.test.ts)).
5. **Cursor, Grok & Google Antigravity:**
   * *Mechanism:* **Agent Client Protocol (ACP)** over stdio JSON-RPC ([t3code/packages/effect-acp](https://github.com/pingdotgg/t3code/blob/main/packages/effect-acp)). Executes `cursor acp`, `grok acp`, or Google’s official Antigravity ACP binary (`tools/antigravity-acp`) ([t3code/docs/internals/providers.md#L91-L101](https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md#L91-L101)).

---

### Agent Swarm / Subagent Architecture & Merged PRs
T3 Code incorporates native multi-agent and swarm coordination, tracking subagent lifecycles, progress ticks, and token aggregation:

* **Key Merged Pull Requests:**
  * **[PR #4768](https://github.com/pingdotgg/t3code/pull/4768):** `feat(orchestration-v2): add subagent observability data model (1/5)` — Added contracts for reusable subagent identities (`SubagentActivationId`, `OrchestrationV2SubagentActivation`), per-activation records, and status states (`idle`, `running`).
  * **[PR #4629](https://github.com/pingdotgg/t3code/pull/4629):** `feat(orchestration-v2): populate subagent observability from providers (2/5)` — Populated subagent provenance, roles, and token usage from Codex, Claude, Cursor, and OpenCode.
  * **[PR #5219](https://github.com/pingdotgg/t3code/pull/5219):** `feat: native subagent & workflow observability` — Introduced the dedicated **Agents panel** (`AgentsPanel.tsx`), chat **Spawn CTA row**, quiet timeline filtering, and background liveness banner.
  * **[PR #5568](https://github.com/pingdotgg/t3code/pull/5568):** `fix(server): settle stopped Claude subagents`.
  * **[PR #5677](https://github.com/pingdotgg/t3code/pull/5677):** `fix(server): stop the reaper from silently killing live background subagents`.
  * **[PR #5745](https://github.com/pingdotgg/t3code/pull/5745):** `feat(web): show how many subagents are running at a glance`.
  * **[PR #5887](https://github.com/pingdotgg/t3code/pull/5887):** `fix(server): usage no longer double-counts forked Codex sessions`.
  * **[PR #8346](https://github.com/pingdotgg/t3code/pull/8346):** `fix(codex): accept Codex 0.150 multi-agent events` — Added support for Codex 0.150 multi-agent `subAgentActivity` items and collab agent tool calls.
  * **[PR #9515](https://github.com/pingdotgg/t3code/pull/9515):** `feat(antigravity): show subagent calls and results`.
  * **[PR #9579](https://github.com/pingdotgg/t3code/pull/9579):** `fix(antigravity): keep subagent batches active after launch`.
  * **[PR #9616](https://github.com/pingdotgg/t3code/pull/9616):** `fix: show idle subagent batches without completion marks`.

* **Spawning, Coordination & Merging Mechanics:**
  * *Spawning:*
    * In Claude Code: Subagent tasks spawn via SDK `task_started` events and workflow scripts located in `~/.claude/projects/` (parallel fan-out up to 10+ workers) ([PR #5219](https://github.com/pingdotgg/t3code/pull/5219)).
    * In Codex: Swarm members are spawned via `thread/started` notifications with `source.subAgent.thread_spawn` and `collabAgentToolCall`, tracking `nickname`, `role`, `agentPath`, `depth`, `parentThreadId`, and `spawnTurnId` ([t3code/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L885-L966](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L885-L966), [L1426-L1470](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1426-L1470)).
  * *Coordination & Quiet Timeline:*
    * *Spawn CTA Row:* Direct-spawn batches and workflow runs collapse into a single anchored row in the main chat showing member count and status ([PR #5219](https://github.com/pingdotgg/t3code/pull/5219)).
    * *Quiet Timeline:* Subagent internal narration and intermediate tool calls are re-homed into the right-hand **Agents panel** (`AgentsPanel.tsx`) so the main conversation stream remains clean.
    * *Background Liveness:* The `ThreadBackgroundLiveness` service tracks active subagent fibers, displaying a "Working" or "Monitoring" indicator with an active Stop button ([PR #5219](https://github.com/pingdotgg/t3code/pull/5219)).
  * *Stopping & Token Merging:*
    * *Interruption:* Pressing Stop halts live subagents before tearing down the parent turn (calls Claude `stopTask` or Codex child `turn/interrupt`) ([PR #5219](https://github.com/pingdotgg/t3code/pull/5219)).
    * *Token Deduplication:* Codex reports cumulative token usage per thread, so snapshots merge via `Math.max` to prevent double-counting across forked sessions; Claude reports per-activation token usage, so lifetime usage accumulates delta values between snapshots ([PR #4629](https://github.com/pingdotgg/t3code/pull/4629), [PR #5887](https://github.com/pingdotgg/t3code/pull/5887)).

---

### Subscription vs. API Billing Auth Handling
T3 Code is strictly open-source and operates on a **"Bring Your Own Subscription"** model rather than reselling tokens or hosting an API billing proxy ([t3.codes](https://t3.codes), [t3code/docs/user/providers-claude.md#L13-L36](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-claude.md#L13-L36)):

* **Uses Vendor OAuth/CLI Sessions:** Relies on the user having already authenticated their vendor CLI via personal or enterprise web subscriptions:
  * Claude Code: Authenticates via `claude auth login`, writing credentials to `CLAUDE_CONFIG_DIR` or `~/.claude.json` / system keychain ([t3code/docs/user/providers-claude.md#L17-L36](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-claude.md#L17-L36)).
  * OpenAI Codex: Authenticates via `codex login`, storing ChatGPT Plus/Team credentials in `CODEX_HOME` (`~/.codex`) ([t3code/docs/user/providers-codex.md#L25-L30](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-codex.md#L25-L30)).
  * Antigravity: Supports `oauth-personal` and `oauth-business` via PKCE browser callbacks, storing tokens in `<stateDir>/providers/antigravity/<hash>` ([t3code/docs/internals/providers.md#L93-L138](https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md#L93-L138)).
* **Suppression of Raw API Keys:** When launching vendor processes, T3 Code’s environment builder scrubs raw API billing environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) and cloud-billing parameters from the spawned environment ([t3code/apps/server/src/provider/ProviderInstanceEnvironment.test.ts#L11-L17](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/ProviderInstanceEnvironment.test.ts#L11-L17), [docs/internals/providers.md#L135-L138](https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md#L135-L138)).
* **Config Directory Scoping:** Providers accept custom config directory paths (e.g. `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_HOME`), allowing users to switch between separate personal and work subscription profiles without touching system-wide environment variables ([t3code/docs/user/providers-claude.md#L63-L100](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-claude.md#L63-L100)).

---

### Mobile Surface & Remote-Attach Mechanisms
* **Mobile Surface Implementation:**
  * Native cross-platform application in `apps/mobile/` built with **React Native** and **Expo 57** using Hermes, `@clerk/expo` authentication, and `@pierre/diffs` for visual file diffs ([t3code/apps/mobile/package.json#L7-L60](https://github.com/pingdotgg/t3code/blob/main/apps/mobile/package.json#L7-L60)).
  * *Features:* Environment switcher, project and thread drawer navigation, streaming chat, voice input, interactive approval/question popups, model picker, and a native terminal powered by libghostty / GhosttyKit (`apps/mobile/modules/t3-terminal`) ([t3code/apps/mobile/package.json#L7-L60](https://github.com/pingdotgg/t3code/blob/main/apps/mobile/package.json#L7-L60)).
* **Remote-Attach Mechanisms:**
  The server (`apps/server`) exposes a single HTTP and WebSocket runtime boundary; clients connect through one of four access channels ([t3code/docs/internals/remote.md#L12-L68](https://github.com/pingdotgg/t3code/blob/main/docs/internals/remote.md#L12-L68), [docs/user/remote-access.md#L32-L100](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md#L32-L100)):
  1. **Direct Bearer Pairing (`BearerConnectionTarget`):**
     * Running `npx t3 pair` on the host generates a one-time cryptographic pairing token rendered as a terminal QR code. The mobile client scans the QR code or opens `https://app.t3.codes/pair?host=...#token=...`, exchanges the token with the backend, and saves a persistent bearer credential locally in Keychain/DataStore.
  2. **Tailscale Private Mesh (`tailscaleServeEnabled`):**
     * Running `npx t3 pair --tailscale` maps the backend port via `tailscale serve` to provide an encrypted HTTPS/WSS URL (`https://<machine>.<tailnet>.ts.net/`). The mobile app connects over the private tailnet mesh without port forwarding.
  3. **T3 Connect Relay Tunnels (`RelayConnectionTarget`):**
     * For machines behind NAT or firewalls, `t3 connect` provisions an authenticated Cloudflare tunnel. A Cloudflare Worker brokers credentials and assigns a persistent hostname; application WebSocket traffic streams end-to-end over the tunnel without exposing local listening ports.
  4. **Desktop-Managed SSH (`SshConnectionTarget`):**
     * The desktop client can connect to remote Linux/macOS machines over SSH, automatically provision or reuse a remote `t3 serve` process, set up local port forwarding, and attach over local loopback.

---

## Transport Comparison Table

The following table summarizes and compares every remote-attach transport mechanism across all four analyzed targets:

| Project / Target | Transport | Auth | Streaming? | Steer / Interrupt? | Subscription-Safe? | Citation Links |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| **1. runzhliu/deepseek-harness-docker** *(Web UI / API)* | HTTP & WebSocket (`/api/remote.mux` on port 3080) | DSH launch token (`GET /?token=...`) exchanged for session cookie | Yes (WebSocket) | Yes (HTTP POST abort & prompt queue steering) | Depends on backend LLM config (typically API keys) | [Dockerfile](https://github.com/runzhliu/deepseek-harness-docker/blob/main/Dockerfile), [compose.yaml](https://github.com/runzhliu/deepseek-harness-docker/blob/main/compose.yaml) |
| **1. runzhliu/deepseek-harness-docker** *(Virtual Desktop)* | noVNC WebSocket via websockify (port 6080 to x11vnc :5900) | None by default (`-nopw`) | Yes (RFB frame stream) | Yes (direct X11 / mouse / keyboard interaction) | N/A (virtual desktop display) | [entrypoint](https://github.com/runzhliu/deepseek-harness-docker/blob/main/scripts/deepseek-harness-entrypoint#L123-L136) |
| **2. sorsama/deepseek-harness-mobile** *(Direct LAN)* | HTTP POST + bidirectional WebSocket (`/api/remote.mux`) | Launch token exchanged via `GET /?token=...` for signed cookie | Yes (logical mux streams) | Yes (turn stop, queue reorder, subagent interrupt) | Depends on host DSH config (typically API keys) | [PROTOCOL.md](https://github.com/sorsama/deepseek-harness-mobile/blob/main/docs/PROTOCOL.md#L170), [RpcTransport.kt](https://github.com/sorsama/deepseek-harness-mobile/blob/main/core/src/main/kotlin/com/labteto/dshmobile/core/wire/RpcTransport.kt) |
| **2. sorsama/deepseek-harness-mobile** *(Relay Mode)* | WSS & HTTPS over TLS to companion `dsh-relay` plugin | `Authorization: Bearer <token>` + pinned TLS certificate | Yes (logical mux streams) | Yes (turn stop, queue reorder, subagent interrupt) | Depends on host DSH config (typically API keys) | [README.md](https://github.com/sorsama/deepseek-harness-mobile/blob/main/README.md#L105), [RpcTransport.kt](https://github.com/sorsama/deepseek-harness-mobile/blob/main/core/src/main/kotlin/com/labteto/dshmobile/core/wire/RpcTransport.kt#L191) |
| **3. GithungDang/dsh-client-ui-mobile** *(In-Browser Plugin)* | Browser-native HTTP & WebSocket (injected into `dsh web` DOM) | Existing browser session cookie from `dsh web` host | Yes (via host web client runtime) | Yes (via styled host UI buttons) | Depends on host DSH config (typically API keys) | [package.json](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/package.json), [src/client/index.ts](https://github.com/GithungDang/dsh-client-ui-mobile/blob/main/src/client/index.ts) |
| **4. t3.codes / t3code** *(Direct Bearer)* | HTTP & WebSocket (`ws://` / `wss://`, default port 3773) | QR code / URL token exchange (`t3 pair`) for persistent bearer token | Yes (PubSub event stream + catchup snapshot) | Yes (stop turn, cancel prompt, stop subagent fleet) | **Yes** (uses CLI subscription logins; scrubs API keys) | [remote.md](https://github.com/pingdotgg/t3code/blob/main/docs/internals/remote.md#L141), [remote-access.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md#L32) |
| **4. t3.codes / t3code** *(Tailscale Serve)* | HTTPS & WSS via `tailscale serve` | Tailscale private network mesh + bearer pairing token | Yes (PubSub event stream + catchup snapshot) | Yes (stop turn, cancel prompt, stop subagent fleet) | **Yes** (uses CLI subscription logins; scrubs API keys) | [remote.md](https://github.com/pingdotgg/t3code/blob/main/docs/internals/remote.md#L156), [remote-access.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md#L42) |
| **4. t3.codes / t3code** *(T3 Connect Relay)* | Cloudflare Tunnel WebSocket mediated by Cloudflare Worker | Clerk auth + T3 Connect link authorization proof | Yes (PubSub event stream + catchup snapshot) | Yes (stop turn, cancel prompt, stop subagent fleet) | **Yes** (uses CLI subscription logins; scrubs API keys) | [t3-connect.md](https://github.com/pingdotgg/t3code/blob/main/docs/internals/t3-connect.md), [remote.md](https://github.com/pingdotgg/t3code/blob/main/docs/internals/remote.md#L148) |
| **4. t3.codes / t3code** *(Desktop SSH)* | SSH tunnel forwarding remote server port to localhost | SSH key / password authentication + loopback bearer token | Yes (PubSub event stream + catchup snapshot) | Yes (stop turn, cancel prompt, stop subagent fleet) | **Yes** (uses CLI subscription logins; scrubs API keys) | [remote.md](https://github.com/pingdotgg/t3code/blob/main/docs/internals/remote.md#L162) |
