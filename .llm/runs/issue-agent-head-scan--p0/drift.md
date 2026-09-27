# Drift

- 2026-09-27 22:52 UTC — Stage F caught a head/full-parser grammar gap and a read-race gap before product mutation. The locked plan now names both parent-id sources, conflicting/self-parent rejection, and full-parse agreement with the selected head. Both get focused tests.
- 2026-09-27 22:53 UTC — Stage F caught a timezone completeness gap: parsing filename clock in host TZ could include the root but exclude a late child if producer TZ differs. Replaced host-local parsing with a ±24-hour wall-clock/date envelope and 128-head fail-closed cap; the test must include a shifted child on the next day.
