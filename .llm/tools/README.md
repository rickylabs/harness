# Compatibility method entrypoints

Canonical validators and gate vocabulary live in [method/tools](../../method/README.md).
These old module, test and CLI paths delegate to the canonical implementations. Explicit CLI
launch guards propagate the actual verdict and exit status; imports do not launch commands.
Regenerate wrappers with `node scripts/method-compatibility.mjs --write` from the checkout root.
