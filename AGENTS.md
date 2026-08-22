# Agent Notes (Tsonic Rust)

## Test Rerun Efficiency

- Expectation-only reruns are a narrow exception to complete-suite final gates: when a completed full run has exactly one failure, inspection proves the expectation is stale, and the only subsequent edit changes that expectation with no product, build, configuration, fixture-input, or semantic change, run only the owning focused test.
- Certify that case explicitly as the preceding full run plus the focused corrected test; do not repeat the expensive full suite.
- If the expectation change reflects or approves different product behavior, language semantics, generated output, fixtures, or toolchain policy, it is not expectation-only and still requires the normal full final gate.
