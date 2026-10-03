import assert from "node:assert/strict";
import test from "node:test";
import { rustWritableErrorRecoveryOriginMatches, selectRustProgramErrorConversion } from "../../../dist/policy/conversions/program-error.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustSourceTypeCarrier, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustMutableJsErrorTargetType, rustSourceErrorTargetType, rustWritableSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";
import { rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const error = rustSourceTypeCarrier("/source.ts", "Failure", "object");
const unrelated = rustSourceTypeCarrier("/source.ts", "Unrelated", "object");
const unknown = rustSourceTypeCarrier("/unknown.ts", "Error", "object");
const definitions = new Map([[error, {}], [unrelated, {}]]);
const projectTypes = {
  definitionForCarrier: carrier => [...definitions].find(([selected]) => rustTargetTypeRefEquals(selected, carrier))?.[1],
  openCarrier: definition => [...definitions].find(([, selected]) => selected === definition)?.[0],
  programErrorVariant: definition => [...definitions].find(([, selected]) => selected === definition)?.[0] === error ? "Failure" : "Unrelated",
  sourceErrorDefinitions: [definitions.get(error)],
};

test("exact writable Error origins remain admitted and sealed non-Error origins are excluded by the guard", () => {
  for (const carrier of [error, unrelated, rustMutableJsErrorTargetType(), rustWritableSourceErrorTargetType()]) {
    assert.equal(rustWritableErrorRecoveryOriginMatches(carrier, projectTypes), true);
  }
  assert.equal(selectRustProgramErrorConversion(unrelated, projectTypes, [], undefined, rustWritableSourceErrorTargetType()), undefined);
  assert.equal(selectRustProgramErrorConversion(unrelated, projectTypes, [], undefined, rustSourceErrorTargetType()), undefined);
});

test("opaque and immutable admitted Error origins retain the strict physical writable proof", () => {
  const provider = { kind: "target-named", id: "provider.ImmutableError" };
  for (const carrier of [unknown, rustJsErrorTargetType(), rustSourceErrorTargetType(), rustProgramErrorTargetType(), provider]) {
    assert.equal(rustWritableErrorRecoveryOriginMatches(carrier, projectTypes, [provider]), false);
  }
  const unregistered = { ...projectTypes, definitionForCarrier: () => undefined };
  assert.equal(rustWritableErrorRecoveryOriginMatches(unrelated, unregistered), false);
  for (const carrier of [rustMutableJsErrorTargetType(), rustSourceErrorTargetType(), rustWritableSourceErrorTargetType()]) {
    assert.equal(rustWritableErrorRecoveryOriginMatches({ ...carrier, genericArguments: [
      { kind: "type", type: rustStringTargetType() },
    ] }, projectTypes), false);
  }
});

test("closed recursive origin unions exclude only proven non-Error variants", () => {
  const registry = createRustTypeDefinitionRegistry();
  const mixed = rustSourceUnionTargetType("/source.ts", "Mixed");
  const nested = rustSourceUnionTargetType("/source.ts", "Nested");
  const immutable = rustSourceUnionTargetType("/source.ts", "Immutable");
  const opaque = rustSourceUnionTargetType("/source.ts", "Opaque");
  for (const [carrier, members] of [[mixed, [error, unrelated, rustMutableJsErrorTargetType()]],
    [nested, [mixed, unrelated]], [immutable, [mixed, rustJsErrorTargetType()]], [opaque, [mixed, unknown]]]) {
    assert.equal(registry.registerSourceUnion({ carrier, variants: members.map((member, index) => ({
      name: `Variant${index}`, carrier: member,
    })) }, true), true);
  }
  const types = registry.seal();
  assert.equal(rustWritableErrorRecoveryOriginMatches(mixed, projectTypes, [], types), true);
  assert.equal(rustWritableErrorRecoveryOriginMatches(nested, projectTypes, [], types), true);
  assert.equal(rustWritableErrorRecoveryOriginMatches(immutable, projectTypes, [], types), false);
  assert.equal(rustWritableErrorRecoveryOriginMatches(opaque, projectTypes, [], types), false);
  assert.equal(selectRustProgramErrorConversion(mixed, projectTypes, [], types, rustWritableSourceErrorTargetType()), undefined);
});
