import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustSourceUnionTargetType, rustSourcePrimitiveTargetType, rustCallableTargetType,
  rustCarrierSupportsClone, rustCarrierSupportsTrait, rustJsArrayTargetType } from "../../../dist/target-model/types/index.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { recursiveSourceUnionFiles } from "../../fixtures/recursive-source-unions.mjs";

const integer = rustSourcePrimitiveTargetType("int32");
const parameter = { kind: "type-parameter", name: "Value" };
const reference = (name, argument = parameter) => rustSourceUnionTargetType(`/src/${name}.ts`, name, [{ kind: "type", type: argument }]);

test("recursive union references keep immutable exact generic variant contracts", () => {
  const registry = createRustTypeDefinitionRegistry();
  const step = reference("Step");
  const variants = [{ name: "Done", carrier: parameter },
    { name: "Read", carrier: rustCallableTargetType([integer], step) }];
  assert.equal(registry.registerSourceUnion({ carrier: step, variants }, true), true);
  assert.equal(JSON.stringify(step).includes("variants"), false);
  const integerStep = reference("Step", integer);
  assert.deepEqual(registry.sourceUnionVariants(integerStep)[0].carrier, integer);
  const definitions = registry.seal();
  assert.ok(Object.isFrozen(definitions.sourceUnionVariants(integerStep)));
  assert.ok(Object.isFrozen(definitions.sourceUnionVariants(integerStep)[1].carrier));
  assert.ok(Object.isFrozen(definitions.sourceUnionVariants(step)[0].carrier));
  variants[0].name = "Mutated";
  assert.equal(definitions.sourceUnionVariants(step)[0].name, "Done");
  assert.throws(() => registry.registerSourceUnion({ carrier: step, variants }, true), /sealed/u);
  assert.equal(definitions.sourceUnionVariants(reference("Other", integer)), undefined);
  assert.equal(definitions.sourceUnionVariants(rustSourceUnionTargetType("/src/Step.ts", "Step")), undefined);
  const conversion = selectRustSourceValueConversion(integer, integerStep, definitions);
  assert.ok(conversion);
  assert.ok(rustValueConversionContract(conversion, definitions));
  assert.equal(rustValueConversionContract(conversion), undefined);
  assert.equal(rustValueConversionContract({ ...conversion, variantName: "Missing" }, definitions), undefined);
});

test("finalized union input and result conversions require the exact sealed definitions", () => {
  const registry = createRustTypeDefinitionRegistry();
  const carrier = reference("Step", integer);
  assert.equal(registry.registerSourceUnion({ carrier, variants: [
    { name: "Value", carrier: integer }, { name: "Other", carrier: rustSourcePrimitiveTargetType("bool") },
  ] }, true), true);
  const definitions = registry.seal();
  const conversion = selectRustSourceValueConversion(integer, carrier, definitions);
  assert.ok(conversion);
  for (const isAsync of [false, true]) {
    const options = { operationKind: "method", form: { form: "call", path: "acme::convert", argConversions: [conversion] },
      sourceArgumentCarriers: [integer], resultCarrier: integer, resultConversion: conversion, isAsync, isFallible: false };
    const abi = finalizeRustProviderOperationAbi(options, definitions);
    assert.ok(abi);
    assert.equal(validateRustFinalizedOperationAbi(abi, definitions), true);
    assert.equal(validateRustFinalizedOperationAbi(abi), false);
    const changedInput = structuredClone(abi);
    changedInput.targetArguments[0].conversion.conversion.variantName = "Missing";
    assert.equal(validateRustFinalizedOperationAbi(changedInput, definitions), false);
    const changedResult = structuredClone(abi);
    const result = isAsync ? changedResult.result.awaitedConversion : changedResult.result.conversion;
    result.conversion.variantName = "Missing";
    assert.equal(validateRustFinalizedOperationAbi(changedResult, definitions), false);
  }
});

test("union registration rejects incomplete, malformed and contradictory contracts transactionally", () => {
  const registry = createRustTypeDefinitionRegistry();
  const carrier = reference("Step");
  const variants = [{ name: "First", carrier: parameter }, { name: "Second", carrier: integer }];
  const valid = { carrier, variants };
  const sparse = new Array(2);
  sparse[1] = variants[1];
  for (const bad of [null, {}, { ...valid, extra: true }, { ...valid, variants: sparse },
    { ...valid, variants: [null, variants[1]] }, { ...valid, variants: variants.slice(1) },
    { ...valid, variants: [variants[0], { ...variants[1], name: "First" }] },
    { ...valid, variants: [variants[0], { name: "Second", carrier: {} }] },
    { ...valid, variants: [variants[0], { ...variants[1], extra: true }] }]) {
    assert.equal(registry.registerSourceUnion(bad, true), false);
    assert.equal(registry.sourceUnionVariants(carrier), undefined);
  }
  assert.equal(registry.registerSourceUnion(valid, true), true);
  assert.equal(registry.registerSourceUnion({ ...valid, variants: variants.toReversed() }, true), false);
  assert.deepEqual(registry.sourceUnionVariants(carrier).map(variant => variant.name), ["First", "Second"]);
  const missing = reference("Missing");
  assert.equal(registry.registerSourceUnion({ carrier: reference("Holder"), variants: [
    { name: "Value", carrier: integer }, { name: "Next", carrier: rustCallableTargetType([], missing) },
  ] }, true), true);
  assert.throws(() => registry.seal(), /undefined or incompatible/u);
  assert.equal(registry.registerSourceUnion({ carrier: missing, variants }, true), true);
  assert.ok(registry.seal());
});

test("recursive clone proofs retain generic and non-Clone requirements without unfolding forever", () => {
  const registry = createRustTypeDefinitionRegistry();
  const step = reference("Step");
  assert.equal(registry.registerSourceUnion({ carrier: step, variants: [
    { name: "Done", carrier: parameter }, { name: "Next", carrier: step },
  ] }, true), true);
  assert.equal(rustCarrierSupportsClone(reference("Step", integer), registry), true);
  assert.equal(rustCarrierSupportsClone(step, registry), false);
  assert.equal(rustCarrierSupportsTrait(step, "core::clone::Clone", name => name === "Value", undefined, registry), true);
  const unique = { kind: "reference", mutable: true, referent: integer };
  assert.equal(rustCarrierSupportsClone(reference("Step", unique), registry), false);
  const expanding = reference("Growing");
  assert.equal(registry.registerSourceUnion({ carrier: expanding, variants: [
    { name: "Done", carrier: parameter }, { name: "Next", carrier: reference("Growing", rustJsArrayTargetType(parameter)) },
  ] }, true), true);
  assert.equal(rustCarrierSupportsClone(reference("Growing", integer), registry), false);
});

for (const surfaces of [[], ["js"]]) {
  test(`recursive generic and mutually recursive unions execute on ${surfaces.length === 0 ? "native" : "js"} profile`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "recursive_unions" } },
      files: recursiveSourceUnionFiles });
    assert.deepEqual(result.diagnostics, []);
    assert.match(artifactText(result, "src/steps.rs"), /enum Step<Value>/u);
    const run = validateGeneratedProject("recursive-source-unions", result.artifacts, { run: true });
    assert.equal(run.status, 0, JSON.stringify(run));
  });
}
