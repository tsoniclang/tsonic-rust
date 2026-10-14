import assert from "node:assert/strict";
import { analyzeRustErrorEffects } from "./rust-error-analysis.mjs";
import { rustOperationContext } from "../../dist/analysis/program/walk.js";

export function analyzeRustOperations(text, options = {}) {
  let walk;
  const admissions = Object.fromEntries(["target", "operation", "call", "argument"].map(name => [name, new Map()]));
  const count = (family, node) => admissions[family].set(node, (admissions[family].get(node) ?? 0) + 1);
  const context = analyzeRustErrorEffects(text, options, original => ({ ...original, records: {
    ...original.records,
    typeOnlyDeclarations: { ...original.records.typeOnlyDeclarations,
      finalize(current, files) { walk = current; return original.records.typeOnlyDeclarations.finalize(current, files); } },
    targetOperations: { ...original.records.targetOperations,
      checked(node, selected) { count("target", node); return original.records.targetOperations.checked(node, selected); } },
    selectedOperations: { ...original.records.selectedOperations,
      checked(node, selected) { count("operation", node); return original.records.selectedOperations.checked(node, selected); } },
    selectedCalls: { ...original.records.selectedCalls,
      checked(request, selected) { count("call", request.source.call); return original.records.selectedCalls.checked(request, selected); } },
    argumentPassingPlans: { ...original.records.argumentPassingPlans,
      pass(node, mode) { count("argument", node); return original.records.argumentPassingPlans.pass(node, mode); } },
  } }));
  assert.equal(walk !== undefined, true, "the real analysis walk is captured through its existing producer port");
  return { context, walk, admissions,
    requestFor(call) {
      const current = rustOperationContext(walk, call);
      const source = current.currentSemantics.operations.call(call);
      assert.equal(source !== undefined, true, "the real checker supplied this call");
      const sourceSelectedDeclaration = current.currentSemantics.declarations.signatureDeclaration(source.selectedSignature);
      return { target: "rust", source, ...(sourceSelectedDeclaration === undefined ? {} : { sourceSelectedDeclaration }) };
    },
  };
}
