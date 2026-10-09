import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustSourceParameterAbiFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planRustCallableParameters, planRustCallableParameterPrelude } from "../../../../dist/backend/planner/declarations/callables/parameters.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustOptionTargetType } from "../../../../dist/target-model/types/carriers/optional.js";

test("destructured defaults consume the sealed initialized value and reject conflicting input evidence", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function read([value]: [number] = [11], required: number): number { return value + required; }
  ` } });
  const { ast } = program.source;
  const sourceFile = program.sourceFiles[0];
  const callable = ast.statements(sourceFile).find(node => node !== undefined && ast.is.IsFunctionDeclaration(node));
  assert.equal(callable !== undefined, true, "exact authored callable");
  const parameter = ast.parameters(callable)[0];
  const abi = program.facts.getFact(parameter, rustSourceParameterAbiFactKey);
  assert.equal(abi.form, "default");
  assert.equal(abi.valueCarrier.kind, "tuple");
  assert.equal(abi.parameterCarrier.kind, "target-named");
  const plan = (selectedAbi, sourceCarrier = abi.valueCarrier) => {
    const facts = { ...program.facts,
      getFact: (subject, key) => subject === parameter && key === rustSourceParameterAbiFactKey
        ? selectedAbi : program.facts.getFact(subject, key),
      getRuntimeCarrierFact: subject => subject === parameter
        ? sourceCarrier === undefined ? undefined : { carrier: sourceCarrier }
        : program.facts.getRuntimeCarrierFact(subject),
    };
    const names = createRustSyntheticNameState(ast, callable, []);
    const context = { input: { program: { ...program, facts } }, sourceFile,
      diagnostics: [], usedAliases: new Set(), syntheticNames: names,
      moduleName: "index", structuralShapesModuleName: "shapes",
      moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
      externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map() };
    return { selected: planRustCallableParameters(callable, context, names), diagnostics: context.diagnostics };
  };
  const valid = plan(abi);
  assert.equal(valid.selected !== undefined, true, "initialized tuple accepts optional transport");
  assert.equal(valid.diagnostics.length, 0);
  assert.deepEqual(valid.selected.prelude.map(entry => entry.kind), ["default", "binding"]);
  for (const selectedAbi of [{ ...abi, mode: "ref" }, { ...abi, mode: "mut-ref" },
    { ...abi, valueCarrier: { kind: "source-primitive", name: "float64" } }]) {
    const invalid = plan(selectedAbi);
    assert.equal(invalid.selected === undefined, true, "conflicting exact binding input rejects");
    assert.equal(invalid.diagnostics.length, 1);
    assert.equal(invalid.diagnostics[0].evidence.includes("target.capability=rust.backend.binding-parameter-abi"), true);
  }
});

test("an absent default preserves the native parameter and independently required mutability", () => {
  const carrier = rustOptionTargetType({ kind: "source-primitive", name: "int64" });
  const initializer = {};
  for (const mutable of [false, true]) {
    let evaluations = 0;
    const context = { syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() } };
    const selected = planRustCallableParameterPrelude({ params: [], prelude: [{
      kind: "default", initializer, name: "value", mutable, carrier, valueCarrier: carrier,
    }] }, context, node => {
      evaluations++;
      assert.equal(node === initializer, true, "exact original initializer");
      return { kind: "none" };
    });
    assert.equal(evaluations, 1);
    assert.deepEqual(selected, mutable ? [{ kind: "let", name: "value", mutable: true,
      init: { kind: "path", path: "value" } }] : [],
    "no redundant native alias, while an actual mutability transition remains intact");
  }
});
