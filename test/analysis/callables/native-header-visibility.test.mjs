import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { genericCallableOwnershipCases } from "../../../../tsonic/test/fixtures/generic-callable-ownership.mjs";

const source = genericCallableOwnershipCases.find(example => example.name === "transitive-native-constraint").source + "\nmain();\n";

for (const surfaces of [[], ["js"]]) for (const outputType of ["bin", "lib"]) {
  test(`native callable headers retain actual ${outputType} ABI visibility in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType } }, files: { "index.ts": source } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.map(issue => `${issue.code}: ${issue.message.slice(0, 256)}`).join("\n"));
    const program = result.program;
    const { ast } = program.source;
    const declaration = program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
      ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "create");
    assert.equal(declaration !== undefined, true, "the actual checked source export is present");
    const emission = program.records.callableDeclaration.get(declaration);
    assert.equal(emission?.exported, true, "the authored source export remains unchanged");
    assert.equal(emission?.visibility, outputType === "lib" ? "public" : "crate",
      "native publicness follows the actual implementation ABI rather than source export spelling");
    const contract = program.records.nativeGenerics.get(declaration)?.sourceContract;
    assert.equal(contract?.parameters.length, 2, "both checked source type parameters remain in the native contract");
    const artifact = result.artifacts.find(artifact => artifact.path === "src/lib.rs");
    assert.equal(artifact !== undefined, true, "the actual native module boundary is emitted");
    assert.equal(artifact.text.includes(outputType === "lib" ? "pub mod index;" : "pub(crate) mod index;"), true,
      "the declaration visibility agrees with the native module publication");
    const module = result.artifacts.find(artifact => artifact.path === "src/index.rs");
    assert.equal(module !== undefined, true, "the native callable module is emitted");
    assert.equal(module.text.includes(outputType === "lib" ? "pub fn create<" : "pub(crate) fn create<"), true,
      "the renderer preserves the sole sealed native declaration visibility");
  });
}
