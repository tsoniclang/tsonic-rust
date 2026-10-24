import assert from "node:assert/strict";
import test from "node:test";
import * as optionalStorageEmission from "../../../dist/analysis/project-types/optional-storage-emission.js";
import { createRustSourceTypeFamilyRegistry } from "../../../dist/analysis/project-types/type-families.js";
import { createRustProjectEmissionProducer } from "../../../dist/analysis/program/records/project-emission.js";
import { createRustTypeEmissionProducer } from "../../../dist/analysis/program/records/type-emission.js";
import { analyzeRustProjectEmission } from "../../../dist/analysis/project-types/emission.js";
import { analyzeRustTypeEmission } from "../../../dist/analysis/source-evidence/types/emission.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTypeGenericArguments } from "../../../dist/target-model/types/generic-arguments.js";
import { rustSourcePrimitiveTargetType, rustStringTargetType, substituteRustTargetGenerics } from "../../../dist/target-model/types/index.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";

function selectionFixture(indexes = [0]) {
  const declaration = {};
  const parameters = [{ kind: "type-parameter", identity: "left", name: "Left" },
    { kind: "type-parameter", identity: "right", name: "Right" }];
  const arguments_ = [rustStringTargetType(), rustSourcePrimitiveTargetType("int32")];
  const carrier = rustSourceTypeCarrier("/src/index.ts", "Owner", "object", rustTypeGenericArguments(arguments_));
  const definition = { declaration, genericParameters: parameters.map(parameter => ({
    kind: "type", identity: parameter.identity, name: parameter.name })) };
  const contract = { declaration, uses: [], typeParameters: parameters.map(parameter => ({
    identity: parameter.identity, name: parameter.name, requirements: [] })), capturedTypeParameters: [],
    nativeInputs: [], associatedTypes: [], projectProjections: [], optionalStorage: [
      ...parameters.map(parameter => ({ carrier: rustSourceOptionalTargetType(parameter), captured: false, requirements: [] })),
      { carrier: rustSourceOptionalTargetType(parameters[0]), captured: true, requirements: [] },
    ] };
  let reads = 0;
  let open = true;
  const producer = createRustProjectEmissionProducer(() => assert.equal(open, true, "only the open producer writes"));
  const program = { typeFamilies: createRustSourceTypeFamilyRegistry().seal(),
    declarationGenericRequirements: { contractFor: selected => {
      reads++;
      return selected === declaration ? contract : undefined;
    } },
    projectTypes: { definitionForCarrier: selected => rustSourceTypeCarrierValue(selected)?.typeName === "Owner" ? definition : undefined },
    classValues: { forDeclaration: selected => selected === declaration ? { environment: { genericParameterIndexes: indexes } } : undefined },
  };
  return { declaration, parameters, arguments_, carrier, definition, contract, program, producer,
    reads: () => reads, seal: () => { open = false; } };
}

test("optional storage has separate current call and per-carrier owners, not the removed prewalk API", () => {
  assert.equal(Object.hasOwn(optionalStorageEmission, "analyzeRustOptionalStorageEmission"), false,
    "the incomplete early type prewalk is removed, not retained as an alternate API");
  assert.equal(typeof optionalStorageEmission.analyzeRustOptionalStorageCallEmission, "function");
  assert.equal(typeof optionalStorageEmission.analyzeRustOptionalStorageTypeEmission, "function");
});

test("one exact late carrier publishes its full and selected-index arguments without captured requirements", () => {
  const current = selectionFixture();
  const selected = optionalStorageEmission.analyzeRustOptionalStorageTypeEmission(current.program, current.carrier, current.producer);
  assert.equal(selected.length, 2, "captured storage is not a third native argument");
  assert.equal(current.reads(), 1, "both parameter inventories share one exact declaration contract read");
  for (const [index, argument] of current.arguments_.entries()) {
    assert.equal(rustTargetTypeRefEquals(selected[index], rustSourceOptionalTargetType(argument)), true,
      `native optional argument ${index} is exactly substituted`);
  }
  const subset = current.producer.records.optionalStorageTypeArguments.get(current.carrier, [0]);
  assert.equal(subset?.length, 1, "the class environment retains only its selected generic parameter");
  assert.equal(rustTargetTypeRefEquals(subset[0], selected[0]), true, "the selected argument is a child of the full native inventory");
  assert.equal(current.producer.records.optionalStorageTypeArguments.get(current.carrier, [1]) === undefined, true,
    "an unpublished parameter inventory is not fabricated");
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(subset), true, "published arrays are immutable");
  current.seal();
  assert.equal(current.producer.records.optionalStorageTypeArguments.get(current.carrier) === selected, true,
    "sealed reads return the actual published array");
  assert.equal(current.reads(), 1, "sealed reads do not repeat native selection");
  assert.throws(() => optionalStorageEmission.analyzeRustOptionalStorageTypeEmission(current.program, current.carrier, current.producer),
    /only the open producer writes/u);
});

test("proven non-project carriers and empty selected environments publish explicit empty entries", () => {
  const current = selectionFixture([]);
  const native = rustStringTargetType();
  const empty = optionalStorageEmission.analyzeRustOptionalStorageTypeEmission(current.program, native, current.producer);
  assert.equal(empty.length, 0);
  assert.equal(current.producer.records.optionalStorageTypeArguments.get(native) === empty, true,
    "a known native empty row is present rather than a missing-record fallback");
  assert.equal(current.reads(), 0, "a non-project carrier does not invent a declaration contract");
  optionalStorageEmission.analyzeRustOptionalStorageTypeEmission(current.program, current.carrier, current.producer);
  assert.equal(current.producer.records.optionalStorageTypeArguments.get(current.carrier)?.length, 2);
  assert.equal(current.producer.records.optionalStorageTypeArguments.get(current.carrier, [])?.length, 0,
    "an explicitly empty class environment is distinct from the full parameter set");
  assert.throws(() => optionalStorageEmission.analyzeRustOptionalStorageTypeEmission(current.program, current.carrier, current.producer),
    /one exact owner/u);
});

test("missing contracts, wrong generic kinds, missing arguments and unproved selected indexes are refused", () => {
  const missingContract = selectionFixture();
  assert.throws(() => optionalStorageEmission.analyzeRustOptionalStorageTypeEmission({ ...missingContract.program,
    declarationGenericRequirements: { contractFor: () => undefined } }, missingContract.carrier, missingContract.producer),
  /exact declaration contract/u);
  const wrongKind = selectionFixture();
  const lifetime = rustSourceTypeCarrier("/src/index.ts", "Owner", "object", [
    { kind: "lifetime", lifetime: { kind: "static" } }, { kind: "type", type: wrongKind.arguments_[1] }]);
  assert.throws(() => optionalStorageEmission.analyzeRustOptionalStorageTypeEmission(wrongKind.program, lifetime, wrongKind.producer),
    /exact generic argument kinds/u);
  const missingArgument = selectionFixture();
  const incomplete = rustSourceTypeCarrier("/src/index.ts", "Owner", "object", rustTypeGenericArguments([missingArgument.arguments_[0]]));
  assert.throws(() => optionalStorageEmission.analyzeRustOptionalStorageTypeEmission(missingArgument.program, incomplete, missingArgument.producer),
    /exact generic argument kinds/u);
  const invalidIndex = selectionFixture([2]);
  assert.throws(() => optionalStorageEmission.analyzeRustOptionalStorageTypeEmission(invalidIndex.program, invalidIndex.carrier, invalidIndex.producer),
    /selected source parameter inventory/u);
});

test("early source-call arguments remain independent of late type inventory and are selected once per source call", () => {
  const current = selectionFixture();
  const call = {};
  const program = { ...current.program,
    projectTypes: { definitionForCarrier: () => assert.fail("early calls do not traverse the native type inventory") },
    records: { targetOperation: { get: node => node === call ? { kind: "source-call", target: { form: "callable" },
      targetGenericArguments: rustTypeGenericArguments(current.arguments_) } : undefined },
    selectedCall: { get: node => node === call ? { sourceDeclaration: current.declaration } : undefined } },
  };
  optionalStorageEmission.analyzeRustOptionalStorageCallEmission(program, [call, call], current.producer);
  const selected = current.producer.records.optionalStorageCallArguments.get(call);
  assert.equal(selected?.length, 2, "the full checked call substitution stays early");
  assert.equal(current.reads(), 1, "the shared declaration contract is read once for the source call");
  assert.equal(current.producer.records.optionalStorageTypeArguments.get(current.carrier) === undefined, true,
    "the early call owner no longer performs any incomplete type prewalk");
  for (const [index, argument] of current.arguments_.entries()) assert.equal(
    rustTargetTypeRefEquals(selected[index], rustSourceOptionalTargetType(argument)), true, `early native argument ${index}`);
  const incomplete = selectionFixture();
  const missing = { ...program, records: { ...program.records, targetOperation: {
    get: () => ({ kind: "source-call", target: { form: "callable" }, targetGenericArguments: [] }) } } };
  assert.throws(() => optionalStorageEmission.analyzeRustOptionalStorageCallEmission(missing, [call], incomplete.producer),
    /complete selected native generic arguments/u);
});

for (const surfaces of [[], ["js"]]) {
  test(`the existing complete worklist covers late inherited type arguments on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
export interface Named<T> { value: T; }
export class Box<T> { constructor(public value: T) {} }
export class Child<T> extends Box<T> implements Named<T> {}
export function read(): string { const value: Named<string> = new Child("ready"); return value.value; }
` } });
    const definition = program.projectTypes.definitions.find(candidate => candidate.sourceName === "Child");
    assert.equal(definition !== undefined, true, "the real checked inherited declaration is present");
    const substitutions = new Map(definition.genericParameters.filter(parameter => parameter.kind === "type")
      .map(parameter => [parameter.identity, rustSourcePrimitiveTargetType("int32")]));
    const late = substituteRustTargetGenerics(program.projectTypes.openCarrier(definition), substitutions,
      new Map(), new Map(), program.typeFamilies.normalize);
    const projects = createRustProjectEmissionProducer(() => {});
    analyzeRustProjectEmission({ program, nodes: [], producer: projects });
    const admitted = { ...program, records: { ...program.records, ...projects.records } };
    assert.equal(projects.records.optionalStorageTypeArguments.get(late) === undefined, true,
      "this exact native instantiation is genuinely introduced at the late worklist boundary");
    const emission = createRustTypeEmissionProducer(() => {});
    analyzeRustTypeEmission(admitted, [], emission, [late, late], projects);
    const selected = projects.records.optionalStorageTypeArguments.get(late);
    assert.equal(selected !== undefined, true, "the actual late type has its required optional argument row");
    assert.equal(emission.records.typeEmission.get(late) !== undefined, true, "the same late type has one complete rendering selection");
    for (const child of selected) assert.equal(emission.records.typeEmission.get(child) !== undefined, true,
      "every optional argument is itself covered by the same complete native worklist");
  });

  test(`captured generic classes, rest/default calls and physical contexts retain required optional rows on ${surfaces[0] ?? "native"}`, () => {
    const firstBody = surfaces.length === 0
      ? "for (const item of rest) { return item; } return value;"
      : "return rest.length === 0 ? value : rest[0];";
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
function first<T>(fallback: T, value: T = fallback, ...rest: T[]): T { ${firstBody} }
export function retain<T>(value: T): () => T {
  class Captured { constructor(readonly current: T) {} read(): T { return this.current; } }
  const selected = new Captured(first(value));
  return () => selected.read();
}
` } });
    assert.equal(program.projectTypes.definitions.some(definition => definition.sourceName === "Captured"), true,
      "the fixture actually contains the checked local captured class");
    const carriers = program.physicalEmissionContexts.contexts.flatMap(context => [...context.operands,
      ...context.bindings.types.values(), ...(context.returnDestination.kind === "value" ? [context.returnDestination.carrier] : [])]);
    carriers.push(...program.physicalEmissionContexts.operands.flatMap(operand => [operand.carrier,
      ...(operand.destination === undefined ? [] : [operand.destination])]));
    assert.equal(carriers.length > 0, true, "the actual physical context inventory is nonempty");
    for (const [index, carrier] of carriers.entries()) {
      assert.equal(program.records.optionalStorageTypeArguments.get(carrier) !== undefined, true,
        `physical context carrier ${index} has an explicit selected row, including renamed captures`);
      assert.equal(program.records.typeEmission.get(carrier) !== undefined, true,
        `physical context carrier ${index} has complete native rendering metadata`);
    }
  });
}
