import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { prepareRustProjectGenericMembership } from "../../../dist/analysis/project-types/generic-membership.js";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import * as optionalStorageEmission from "../../../dist/analysis/project-types/optional-storage-emission.js";
import { createRustSourceTypeFamilyRegistry } from "../../../dist/analysis/project-types/type-families.js";
import { createRustProjectEmissionProducer } from "../../../dist/analysis/program/records/program/project-emission.js";
import { createRustTypeEmissionProducer } from "../../../dist/analysis/program/records/types/type-emission.js";
import { analyzeRustProjectEmission } from "../../../dist/analysis/project-types/emission.js";
import { analyzeRustTypeEmission } from "../../../dist/analysis/source-evidence/types/emission.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTypeGenericArguments } from "../../../dist/target-model/types/generic-arguments.js";
import { rustSourcePrimitiveTargetType, rustStringTargetType, substituteRustTargetGenerics } from "../../../dist/target-model/types/index.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { closedMetadataKey } from "../../../dist/target-model/metadata/closed-data.js";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { structuralMemberWritesSource } from "../../../../tsonic/test/fixtures/structural-member-writes.mjs";
import { rustDeclarationEmissionCarriers } from "../../../dist/analysis/source-evidence/types/emission-inventory.js";
import { sealRustAnalysisProgram } from "../../../dist/analysis/program/index.js";
import { createRustPlanningContext } from "../../../dist/backend/planner/context.js";
import { planRustOutput } from "../../../dist/backend/planner/program/index.js";
import { planClassDeclaration } from "../../../dist/backend/planner/declarations/classes/planning.js";

for (const surfaces of [[], ["js"]]) {
  test(`complete late TYPE admission includes selected structural native output carriers on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": structuralMemberWritesSource + "\nmain();\n" } });
    const definition = program.projectTypes.definitions.find(candidate => candidate.sourceName === "Value");
    assert.equal(definition !== undefined, true, "the real checked class owns the writable callable field");
    const emission = program.records.nativeClass.get(definition.declaration);
    assert.equal(emission !== undefined, true, "the class has its actual native output producer");
    let nativeFields = 0;
    for (const field of emission.fields) {
      nativeFields++;
      const key = closedMetadataKey(field.carrier);
      assert.equal(program.records.typeEmission.get(field.carrier)?.positions !== undefined, true,
        `native class field ${field.sourceName} has sealed position evidence; key=${key}`);
      assert.equal(program.records.optionalStorageTypeArguments.get(field.carrier) !== undefined, true,
        `native class field ${field.sourceName} has its explicit optional argument row; key=${key}`);
    }
    assert.equal(nativeFields > 0, true, "the positive checks actual emitted native class field storage");
    const nodes = [definition.declaration];
    const collected = new Set(rustDeclarationEmissionCarriers(program, nodes).map(carrier => closedMetadataKey(carrier)));
    for (const field of emission.fields) assert.equal(collected.has(closedMetadataKey(field.carrier)), true,
      `the canonical output inventory includes the actual selected native field ${field.sourceName}`);
    const rejected = { ...program, records: { ...program.records,
      nativeClass: Object.freeze({ get: () => undefined }) } };
    assert.throws(() => planClassDeclaration(definition.declaration, { input: { program: rejected } }),
      failure => failure?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
        failure.diagnostic.sourceNode === definition.declaration && failure.diagnostic.message ===
          "An admitted ordinary class requires its sealed native declaration plan.",
      "a missing native class producer is refused by its existing output owner before any field can be rendered");
    const sealed = sealRustAnalysisProgram(program);
    const records = { ...sealed.records, typeEmission: Object.freeze({ get(carrier) {
      const selected = sealed.records.typeEmission.get(carrier);
      assert.equal(selected?.positions !== undefined, true,
        `every actual native output rendering input has sealed TYPE positions; key=${closedMetadataKey(carrier)}`);
      return selected;
    } }) };
    const planned = planRustOutput(createRustPlanningContext({ ...sealed, records }));
    assert.equal(planned.kind, "resolved", "the complete actual native output consumes only pre-seal TYPE evidence");
  });
}

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
export class Box<T> { value: T; constructor(value: T) { this.value = value; } }
export class Middle<T> extends Box<T> {}
export class Child<T> extends Middle<T> implements Named<T> {}
export function read(): string { const value: Named<string> = new Child("ready"); return value.value; }
` } });
    const definition = program.projectTypes.definitions.find(candidate => candidate.sourceName === "Child");
    assert.equal(definition !== undefined, true, "the real checked inherited declaration is present");
    const substitutions = new Map(definition.genericParameters.filter(parameter => parameter.kind === "type")
      .map(parameter => [parameter.identity, rustSourcePrimitiveTargetType("int32")]));
    const late = substituteRustTargetGenerics(program.projectTypes.openCarrier(definition), substitutions,
      new Map(), new Map(), program.typeFamilies.normalize);
    let open = true;
    const projects = createRustProjectEmissionProducer(() => assert.equal(open, true, "only the open late producer writes"));
    analyzeRustProjectEmission({ program, nodes: [], producer: projects,
      memberships: prepareRustProjectGenericMembership(program.declarationGenericRequirements) });
    const admitted = { ...program, records: { ...program.records, ...projects.records } };
    assert.equal(projects.records.optionalStorageTypeArguments.get(late) === undefined, true,
      "this exact native instantiation is genuinely introduced at the late worklist boundary");
    assert.equal(projects.records.checkedProjectProjection.get(late) === undefined, true,
      "the earlier declaration owner does not publish partial closed projection eligibility");
    assert.equal(projects.records.checkedProjectProjection.get(program.projectTypes.openCarrier(definition)) === undefined, true,
      "the earlier declaration owner is not a second projection publisher even for its open root");
    const emission = createRustTypeEmissionProducer(() => {});
    const writes = new Map();
    const projectionWrites = new Map();
    const producer = {
      optionalType: (carrier, indexes, arguments_) => {
        const key = closedMetadataKey([carrier, indexes ?? null]);
        writes.set(key, (writes.get(key) ?? 0) + 1);
        projects.optionalType(carrier, indexes, arguments_);
      },
      checkedProjection: (carrier, projection) => {
        const key = closedMetadataKey(carrier);
        projectionWrites.set(key, (projectionWrites.get(key) ?? 0) + 1);
        projects.checkedProjection(carrier, projection);
      },
      union: (carrier, definition) => projects.union(carrier, definition),
    };
    analyzeRustTypeEmission(admitted, [], emission, [late, late], producer);
    assert.equal(writes.get(closedMetadataKey([late, null])), 1, "duplicate late seeds publish their full row once");
    assert.equal([...writes.values()].every(count => count === 1), true,
      "shared native children retain one writer for every exact full or indexed key");
    assert.equal(projectionWrites.get(closedMetadataKey(late)), 1,
      "duplicate late seeds publish their actual native projection eligibility once");
    assert.equal([...projectionWrites.values()].every(count => count === 1), true,
      "shared inherited contracts retain one exact checked projection writer");
    const projection = projects.records.checkedProjectProjection.get(late);
    assert.equal(projection?.kind, "project", "the exact late native root retains its actual policy eligibility");
    assert.equal(Object.isFrozen(projection), true, "the published eligibility is immutable");
    assert.equal(projects.records.checkedProjectProjection.get(rustStringTargetType()) === undefined, true,
      "a non-project native carrier never acquires fabricated eligibility");
    const selected = projects.records.optionalStorageTypeArguments.get(late);
    assert.equal(selected !== undefined, true, "the actual late type has its required optional argument row");
    assert.equal(emission.records.typeEmission.get(late) !== undefined, true, "the same late type has one complete rendering selection");
    for (const child of selected) assert.equal(emission.records.typeEmission.get(child) !== undefined, true,
      "every optional argument is itself covered by the same complete native worklist");
    const pending = [late];
    const visited = new Set();
    for (let index = 0; index < pending.length; index++) {
      const carrier = pending[index];
      const current = program.projectTypes.definitionForCarrier(carrier);
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      const parents = program.projectTypes.directSupertypes(carrier);
      assert.equal(parents !== undefined, true, `${current.sourceName} has an actual checked parent inventory`);
      for (const parent of parents) {
        const parentDefinition = program.projectTypes.definitionForCarrier(parent);
        assert.equal(parentDefinition !== undefined, true, "each inherited carrier belongs to its actual checked declaration");
        const row = projects.records.optionalStorageTypeArguments.get(parent);
        assert.equal(row !== undefined, true, `${parentDefinition.sourceName} has its exact late optional row`);
        assert.equal(projects.records.checkedProjectProjection.get(parent)?.kind, "project",
          `${parentDefinition.sourceName} has its actual closed inherited projection eligibility`);
        assert.equal(projectionWrites.get(closedMetadataKey(parent)), 1,
          `${parentDefinition.sourceName} is published once despite its shared native inheritance paths`);
        assert.equal(emission.records.typeEmission.get(parent) !== undefined, true,
          `${parentDefinition.sourceName} has complete native output metadata`);
        for (const child of row) assert.equal(emission.records.typeEmission.get(child) !== undefined, true,
          `${parentDefinition.sourceName} optional arguments remain dependencies of the same worklist`);
        pending.push(parent);
      }
    }
    assert.equal(visited.size, 4, "the late seed reaches both transitive native state layers and its interface");
    assert.throws(() => projects.checkedProjection(late, projection), /one exact carrier owner/u,
      "a second actual projection publication is rejected");
    open = false;
    assert.equal(projects.records.checkedProjectProjection.get(late) === projection, true,
      "sealed reads retain the same exact published policy decision");
    assert.throws(() => projects.checkedProjection(late, projection), /only the open late producer writes/u,
      "no projection decision can be written after sealing");
  });

  test(`closed native state and selected structural output dependencies are admitted on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const source = `
interface View<Value> { value: Value; }
class Box<Value> {
  value: Value;
  read = (): Value => this.value;
  constructor(value: Value) { this.value = value; }
}
function inspect<Value>(view: Readonly<View<Value>>): Value { return view.value; }
function change<Value>(view: View<Value>, next: Value): void { view.value = next; }
export function run(): string {
  const value = new Box("before");
  change(value, "after");
  return inspect(value);
}
`;
    const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
    const admitted = (carrier, label, position = "general") => {
      assert.equal(program.records.optionalStorageTypeArguments.get(carrier) !== undefined, true,
        `${label}: the actual native output carrier has its explicit optional row`);
      assert.equal(program.records.typeEmission.get(carrier) !== undefined, true,
        `${label}: the actual native output carrier has its completed type record`);
      assert.equal(program.records.typeEmission.get(carrier).positions[position], true,
        `${label}: the native output is admitted in its exact ${position} position`);
    };
    const ast = program.source.ast;
    const statements = program.sourceFiles.flatMap(file => ast.statements(file));
    const declaration = name => statements.find(node => ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
    const box = program.records.projectDeclaration.get(declaration("Box"));
    const view = program.records.projectDeclaration.get(declaration("View"));
    assert.equal(box?.kind === "class" && view?.kind === "interface", true, "the exact authored native owners exist");
    assert.equal(program.records.nativeClass.get(box.declaration) !== undefined, true, "the original class has native output");
    assert.equal(program.records.projectPolymorphicEmission.get(view.declaration)?.definition === view, true,
      "the original interface has its exact native output");
    const inspect = declaration("inspect");
    const run = declaration("run");
    const abi = program.records.sourceParameterAbi.get(ast.parameters(inspect)[0]);
    assert.equal(program.records.projectType.get(abi?.valueCarrier) === view, true,
      "the readonly parameter retains the actual named View owner");
    admitted(abi.valueCarrier, "inspect value", "parameter");
    admitted(abi.parameterCarrier, "inspect physical ABI", "parameter");
    const created = [];
    const calls = [];
    const visit = node => {
      if (ast.is.IsNewExpression(node)) created.push(node);
      if (ast.is.IsCallExpression(node)) calls.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(run);
    assert.equal(created.length, 1, "the original run constructs one concrete Box");
    const closedBox = program.records.runtimeCarrier.get(created[0])?.carrier;
    assert.equal(program.records.projectType.get(closedBox) === box, true, "the constructed carrier is the actual Box owner");
    const openBox = program.projectTypes.openCarrier(box);
    for (const [carrier, label] of [[openBox, "open Box"], [closedBox, "closed Box"]]) {
      admitted(carrier, label);
      const related = program.records.projectRelationship.get(carrier, view);
      assert.equal(related !== undefined && program.records.projectType.get(related) === view, true,
        `${label}: the exact native View relationship exists`);
      admitted(related, `${label} View`);
      const sourceArguments = rustSourceTypeCarrierValue(carrier)?.genericArguments;
      const targetArguments = rustSourceTypeCarrierValue(related)?.genericArguments;
      assert.equal(sourceArguments?.length === 1 && targetArguments?.length === 1 &&
        sourceArguments[0].kind === "type" && targetArguments[0].kind === "type", true,
      `${label}: both real owners retain their explicit instantiated type argument`);
      assert.equal(rustTargetTypeRefEquals(sourceArguments[0].type, targetArguments[0].type), true,
        `${label}: the relationship preserves the actual open or closed generic binding`);
      admitted(targetArguments[0].type, `${label} View argument`);
      const contracts = program.records.projectInstanceContracts.get(carrier)?.filter(entry => entry.definition === view);
      assert.equal(contracts?.length, 1, `${label}: one actual View contract is published`);
      assert.equal(rustTargetTypeRefEquals(contracts[0].carrier, related), true, `${label}: the actual contract uses the relationship carrier`);
      const fields = program.records.projectClassFields.get(view, related);
      assert.equal(fields?.length, 1, `${label}: the contract has its real nonempty field inventory`);
      for (const field of fields) admitted(field.carrier, `${label} View field`);
      const roots = program.records.projectRootEmission.get(carrier)?.contracts.filter(entry => entry.definition === view);
      assert.equal(roots?.length, 1, `${label}: one actual View output selection is published`);
      assert.equal(roots[0].fields.has(fields[0].declaration), true, `${label}: the selected native root implements the exact field`);
    }
    assert.equal(calls.length, 2, "the unchanged run exercises both mutation and generic inspection");
    for (const [index, call] of calls.entries()) {
      const selected = program.records.selectedOperation.get(call);
      const result = program.records.runtimeCarrier.get(call)?.carrier;
      assert.equal(selected?.resultType !== undefined && result !== undefined, true,
        `call ${index}: both selected and runtime results exist`);
      admitted(selected.resultType, `call ${index} selected result`);
      admitted(result, `call ${index} runtime result`);
      const projection = program.records.valueProjection.get(call);
      assert.equal(projection !== undefined, true, `call ${index}: its actual output-context selection exists`);
      if (projection.contextual !== undefined) {
        admitted(projection.contextual.sourceCarrier, `call ${index} contextual source`);
        admitted(projection.contextual.targetCarrier, `call ${index} contextual target`);
      }
    }
    const outputCarrier = program.records.sourceCallableReturn.get(run)?.returnCarrier;
    assert.equal(outputCarrier !== undefined && rustTargetTypeRefEquals(outputCarrier, rustStringTargetType()), true,
      "the original exported run returns its native String carrier");
    admitted(outputCarrier, "run native output", "return");
    let layers = 0;
    for (const definition of program.projectTypes.definitions) {
      const carrier = program.projectTypes.openCarrier(definition);
      for (const layer of program.records.projectClassState.get(definition, carrier) ?? []) {
        layers++;
        admitted(layer.carrier, "state layer");
        for (const field of layer.fields) admitted(field.carrier, "stored state field");
        for (const property of layer.methodProperties) admitted(property.ownerCarrier, "state method owner");
      }
      const dispatch = program.records.projectDispatchEmission.get(definition);
      if (dispatch === undefined) continue;
      for (const parent of dispatch.projectSupers) admitted(parent, "native dispatch parent");
      for (const parent of dispatch.structuralSupers) {
        admitted(parent.carrier, "native structural dispatch parent");
        for (const argument of parent.genericArguments) if (argument.kind === "type") admitted(argument.type, "native dispatch argument");
      }
    }
    assert.equal(layers > 0, true, "the actual class layout publishes native state layers");
    assert.equal(program.records.projectRootEmission.get(openBox).contracts.some(entry => entry.definition === view), true,
      "the named View has a nonempty actual native output selection, not an invented anonymous shape");
    for (const shape of program.structuralShapes.instances) {
      const selected = program.records.typeEmission.get(shape.carrier)?.structural;
      assert.equal(selected !== undefined, true, "each actual structural instance retains its native output selection");
      assert.equal(program.records.checkedProjectProjection.get(shape.carrier)?.kind,
        shape.dispatchName === undefined ? undefined : "structural",
        "only an actual dispatch-bearing structural shape has native projection eligibility");
      for (const argument of selected.arguments) if (argument.kind === "type") admitted(argument.type, "selected state argument");
      if (selected.context !== undefined) admitted(selected.context, "selected structural context");
    }
    const { result } = compileRust({ surfaces, files: { "index.ts": source } });
    assert.equal(result.diagnostics.length, 0, "the unchanged run source compiles before native execution");
    const project = writeGeneratedProject(`readonly-output-dependencies-${surfaces[0] ?? "native"}`, result.artifacts);
    runCargo(project, ["generate-lockfile", "--offline"]);
    runCargo(project, ["fmt", "--check"]);
    const initialize = artifactText(result, "src/lib.rs").includes("pub fn initialize()") ? "crate::initialize();" : "";
    const invocation = program.records.fallible.get(run) === undefined ? "run()" : "run().unwrap()";
    appendFileSync(`${project}/src/index.rs`, `\n#[test]\nfn original_readonly_live_view() { ${initialize} assert_eq!(${invocation}, "after"); }\n`);
    runCargo(project, ["fmt"]);
    runCargo(project, ["fmt", "--check"]);
    runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(project, ["test", "--locked", "--offline", "--", "--test-threads=1"]);
  });

  test(`native lifetime exclusions remain explicit checked projection decisions on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export interface Base<Region extends Life> { value: Ref<int32, Region>; }
export interface Extended<Region extends Life> extends Base<Region> { extra: int32; }
export function read<Region extends Life>(value: Extended<Region>): int32 { return load(value.value); }
` } });
    const definitions = program.projectTypes.definitions.filter(definition =>
      definition.sourceName === "Base" || definition.sourceName === "Extended");
    assert.equal(definitions.length, 2, "both actual checked lifetime-bearing declarations are retained");
    for (const definition of definitions) {
      assert.equal(definition.genericParameters.some(parameter => parameter.kind === "lifetime"), true,
        `${definition.sourceName} has its real native lifetime parameter`);
      const carrier = program.projectTypes.openCarrier(definition);
      const projection = program.records.checkedProjectProjection.get(carrier);
      assert.equal(projection?.kind, "excluded",
        `${definition.sourceName} remains explicitly excluded by the unchanged native lifetime rule`);
      assert.equal(Object.isFrozen(projection), true, "exclusion is a real sealed policy record, not a missing-row fallback");
      assert.equal(program.records.typeEmission.get(carrier) !== undefined, true,
        "native lifetime exclusion does not remove the carrier's actual TYPE metadata");
    }
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
    const ast = program.source.ast;
    const captured = program.projectTypes.definitions.filter(definition =>
      ast.is.IsClassDeclaration(definition.declaration) && ast.text(ast.name(definition.declaration)) === "Captured");
    assert.equal(captured.length, 1,
      "the fixture actually contains the checked local captured class");
    const owner = sourceEnclosingCallable(ast.parent(captured[0].declaration), ast);
    assert.equal(owner !== undefined && ast.text(ast.name(owner)) === "retain", true,
      "the checked captured declaration belongs to the intended generic callable");
    assert.equal(program.projectTypes.definitionForDeclaration(captured[0].declaration) === captured[0], true,
      "the asserted class retains its exact declaration identity rather than matching a rendered name");
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
