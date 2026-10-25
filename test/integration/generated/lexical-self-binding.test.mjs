import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { lexicalSelfBindingSource } from "../../../../tsonic/test/fixtures/lexical-self-binding.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`fixed self and written lexical bindings retain distinct native identities in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": (lexicalSelfBindingSource + "\nmain();\n") } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    const program = result.program;
    let independentConstructions = 0;
    for (const definition of program.callableValues.frames.definitions) for (const entry of definition.entries) {
      for (const implementation of entry.implementations) {
        if (!implementation.independent) continue;
        const operation = program.records.targetOperation.get(implementation.declaration);
        if (operation?.kind !== "closure") continue;
        const carrier = program.callableValues.frames.independentCarrierFor(operation.resultCarrier);
        assert.equal(carrier !== undefined, true, "the independent frame entry publishes its completed construction carrier");
        const lambda = program.records.lambdaBody.get(implementation.declaration);
        assert.equal(lambda?.construction === "native", true, "an independent closure uses its admitted native construction");
        assert.equal(rustTargetTypeRefEquals(lambda.constructionCarrier, carrier), true,
          "inventory and lambda emission consume the identical completed construction ABI");
        const physical = program.callableValues.nativeProducers.physicalFor(implementation.declaration, carrier);
        assert.equal(physical !== undefined, true, "the exact completed carrier was prepared before the physical seal");
        assert.equal(rustTargetTypeRefEquals(lambda.physicalCarrier, physical), true,
          "the original closure consumes the exact published native invocation ABI");
        independentConstructions++;
      }
    }
    assert.equal(independentConstructions > 0, true, "the original self-binding program exercises independent frame construction");
    const emitted = artifactText(result, "src/index.rs");
    assert.equal(typeof emitted === "string", true, "actual source-to-native output");
    assert.match(emitted, /::recursive\(/u, "fixed named self uses the existing recursive native owner");
    assert.match(emitted, /binding_0: core::cell::OnceCell::new\(\)/u,
      "the native lexical frame owns exact once-only binding activation");
    assert.match(emitted, /binding_0\s*\.get\(\)[\s\S]*?\.replace\(field_value\)/u,
      "rebinding updates that same live frame slot");
    assert.doesNotMatch(emitted, /Location::uninitialized\(/u, "no second live-binding representation");
    const { ast } = program.source;
    const declarations = program.sourceFiles.flatMap(file => ast.statements(file));
    const calls = ["fixedSelf", "liveBinding"].map(name => {
      const declaration = declarations.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === name);
      assert.equal(declaration !== undefined, true, `${name}: the native harness selects the original checked function`);
      const selected = program.records.callableDeclaration.get(declaration);
      assert.equal(selected !== undefined, true, `${name}: the native harness consumes its published callable ABI`);
      assert.equal(typeof selected.resultWrapped, "boolean", `${name}: the physical error result is selected before publication`);
      return `${name}()${selected.resultWrapped ? ".unwrap()" : ""}`;
    });
    validateGeneratedProject(`lexical-self-binding-${profile}`, result.artifacts, { run: true });
    const directory = writeGeneratedProject(`lexical-self-binding-drop-${profile}`, result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod lexical_owner_drop {
    use super::*;
    ${nativeOwnershipCostSupport(directory)}

    #[test]
    fn fixed_self_and_replaced_live_binding_release_all_native_owners() {
        for _ in 0..32 {
            let (result, cost) = measure(|| (${calls.join(", ")}));
            assert_eq!(result, (true, true));
            assert!(cost.allocations > 0);
            assert_eq!(cost.allocations, cost.deallocations);
            assert_eq!(cost.allocated_bytes, cost.deallocated_bytes);
            assert_eq!(cost.reallocations, 0);
        }
    }
}
`);
    const executed = runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
    assert.equal(executed.status, 0, executed.stdout.slice(-4096) + executed.stderr.slice(-4096));
  });
}
