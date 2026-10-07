import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { callableInputBorrowSource } from "../../../../tsonic/test/fixtures/callable-input-borrows.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

test("invocation-only callback inputs consume exact inferred borrowed producer signatures",
  { timeout: 300_000 }, () => {
    const name = "callable_input_borrows";
    const { result } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": callableInputBorrowSource },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    const output = artifactText(result, "src/index.rs");
    assert.match(output, /fn normalize\(value: &str\)/u);
    const directory = writeGeneratedProject(name, result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod invocation_input_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn inline_readonly_callback_does_not_allocate_or_copy_its_input() {
        let input = String::from("native");
        assert_eq!(measuredInline(&input).unwrap(), 6.0);
        let (length, cost) = measure(|| measuredInline(std::hint::black_box(&input)).unwrap());
        assert_eq!(length, 6.0);
        assert_eq!(cost, Cost::default(), "a borrowed stack closure needs no callback box or string copy");
        assert_eq!(input, "native", "the source value remains available");
    }
}
`);
    runCargo(directory, ["fmt", "--all"]);
    runCargo(directory, ["check", "--all-targets", "--offline"]);
    runCargo(directory, ["clippy", "--all-targets", "--offline", "--", "-D", "warnings"]);
    runCargo(directory, ["test", "--release", "--offline", "--", "--test-threads=1"]);
    runCargo(directory, ["run", "--release", "--offline"]);
  });
