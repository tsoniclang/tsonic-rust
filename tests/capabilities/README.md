# Runtime Capability Ledgers

`stage1_inventory.tsv` is the committed Packet M ledger for the Rust JS/Node external runtime crates.

The ledger is intentionally separate from ignored `.analysis` files so CI can enforce the shipped surface contract. Every row is classified as `implemented` or `hard-reject`; implemented rows must name a Rust ABI group and test evidence, while hard-reject rows must not expose a runtime API.

Update this ledger whenever the runtime surface changes.

`node_api_full_inventory.csv` is the broad Node API inventory generated from local `@types/node` declarations. It is intentionally much larger than the implemented runtime ledger: it makes the full documented/typed Node surface visible and classifies each row as `phase1`, `later`, or `hard-reject`.

Phase 1 means high-use APIs that fit the closed Rust runtime ABI without event loop, network stack, VM/loader, process-spawning, or broad dependency design. `later` means important but explicitly postponed. `hard-reject` means the API is outside the architecture for generated Rust runtime externals.

Regenerate with:

```sh
node tools/generate-node-api-inventory.mjs tests/capabilities/node_api_full_inventory.csv
```
