import assert from "node:assert/strict";
import test from "node:test";
import { rustWritableErrorRecoveryOriginMatches, selectRustProgramErrorConversion } from "../../../dist/target-model/conversions/program-error.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustSourceTypeCarrier, rustStringTargetType, rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";
import { rustMutableJsErrorTargetType, rustSourceErrorTargetType, rustWritableSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

const error = rustSourceTypeCarrier("/source.ts", "Failure", "object");
const unrelated = rustSourceTypeCarrier("/source.ts", "Unrelated", "object");
const unknown = rustSourceTypeCarrier("/unknown.ts", "Error", "object");
const provider = { kind: "target-named", id: "provider.ImmutableError" };

function registerOrigins(registry) {
  assert.equal(registry.registerProgramErrorOrigin(error, { kind: "project", variant: "Failure", sourceError: true }), true);
  assert.equal(registry.registerProgramErrorOrigin(unrelated, { kind: "project", variant: "Unrelated", sourceError: false }), true);
  assert.equal(registry.registerProgramErrorOrigin(provider, { kind: "provider" }), true);
}

test("exact writable Error origins remain admitted and sealed non-Error origins are excluded by the guard", () => {
  const registry = createRustTypeDefinitionRegistry();
  registerOrigins(registry);
  const types = registry.seal();
  for (const carrier of [error, unrelated, rustMutableJsErrorTargetType(), rustWritableSourceErrorTargetType()]) {
    assert.equal(rustWritableErrorRecoveryOriginMatches(carrier, types), true);
  }
  assert.equal(selectRustProgramErrorConversion(unrelated, rustWritableSourceErrorTargetType(), types), undefined);
  assert.equal(selectRustProgramErrorConversion(unrelated, rustSourceErrorTargetType(), types), undefined);
});

test("opaque and immutable admitted Error origins retain the strict physical writable proof", () => {
  const registry = createRustTypeDefinitionRegistry();
  registerOrigins(registry);
  const types = registry.seal();
  for (const carrier of [unknown, rustJsErrorTargetType(), rustSourceErrorTargetType(), rustProgramErrorTargetType(), provider]) {
    assert.equal(rustWritableErrorRecoveryOriginMatches(carrier, types), false);
  }
  assert.equal(rustWritableErrorRecoveryOriginMatches(unrelated, emptyRustTypeDefinitions), false);
  for (const carrier of [rustMutableJsErrorTargetType(), rustSourceErrorTargetType(), rustWritableSourceErrorTargetType()]) {
    assert.equal(rustWritableErrorRecoveryOriginMatches({ ...carrier, genericArguments: [
      { kind: "type", type: rustStringTargetType() },
    ] }, types), false);
  }
});

test("closed recursive origin unions exclude only proven non-Error variants", () => {
  const registry = createRustTypeDefinitionRegistry();
  registerOrigins(registry);
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
  assert.equal(rustWritableErrorRecoveryOriginMatches(mixed, types), true);
  assert.equal(rustWritableErrorRecoveryOriginMatches(nested, types), true);
  assert.equal(rustWritableErrorRecoveryOriginMatches(immutable, types), false);
  assert.equal(rustWritableErrorRecoveryOriginMatches(opaque, types), false);
  assert.equal(selectRustProgramErrorConversion(mixed, rustWritableSourceErrorTargetType(), types), undefined);
});
