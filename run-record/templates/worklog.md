# Worklog: <target>

## Run Metadata

| Field          | Value                          |
| -------------- | ------------------------------ |
| Run ID         | `<run-id>`                     |
| Branch         | `<branch>`                     |
| Archetype      | `<N - name or N/A>`            |
| Scope overlays | `<frontend/service/docs/none>` |

## Design

Record this section before creating implementation files. See `workflow/run-loop.md` § 3b for the
full requirement.

### Public Surface

- `<exported function or entry point>`

### Domain Vocabulary

- `<type or interface>` — `<purpose>`

### Ports

- `<port>` — `<why it exists>`

### Constants

- `<CONSTANT_GROUP>` — `<values>`

### Commit Slices

| # | Slice                  | Gate             | Files     |
| - | ---------------------- | ---------------- | --------- |
| 1 | `<what it introduces>` | `<gate command>` | `<files>` |

### Deferred Scope

- `<capability>` — `<reason>`

### Contributor Path

`<how a developer adds a feature>`

## Progress Log

| Time     | Slice       | Step     | Notes     |
| -------- | ----------- | -------- | --------- |
| `<time>` | `<slice #>` | `<step>` | `<notes>` |

## Decisions

| Decision     | Reason     | Source                 |
| ------------ | ---------- | ---------------------- |
| `<decision>` | `<reason>` | `<plan/doctrine/code>` |

## Drift

| Drift     | Severity                            | Logged in drift.md |
| --------- | ----------------------------------- | ------------------ |
| `<drift>` | `<minor/significant/architectural>` | `<yes/no>`         |

## Gate Results

### Static Gates

| Gate     | Command or check | Result                    | Notes     |
| -------- | ---------------- | ------------------------- | --------- |
| `<gate>` | `<command>`      | `<PASS/FAIL/N/A/NOT_RUN>` | `<notes>` |

### Fitness Gates

| Gate    | Result                                         | Evidence     | Notes     |
| ------- | ---------------------------------------------- | ------------ | --------- |
| `<F-#>` | `<PASS/FAIL/PENDING_SCRIPT/N/A/DEBT_ACCEPTED>` | `<evidence>` | `<notes>` |

### Runtime Gates

| Gate     | Result                    | Evidence     | Notes     |
| -------- | ------------------------- | ------------ | --------- |
| `<gate>` | `<PASS/FAIL/N/A/NOT_RUN>` | `<evidence>` | `<notes>` |

### Consumer Gates

| Consumer     | Result                    | Evidence     | Notes     |
| ------------ | ------------------------- | ------------ | --------- |
| `<consumer>` | `<PASS/FAIL/N/A/NOT_RUN>` | `<evidence>` | `<notes>` |

## Handoff Notes

- <what the evaluator should inspect first>
