# Stage 1 Capability Ledger

`stage1_inventory.tsv` is the committed Packet M ledger for the Rust JS/Node external runtime crates.

The ledger is intentionally separate from ignored `.analysis` files so CI can enforce the shipped Stage 1 contract. Every row is classified as `implemented`, `deferred`, or `hard-reject`; implemented rows must name a Rust ABI group and test evidence, while deferred and hard-reject rows must not expose a runtime API.

Update this ledger whenever the runtime surface changes.
