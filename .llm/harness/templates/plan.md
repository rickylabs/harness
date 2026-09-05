# Plan: <target>

## Run Metadata

| Field          | Value                               |
| -------------- | ----------------------------------- |
| Run ID         | `<run-id>`                          |
| Branch         | `<branch>`                          |
| Phase          | `plan`                              |
| Target         | `<package/plugin/app/service/docs>` |
| Archetype      | `<N - name or N/A>`                 |
| Scope overlays | `<frontend/service/docs/none>`      |

## Archetype

<Identified archetype from `.llm/harness/archetypes/README.md`. Include the justification when two
archetypes could apply.>

## Current Doctrine Verdict

<Verdict and headline action from
`docs/architecture/doctrine/10-codebase-verdict-and-handoff.md`. Use N/A
for consumer-only work.>

## Axioms in Play

| Axiom  | Why it matters |
| ------ | -------------- |
| `<A#>` | `<reason>`     |

## Goal

<Concrete outcome.>

## Scope

- <what will change>

## Non-Scope

- <what will not change and why>

## Hidden Scope

- <work a naive read might miss>

## Locked Decisions

| ID     | Decision     | Rationale |
| ------ | ------------ | --------- |
| `<id>` | `<decision>` | `<why>`   |

## Open-Decision Sweep

| Decision     | Status                               | Notes     |
| ------------ | ------------------------------------ | --------- |
| `<decision>` | `<safe to defer / must resolve now>` | `<notes>` |

> Any decision marked "must resolve now" must be resolved before the Plan-Gate.

## Risk Register

| Risk     | Mitigation     |
| -------- | -------------- |
| `<risk>` | `<mitigation>` |

## Anti-Patterns to Resolve or Avoid

| AP       | Status                | Plan                   |
| -------- | --------------------- | ---------------------- |
| `<AP-#>` | `<existing/new/risk>` | `<resolve/avoid/debt>` |

## Fitness Gates

| Gate    | Required   | Expected evidence      |
| ------- | ---------- | ---------------------- |
| `<F-#>` | `<yes/no>` | `<script/manual/debt>` |

## Arch-Debt Implications

| Entry          | Action                       | Notes     |
| -------------- | ---------------------------- | --------- |
| `<entry/path>` | `<create/update/close/none>` | `<notes>` |

## Validation Plan

| Order | Gate     | Command or check  | Expected result |
| ----- | -------- | ----------------- | --------------- |
| 1     | `<gate>` | `<command/check>` | `<expected>`    |

## Risks

- <risk and mitigation>

## Dependencies

- <package/service/run/external dependency>

## Drift Watch

- <facts that should be logged to drift.md if they change>
