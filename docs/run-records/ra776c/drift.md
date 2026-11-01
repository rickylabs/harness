# Drift (ra776c)

- The declared surface grew by the rule-4 splits listed in `supervisor.md`; they were recorded
  before commit, not discovered afterwards.
- Refusal-only rows under incomplete native coverage changed from `complete:true` to incomplete
  with the coverage reason. Same defect class as review item 2 (a complete claim while a hidden run
  may exist on the issue); the refusal itself is kept.
