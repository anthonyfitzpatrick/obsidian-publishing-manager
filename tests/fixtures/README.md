# Foundation fixtures

These deterministic, fictional fixtures support engineering work before the production schemas are introduced by DAT-001 and DAT-002. They are test contracts, not user-data formats.

- `small`: 25 books, 100 editions, and 250 tasks for fast functional tests.
- `targetScale`: 1,000 books, 10,000 editions, and 50,000 tasks for the product performance baseline.
- Malformed cases: invalid YAML, duplicate IDs, cycles, traversal, hostile markup, and oversized values.
- Upgrade cases: previous, current, future/read-only, and interrupted/resumable states.

Large datasets are generated in memory instead of committed as thousands of files. Generation uses fixed timestamps, ordered IDs, fictional titles, deterministic links, and deterministic asset-reference distribution. No fixture is copied from a personal vault or real publishing project.
