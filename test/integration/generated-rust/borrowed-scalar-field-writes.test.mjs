import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustSourceCallEffectsFactKey } from "../../../dist/analysis/facts/keys.js";
import { borrowedScalarFieldWritesSource, borrowedScalarFieldFreezeSource, ordinaryScalarFieldWritesSource,
  ownedFieldSnapshotSource, ownedFieldSnapshotRunSource } from "../../../../tsonic/test/fixtures/borrowed-scalar-field-writes.mjs";
import { receiverFieldCaptureEdges } from "../../../../tsonic/test/fixtures/receiver-field-capture-edges.mjs";

function functionText(output, name) {
  const start = output.indexOf(`fn ${name}(`);
  assert.equal(start >= 0, true, name);
  const rest = output.slice(start);
  const next = rest.search(/\n(?:pub(?:\([^)]*\))? )?fn /u);
  return next < 0 ? rest : rest.slice(0, next);
}

function unwrapSuffix(program, name) {
  const ast = program.source.ast;
  const declaration = program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
    ast.is.IsFunctionDeclaration(node) && ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
  assert.equal(declaration !== undefined, true, name);
  const effect = program.facts.getFact(declaration, rustSourceCallEffectsFactKey);
  assert.equal(effect !== undefined, true, name + " invocation");
  return effect.invocation === "fallible" ? ".unwrap()" : "";
}

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`the admitted captured Point fixture emits no child clone in ${profile}`, { timeout: 300_000 }, () => {
    const fixture = receiverFieldCaptureEdges.find(example => example.name === "projected-fields");
    assert.equal(fixture !== undefined, true);
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": fixture.source +
        '\nexport function main(): void { if (!run()) throw new Error("borrowed Point write"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    const output = artifactText(result, "src/index.rs");
    assert.doesNotMatch(output, /\bborrowed(?:_\d+)?\.clone\(\)/u);
    assert.equal(validateGeneratedProject(`borrowed-point-write-${profile}`, result.artifacts, { run: true }).status, 0);
  });

  test(`pure captured writes avoid clones while replacements and getters retain the original child in ${profile}`,
    { timeout: 300_000 }, () => {
      const frozen = surfaces.length === 0 ? "" : borrowedScalarFieldFreezeSource;
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
        files: { "index.ts": borrowedScalarFieldWritesSource + frozen +
          `\nexport function main(): void { if (!run()${surfaces.length === 0 ? "" : " || !frozenWrite()"}) throw new Error("scalar write order"); }` } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
      const output = artifactText(result, "src/index.rs");
      for (const name of ["parameter", "literal", "storage", "arithmetic"]) {
        const body = functionText(output, name);
        assert.doesNotMatch(body, /\.clone\(\)|Rc::new|Box::new|ObjectHandle::new/u, name);
        assert.match(body, /\.with_mut\(/u, name);
        if (surfaces.length !== 0) assert.match(body, /validate_data_write/u, name + " freeze guard");
      }
      for (const name of ["reentrant", "accessor"]) assert.match(functionText(output, name), /\.clone\(\)/u, name);
      assert.equal(validateGeneratedProject(`borrowed-scalar-writes-${profile}`, result.artifacts, { run: true }).status, 0);
    });

  test(`ordinary distinct child writes retain native borrowed storage in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": ordinaryScalarFieldWritesSource +
        '\nexport function main(): void { if (!run()) throw new Error("ordinary scalar write"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    const body = functionText(artifactText(result, "src/index.rs"), "distinct");
    assert.doesNotMatch(body, /\.clone\(\)|Rc::new|Box::new|ObjectHandle::new/u);
    assert.match(body, /\.with_mut\(/u);
    assert.equal(validateGeneratedProject(`borrowed-ordinary-write-${profile}`, result.artifacts, { run: true }).status, 0);
  });

  test(`reentrant owned writes retain original-child and native Drop ordering in ${profile}`, { timeout: 300_000 }, () => {
    const options = { surfaces, target: { id: "rust", options: { outputType: "bin", crateName: `owned_write_${profile}` } },
      files: { "index.ts": ownedFieldSnapshotSource + ownedFieldSnapshotRunSource +
        '\nexport function main(): void { if (!run()) throw new Error("owned snapshot write"); }' } };
    const { program } = analyzeRust(options);
    const { result } = compileRust(options);
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    const native = `use owned_write_${profile}::{createOwnedBox, createOwnedParent, ownedWrite};
use std::cell::Cell;
use std::rc::Rc;

#[derive(Debug)]
struct Probe {
    digit: u32,
    trace: Rc<Cell<u32>>,
}

impl Clone for Probe {
    fn clone(&self) -> Self {
        panic!("owned payload must not be cloned")
    }
}

impl Drop for Probe {
    fn drop(&mut self) {
        self.trace.set(self.trace.get() * 10 + self.digit);
    }
}

#[test]
fn replacement_preserves_the_original_child_through_rhs_and_store() {
    let trace = Rc::new(Cell::new(0));
    let payload = |digit| Probe {
        digit,
        trace: trace.clone(),
    };
    let parent = createOwnedParent(payload(1))${unwrapSuffix(program, "createOwnedParent")};
    let next = createOwnedBox(payload(2))${unwrapSuffix(program, "createOwnedBox")};
    ownedWrite(parent.clone(), next.clone(), payload(3))${unwrapSuffix(program, "ownedWrite")};
    assert_eq!(trace.get(), 13);
    drop(parent);
    assert_eq!(trace.get(), 13);
    drop(next);
    assert_eq!(trace.get(), 132);
}
`;
    validateGeneratedProject(`owned-write-drop-${profile}`, [...result.artifacts, { path: "tests/drop_order.rs", text: native }], { run: true });
  });
}
