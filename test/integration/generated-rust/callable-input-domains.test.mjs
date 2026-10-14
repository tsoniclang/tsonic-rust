import assert from "node:assert/strict";
import test from "node:test";
import { nativeCallableContract, nativeType } from "../../helpers/native-ast.mjs";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { callableInputDomainSource, callableInputDomainDeclaration, callableInputDomainObservedCaller } from "../../../../tsonic/test/fixtures/callable-input-domains.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`exported callback ABI remains invariant under additional observed callers in ${lane}`, () => {
    const signatures = [];
    for (const sourceText of [callableInputDomainDeclaration, callableInputDomainDeclaration + callableInputDomainObservedCaller]) {
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "lib" } }, files: { "index.ts": sourceText } });
      assertNoTargetDiagnostics(result.diagnostics);
      const declaration = nativeCallableContract(result, "apply", 1, [nativeType("String")], nativeType("String"));
      assert.equal(declaration.visibility, "public");
      assert.equal(declaration.params[1].type.kind, "reference");
      assert.equal(declaration.params[1].type.mutable, false);
      signatures.push({ params: declaration.params, generics: declaration.generics,
        result: declaration.returnType, error: declaration.errorType });
    }
    assert.deepEqual(signatures[0], signatures[1], "local observations cannot change an externally callable native ABI");
  });

  test(`mixed owning and borrowing native callbacks execute through one declared input ABI in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": (callableInputDomainSource + "\nmain();\n") } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`callable-input-domains-${lane}`, result.artifacts, { run: true });
  });
}

test("an open callback input borrows its exact producer with handwritten stack-adapter costs", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": callableInputDomainSource } });
  assertNoTargetDiagnostics(result.diagnostics);
  const directory = writeGeneratedProject("callable-input-domain-cost", result.artifacts);
  appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod input_domain_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn borrowed_callback_has_no_extra_allocation_or_string_copy() {
        fn native(input: String, operation: &impl Fn(String) -> bool) -> bool { operation(input) }
        let native_input = String::from("native");
        let generated_input = String::from("native");
        let (expected, native_cost) = measure(|| native(std::hint::black_box(native_input),
            &|value: String| value.as_str() == "native"));
        let (actual, generated_cost) = measure(|| measured(std::hint::black_box(generated_input)).unwrap());
        assert!(expected && actual);
        assert_eq!(generated_cost, native_cost, "the owning input is consumed once; its adapter remains on the stack");
        assert_eq!(generated_cost.allocations, 0);
        assert_eq!(generated_cost.reallocations, 0);
        assert_eq!(generated_cost.allocated_bytes, 0);
    }
}
`);
  runCargo(directory, ["fmt", "--all"]);
  runCargo(directory, ["clippy", "--all-targets", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--release", "--offline", "--", "--test-threads=1"]);
});
