import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { polymorphicThisResultsSource } from "../../../../tsonic/test/fixtures/polymorphic-this-results.mjs";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const fieldlessSource = `
export class Frame<Value> { retain(): this { return this; } }
export class Child<Value> extends Frame<Value> {}
export function retain<Value>(value: Frame<Value>): Frame<Value> { return value.retain(); }
`;

test("generic polymorphic handle Clone and owned dispatch field Clone have distinct exact obligations", () => {
  for (const [source, name, expected] of [[fieldlessSource, "Frame", ["static"]],
    [polymorphicThisResultsSource, "Base", ["clone", "static"]]]) {
    const { program } = analyzeRust({ files: { "index.ts": source } });
    const owner = program.projectTypes.definitions.find(definition => definition.sourceName === name);
    assert.equal(owner !== undefined, true, `${name} exact generic owner`);
    const requirements = program.declarationGenericRequirements.contractFor(owner.declaration);
    assert.equal(requirements !== undefined, true, `${name} finalized requirements`);
    assert.deepEqual(requirements.typeParameters.map(parameter => parameter.requirements), [expected]);
  }
});

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`checked polymorphic this returns preserve the actual result and derived members in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": `${polymorphicThisResultsSource}\nexport function main(): void { if (!run()) throw new Error("polymorphic-this-results"); }` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5).map(row => row.message.slice(0, 256)).join("\n"));
    const emitted = artifactText(result, "src/index.rs");
    assert.match(emitted, /Child::try_from\(/u);
    assert.doesNotMatch(emitted, /invoke_dynamic|read_dynamic_slot|downcast_unchecked|transmute/u);
    validateGeneratedProject(`polymorphic-this-results-${lane}`, result.artifacts, { run: true });
  });
}

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`polymorphic handles clone non-Clone generic parameters without allocation in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "lib" } },
      files: { "index.ts": fieldlessSource } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5).map(row => row.message.slice(0, 256)).join("\n"));
    const directory = writeGeneratedProject(`polymorphic-non-clone-handle-${profile}`, result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod handle_costs {
    use super::*;
    ${nativeOwnershipCostSupport}

    struct Payload;

    #[test]
    fn handle_cloning_neither_clones_a_payload_nor_allocates() {
        let original = Frame::<Payload>::new();
        let (copied, cost) = measure(|| original.clone());
        assert_eq!(cost, Cost::default());
        assert_eq!(original, copied);
        let (retained, cost) = measure(|| retain(copied));
        assert_eq!(cost, Cost::default());
        assert_eq!(original, retained);
        let child = Child::<Payload>::new();
        let (copied_child, cost) = measure(|| child.clone());
        assert_eq!(cost, Cost::default());
        assert_eq!(child, copied_child);
    }
}
`);
    runCargo(directory, ["fmt", "--all"]);
    runCargo(directory, ["generate-lockfile", "--offline"]);
    runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
  });
}
