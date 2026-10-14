import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = join(root, ".temp/call-storage-types");
const prelude = `
import { createRustProgramRecordBuilder } from "${join(root, "dist/analysis/program/records/create.js")}";
import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "${join(root, "dist/target-model/types/model.js")}";
import type { RustLifetimeRef } from "${join(root, "dist/target-model/lifetimes/index.js")}";
declare const node: Node;
declare const carrier: TargetTypeRef;
declare const lifetimes: ReadonlyMap<string, RustLifetimeRef>;
const builder = createRustProgramRecordBuilder();
`;

function check(directory, body) {
  writeFileSync(join(directory, "case.ts"), prelude + body);
  const result = spawnSync(resolve(root, "../tsonic/node_modules/.bin/tsgo"),
    ["-p", join(directory, "tsconfig.json"), "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024,
    });
  assert.equal(result.error === undefined, true, "strict proof finishes without signal or truncated diagnostics");
  return { status: result.status, diagnostics: result.stdout + result.stderr };
}

test("call/storage APIs require exact domain inputs and reject all five old writers and keys", () => {
  mkdirSync(temporary, { recursive: true });
  const directory = mkdtempSync(join(temporary, "case-"));
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
    extends: join(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { noEmit: true, rootDir: root, noUnusedLocals: false, noUnusedParameters: false },
    include: [], exclude: [], files: [join(directory, "case.ts")],
  }));
  const positive = check(directory, `
builder.argumentPassingPlans.pass(node, "by-value");
builder.argumentPassingPlans.pass(node, "borrow-shared");
builder.argumentPassingPlans.pass(node, "borrow-mut");
builder.typedLocations.finalize(node, carrier, carrier, { operation: "address-of", storageExpression: node,
  storageDeclaration: node, rootExpression: node, rootDeclaration: node, locationIdentity: node });
builder.typedLocations.finalize(node, carrier, carrier, { operation: "allocate", initialExpression: node, locationIdentity: node });
builder.typedLocations.finalize(node, carrier, carrier, { operation: "load", pointerExpression: node });
builder.typedLocations.finalize(node, carrier, carrier, { operation: "store", pointerExpression: node, valueExpression: node });
builder.typedLocations.finalize(node, carrier, carrier, { operation: "equal-pointer", leftExpression: node, rightExpression: node });
builder.typedLocations.finalize(node, carrier, carrier, { operation: "hash-pointer", pointerExpression: node });
builder.typedLocations.finalize(node, carrier, carrier, { operation: "bind-pointer", identityExpression: node, readExpression: node, writeExpression: node });
builder.typedLocations.finalize(node, carrier, carrier, { operation: "view-pointer", pointerExpression: node,
  sourcePointeeCarrier: carrier, optional: true, readExpression: node, writeExpression: node });
builder.typedLocations.finalize(node, carrier, carrier, { operation: "project-pointer", pointerExpression: node,
  sourcePointeeCarrier: carrier, optional: false, fromSourceExpression: node, toSourceExpression: node });
builder.bindingStoragePlans.capture(node, carrier, { storage: "value" });
builder.bindingStoragePlans.capture(node, carrier, { storage: "cell", mutable: true });
builder.bindingStoragePlans.capture(node, carrier, { storage: "borrow-cell" });
builder.bindingStoragePlans.capture(node, carrier, { storage: "location", initialization: "deferred", iterationScope: node });
builder.bindingStoragePlans.location(node, carrier);
builder.retainedCalls.finalize(node, lifetimes);
builder.bindingProjections.resolve(node, carrier, carrier, { kind: "tuple-element", index: 0 });
builder.bindingProjections.resolve(node, carrier, carrier, { kind: "vec-element", index: 1, checked: true }, carrier, carrier);
builder.bindingProjections.resolve(node, carrier, carrier, { kind: "object-field", storage: "project-object", storageIndex: 2,
  accessor: { getter: true, setter: false } });
builder.argumentPassing.get(node);
builder.typedLocationPlan.get(node);
builder.bindingStorage.get(node);
builder.retainedCallLifetimes.get(node);
builder.bindingProjection.get(node);
import { rustConversionKey } from "${join(root, "dist/analysis/program/records/keys/selections.js")}";
`);
  assert.equal(positive.status, 0, positive.diagnostics.slice(0, 2048));
  const invalid = [
    ["argument old writer", "builder.argumentPassing.set(node, { mode: 'by-value' });", /Property 'set' does not exist/u],
    ["location old writer", "builder.typedLocationPlan.set(node, {});", /Property 'set' does not exist/u],
    ["storage old writer", "builder.bindingStorage.set(node, {});", /Property 'set' does not exist/u],
    ["lifetimes old writer", "builder.retainedCallLifetimes.set(node, []);", /Property 'set' does not exist/u],
    ["projection old writer", "builder.bindingProjection.set(node, {});", /Property 'set' does not exist/u],
    ["argument old key", `import { rustArgumentPassingKey } from "${join(root, "dist/analysis/program/records/keys/selections.js")}";`, /no exported member named 'rustArgumentPassingKey'|no exported member 'rustArgumentPassingKey'/u],
    ["location old key", `import { rustTypedLocationPlanKey } from "${join(root, "dist/analysis/program/records/keys/operation-selections.js")}";`, /no exported member named 'rustTypedLocationPlanKey'|no exported member 'rustTypedLocationPlanKey'/u],
    ["storage old key", `import { rustBindingStorageFactKey } from "${join(root, "dist/analysis/program/records/keys/operation-selections.js")}";`, /no exported member named 'rustBindingStorageFactKey'|no exported member 'rustBindingStorageFactKey'/u],
    ["lifetimes old key", `import { rustRetainedCallLifetimesFactKey } from "${join(root, "dist/analysis/program/records/keys/retained-environments.js")}";`, /Cannot find module.*\/keys\/retained-environments\.js/u],
    ["projection old key", `import { rustBindingProjectionFactKey } from "${join(root, "dist/analysis/program/records/keys/value-projections.js")}";`, /no exported member named 'rustBindingProjectionFactKey'|no exported member 'rustBindingProjectionFactKey'/u],
    ["argument subject", "builder.argumentPassingPlans.pass({}, 'by-value');", /missing.*properties.*Node/u],
    ["argument invalid mode", "builder.argumentPassingPlans.pass(node, 'move');", /not assignable/u],
    ["argument old record", "builder.argumentPassingPlans.pass(node, { mode: 'by-value' });", /not assignable/u],
    ["argument foreign storage", "builder.argumentPassingPlans.pass(node, 'borrow-shared', node);", /Expected 2 arguments/u],
    ["location subject", "builder.typedLocations.finalize({}, carrier, carrier, { operation: 'load', pointerExpression: node });", /missing.*properties.*Node/u],
    ["location carrier", "builder.typedLocations.finalize(node, {}, carrier, { operation: 'load', pointerExpression: node });", /not assignable/u],
    ["location missing operand", "builder.typedLocations.finalize(node, carrier, carrier, { operation: 'load' });", /missing/u],
    ["location mismatched operands", "builder.typedLocations.finalize(node, carrier, carrier, { operation: 'store', pointerExpression: node });", /missing/u],
    ["location forged call", "builder.typedLocations.finalize(node, carrier, carrier, { operation: 'load', pointerExpression: node, call: node });", /does not exist/u],
    ["location missing source carrier", "builder.typedLocations.finalize(node, carrier, carrier, { operation: 'project-pointer', pointerExpression: node, optional: false, fromSourceExpression: node, toSourceExpression: node });", /missing/u],
    ["storage subject", "builder.bindingStoragePlans.location({}, carrier);", /missing.*properties.*Node/u],
    ["storage invalid mode", "builder.bindingStoragePlans.capture(node, carrier, { storage: 'shared' });", /not assignable/u],
    ["storage missing selection", "builder.bindingStoragePlans.capture(node, carrier, {});", /missing/u],
    ["storage invalid initialization", "builder.bindingStoragePlans.capture(node, carrier, { storage: 'location', initialization: 'ready' });", /not assignable/u],
    ["storage foreign scope", "builder.bindingStoragePlans.capture(node, carrier, { storage: 'location', iterationScope: {} });", /missing.*properties.*Node/u],
    ["lifetimes subject", "builder.retainedCalls.finalize({}, lifetimes);", /missing.*properties.*Node/u],
    ["lifetimes old array", "builder.retainedCalls.finalize(node, []);", /missing.*properties.*ReadonlyMap/u],
    ["lifetimes invalid value", "builder.retainedCalls.finalize(node, new Map([['region', { kind: 'unknown' }]]));", /not assignable/u],
    ["projection subject", "builder.bindingProjections.resolve({}, carrier, carrier, { kind: 'tuple-element', index: 0 });", /missing.*properties.*Node/u],
    ["projection invalid field", "builder.bindingProjections.resolve(node, carrier, carrier, { kind: 'object-field', storageIndex: 0 });", /missing/u],
    ["projection foreign kind", "builder.bindingProjections.resolve(node, carrier, carrier, { kind: 'map-element', index: 0 });", /not assignable/u],
    ["projection invalid default", "builder.bindingProjections.resolve(node, carrier, carrier, { kind: 'tuple-element', index: 0 }, {});", /not assignable/u],
    ["producer not on sealed output", "builder.seal().argumentPassingPlans.pass(node, 'by-value');", /does not exist/u],
  ];
  for (const [name, body, diagnostic] of invalid) {
    const result = check(directory, body);
    assert.notEqual(result.status, 0, name);
    assert.match(result.diagnostics, diagnostic, name);
  }
  assert.equal(invalid.length, 33);
});
