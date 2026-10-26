import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { selectRustStructuralMethodExposure } from "../../../dist/policy/types/objects/structural-emission.js";
import { rustFixedStructuralMethodDeclarations } from "../../../dist/analysis/callables/generic-values.js";
import { selectRustStructuralFactoryReceiver } from "../../../dist/policy/ownership/retained-storage.js";
import { isRustCopyCarrier, rustCarrierSupportsClone, rustCarrierSupportsTrait } from "../../../dist/policy/constraints/native-traits.js";
import { rustStructuralObjectTargetType, rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { bindRustStructuralReceiverParameters } from "../../../dist/analysis/declarations/structural-receiver-requirements.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";

test("native structural handle Clone requires no state or context Clone bound", () => {
  const parameter = { kind: "type-parameter", identity: "native-context", name: "Context" };
  const fields = [{ sourceName: "state", type: parameter, presence: "required", readonly: true }];
  const reference = rustStructuralObjectTargetType("/source.ts", fields, "reference");
  const value = rustStructuralObjectTargetType("/source.ts", fields, "value");
  let obligations = 0;
  assert.equal(rustCarrierSupportsTrait(reference, "core::clone::Clone", () => {
    obligations++;
    return false;
  }), true, "the selected ObjectHandle Clone implementation has no state or context bounds");
  assert.equal(obligations, 0, "cloning the native shared handle does not demand Context: Clone");
  assert.equal(rustCarrierSupportsClone(reference), true, "the native reference carrier clones its existing handle");
  assert.equal(isRustCopyCarrier(reference), false, "a native shared handle is not Copy");
  assert.equal(rustCarrierSupportsClone(value), false, "a value representation still needs its real field Clone contract");
  assert.equal(rustCarrierSupportsTrait(value, "core::clone::Clone", () => true), true,
    "a value representation uses an actually supplied generic Clone obligation");
  assert.equal(rustCarrierSupportsClone({ kind: "opaque", id: "unknown-state" }), false,
    "an opaque unknown carrier does not inherit a structural handle contract");
});

for (const surfaces of [[], ["js"]]) test(`own-literal method write admission does not inherit a helper formal (${surfaces[0] ?? "native"})`, () => {
  let context;
  compileRust({ surfaces, files: { "index.ts": `
function id<Value>(value: Value): Value { return value; }
export function run(): number {
  const local = id({ value(): number { return 1; } });
  local.value = () => 2;
  return local.value();
}
` }, compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.equal(context !== undefined, true, "the actual source owner is analyzed before native materialization");
  const { ast, sourceStorage, source, records } = context;
  const target = sourceStorage.nodes.find(node => ast.is.IsPropertyAccessExpression(node) &&
    source.semantics.forNode(node).operations.propertyAccess(node)?.accessMode === "write");
  assert.equal(target !== undefined, true, "the counterdomain retains its original checked write target");
  const checked = source.semantics.forNode(target).operations.propertyAccess(target);
  assert.equal(checked?.selectedDeclaration !== undefined && ast.is.IsMethodDeclaration(checked.selectedDeclaration), true,
    "the selected member is the actual own literal body, not a shared formal signature");
  const receiver = sourceStorage.subjectFor(checked.receiver.expression);
  assert.equal(receiver.kind, "resolved", "the exact receiver has checked source provenance");
  const ancestry = sourceStorage.ancestorsFor(receiver.subject);
  const helper = sourceStorage.nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "id");
  const parameter = helper === undefined ? undefined : ast.parameters(helper)[0];
  assert.equal(ancestry.kind === "resolved" && ancestry.subjects.some(subject =>
    subject.kind === "input" && subject.node === parameter), true,
    "unscoped ancestry really contains the unrelated helper input and cannot prove receiver scope");
  const selected = records.targetOperation.get(target);
  assert.equal(selected?.kind === "source-field" && selected.accessMode === "write" && selected.valueSemantics.kind === "method", true,
    "the owning source admission preserves the original concrete method write route");
  assert.equal(records.selectedOperation.get(target)?.provenance?.sourceSelectedDeclaration === checked.selectedDeclaration, true,
    "native selection retains the identical checked own-literal member");
  assert.equal(context.diagnostics.some(diagnostic => diagnostic.code === "RUST_STRUCTURAL_METHOD_WRITE_UNSUPPORTED" ||
    diagnostic.code === "RUST_STRUCTURAL_METHOD_WRITE_PROVENANCE_MISSING"), false,
    "a helper's formal never relabels an own-literal receiver as the shared-formal v1 cut");
});

test("fixed native methods require complete readonly, required and exact body evidence", () => {
  const selected = { writes: "none", boundary: "none", extracted: false, implementations: 1, presence: "required" };
  assert.equal(selectRustStructuralMethodExposure(selected), "fixed", "one required native body has no stored callable");
  assert.equal(selectRustStructuralMethodExposure({ ...selected, boundary: "export-only" }), "fixed",
    "an export alone does not manufacture a retained callable or mutable method");
  for (const [name, change] of [
    ["written", { writes: "present" }], ["unknown writes", { writes: "unresolved" }],
    ["opaque boundary", { boundary: "opaque" }], ["extracted identity", { extracted: true }],
    ["missing body", { implementations: 0 }], ["distinct bodies", { implementations: 2 }],
    ["optional presence", { presence: "optional" }],
  ]) assert.equal(selectRustStructuralMethodExposure({ ...selected, ...change }), "stored", name);
});

for (const surfaces of [[], ["js"]]) test(`generic literal method views retain their original construction and captures (${surfaces[0] ?? "native"})`, () => {
  let context;
  const { result } = compileRust({ surfaces, files: { "index.ts": `
    function make<Value>(value: Value): { read(): Value } {
      return { read(): Value { return value; } };
    }
    async function keep<Actual>(api: { read(): Actual }, pending: Promise<void>): Promise<Actual> {
      await pending;
      return api.read();
    }
    export async function run(): Promise<number> {
      const original = make(7);
      const alias = original;
      return await keep(alias, Promise.resolve(undefined));
    }
  ` }, compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.equal(result.diagnostics.length, 0, "the original checked factory reaches completed native construction selection");
  const { ast } = context;
  const method = context.nativeNodes.find(node => ast.is.IsMethodDeclaration(node) && ast.body(node) !== undefined &&
    ast.text(ast.name(node)) === "read");
  assert.equal(method !== undefined, true, "the original method has its checked body identity");
  const object = ast.parent(method);
  const constructions = context.structuralShapes.completed.definitions.flatMap(definition => definition.fields.flatMap(field =>
    (field.methodPlan?.constructions ?? []).filter(construction => construction.expression === method)));
  assert.equal(constructions.length > 0, true, "the admitted view keeps the genuine original method construction");
  for (const construction of constructions) {
    assert.equal(construction.object === object && construction.property === method, true,
      "native provenance retains the exact literal and own method rather than a same-signature declaration");
    assert.equal(construction.payload.captures.length, 1, "the actual retained value is not replaced by an empty environment");
    assert.equal(ast.text(ast.name(construction.payload.captures[0].declaration)), "value",
      "the original creation's captured formal is retained");
    assert.equal(Object.isFrozen(construction) && Object.isFrozen(construction.payload), true,
      "construction and physical capture evidence are immutable before publication");
  }
});

for (const surfaces of [[], ["js"]]) {
  for (const [label, suffix, expected] of [
    ["direct native invocation", "export function read(): number { return source.value(); }", "fixed"],
    ["actual member write", "source.value = function(): number { return 9; };", "stored"],
    ["extracted method identity", "export const extracted = source.value;", "stored"],
    ["opaque formal receiver", "export function read(other: typeof source, flag: boolean): number { return (flag ? source : other).value(); }", "stored"],
  ]) test(`checked exported method exposure retains ${label} (${surfaces[0] ?? "native"})`, () => {
    let methods;
    compileRust({ surfaces, files: { "index.ts": `
export const source = { value(): number { return 7; } };
${suffix}
` }, compileTarget(request) {
      const context = analyzeRustCheckedContext(request, original => {
        const structuralShapes = Object.create(original.structuralShapes, { initialize: { value(...inputs) {
          original.structuralShapes.initialize(...inputs);
          methods = original.structuralShapes.definitions.flatMap(definition => definition.fields
            .filter(field => field.sourceName === "value" && field.method === true).map(field => field.methodPlan));
        } } });
        return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(original),
          structuralShapes: { value: structuralShapes, enumerable: true } });
      });
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
    } });
    assert.equal(methods !== undefined && methods.length !== 0, true,
      `${label}: the real checked source reaches the pre-seal native representation owner`);
    for (const method of methods) assert.equal(method?.kind, expected,
      `${label}: actual writes/extraction stay distinct from the exported native body boundary`);
  });
}

test("closed structural method bodies preserve their actual native contract geometry", testContext => {
  let context;
  const { result } = compileRust({ surfaces: [], files: { "index.ts": `
type Reader = { value(): number; };
type Other = { value(): number; };
function read(owner: Reader): number { return owner.value(); }
export function run(): number {
  const owner = { value(): number { return 1; } };
  return read(owner);
}
` }, compileTarget(request) {
    const analyzed = analyzeRustCheckedContext(request, original => { context = original; return original; });
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: analyzed.diagnostics };
  } });
  assert.equal(context !== undefined, true, "the exact checked source reaches its native layout owner");
  const describe = carrier => {
    const object = rustStructuralObjectCarrierValue(carrier);
    return object === undefined ? carrier.kind : {
      implementation: object.implementation?.kind,
      methods: object.implementation?.methods.map(method => method.identity),
      fields: object.fields.map(field => {
        const protocol = rustCallableProtocol(field.type);
        return { name: field.sourceName, kind: field.type.kind, method: field.method,
          lifetime: protocol?.lifetime?.kind, parameters: protocol?.parameters.map(parameter => parameter.kind),
          result: protocol?.result.kind, error: protocol?.error?.kind === "target-named" ? protocol.error.id : protocol?.error?.kind };
      }),
    };
  };
  const shapes = context.structuralShapes.definitions;
  testContext.diagnostic(JSON.stringify(shapes.map(shape => ({ name: shape.targetName,
    native: describe(shape.carrier), fixed: shape.fields.filter(field => field.methodPlan?.kind === "fixed")
      .map(field => ({ name: field.sourceName, declaration: context.ast.kindName(field.methodPlan.declaration) })) }))));
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("; "));
  for (const shape of shapes) for (const field of shape.fields) if (field.methodPlan?.kind === "fixed") {
    assert.equal(field.methodPlan.payload !== undefined && Object.isFrozen(field.methodPlan.payload), true,
      "the actual native body has its required published capture payload");
    assert.equal(rustStructuralObjectCarrierValue(shape.carrier)?.implementation?.kind, "physical",
      "the original checked method contract publishes the completed physical implementation");
  }
});

test("only universally fixed actual bodies leave the retained generic family", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function create() {
  return { identity<Value>(value: Value): Value {
    const nested = <Inner>(inner: Inner): Inner => inner;
    return nested(value);
  } };
}
` } });
  const ast = program.source.ast;
  const definitions = program.structuralShapes.definitions;
  const definition = definitions.find(definition => definition.fields.some(field => field.methodPlan?.kind === "fixed"));
  assert.equal(definition !== undefined, true, "the checked literal publishes one actual fixed method plan");
  const method = definition.fields.find(field => field.methodPlan?.kind === "fixed").methodPlan;
  assert.equal(rustFixedStructuralMethodDeclarations(ast, program.structuralShapes).has(method.declaration), true,
    "the exact universally fixed source declaration needs no retained family");
  assert.equal(program.callableValues.generic.implementationFor(method.declaration), undefined,
    "no generic Callable implementation is fabricated for that native fixed body");
  const nested = [];
  const visit = node => {
    if (ast.is.IsArrowFunction(node)) nested.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(method.declaration);
  assert.equal(nested.length, 1, "the original body still contains its checked nested closure");
  assert.equal(program.callableValues.generic.implementationFor(nested[0]) !== undefined, true,
    "skipping the outer retained family never skips its body or nested closure inventory");
  const retained = { ...definition, fields: definition.fields.map(field => field.methodPlan?.kind !== "fixed" ? field
    : { ...field, methodPlan: { kind: "stored", carrier: field.methodPlan.carrier,
      receiver: field.methodPlan.receiver, constructions: [] } }) };
  assert.equal(rustFixedStructuralMethodDeclarations(ast, { definitions: [...definitions, retained] }).has(method.declaration), false,
    "one retained instantiation of the same actual body keeps its needed family");
});

for (const surfaces of [[], ["js"]]) test(`fixed calls bind the complete receiver context, not only their own captures (${surfaces[0] ?? "native"})`, testContext => {
  const { program } = analyzeRust({ surfaces, files: { "index.ts": `
export function create(callback: () => number) {
  return {
    invoke(): number { return callback(); },
    read(): number { return 7; },
  };
}
export function run(callback: () => number): number { return create(callback).read(); }
` } });
  const definition = program.structuralShapes.definitions.find(definition =>
    definition.fields.some(field => field.sourceName === "invoke") && definition.fields.some(field => field.sourceName === "read"));
  assert.equal(definition !== undefined, true, "the real receiver retains both checked native method bodies");
  const invoke = definition.fields.find(field => field.sourceName === "invoke")?.methodPlan;
  const read = definition.fields.find(field => field.sourceName === "read")?.methodPlan;
  assert.equal(invoke?.kind === "fixed" && read?.kind === "fixed", true,
    "both exact methods remain concrete rather than gaining a retained wrapper");
  assert.equal(invoke.payload.captures.length, 1, "the invoking method keeps its actual callback context");
  assert.equal(read.payload.captures.length, 0, "the read method does not acquire its sibling's capture");
  assert.equal(definition.genericParameters.some(parameter => parameter.kind === "type"), true,
    "the complete physical receiver template still declares the sibling context's actual native type parameter");
  const ast = program.source.ast;
  const receivers = [];
  const visit = node => {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "source-call" && operation.target.form === "structural-method" &&
      definition.fields[operation.target.storageIndex]?.sourceName === "read") {
      const access = ast.as.AsCallExpression(node)?.Expression;
      const receiver = access === undefined ? undefined : ast.as.AsPropertyAccessExpression(access)?.Expression;
      assert.equal(receiver !== undefined, true, "the fixed call retains its original checked receiver occurrence");
      receivers.push(program.callableValues.nativeStorage.operandFor(receiver));
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(receivers.length, 1, "the exact returned receiver is checked once");
  for (const selected of receivers) {
    assert.equal(selected.kind !== "unresolved", true,
      selected.kind === "unresolved" ? selected.reason : "the actual returned receiver has published physical storage");
    const physical = rustStructuralObjectCarrierValue(selected.carrier);
    const template = program.structuralShapes.templateForCarrier(selected.carrier);
    const distinct = template !== undefined && !rustTargetTypeRefEquals(template.carrier, selected.carrier);
    testContext.diagnostic(`physical-receiver: physical=${physical?.implementation?.kind === "physical"}; canonical-template=${template !== undefined}; distinct-instance=${distinct}`);
    assert.equal(physical?.implementation?.kind, "physical", "the receiver retains its actual checked physical implementation");
    assert.equal(template !== undefined, true, "the source-call producer admits the physical instance before the generic consumer's template lookup");
    const parameters = new Set(template.genericParameters.flatMap(parameter => parameter.kind === "type" ? [parameter.identity] : []));
    assert.equal(bindRustStructuralReceiverParameters(template.carrier, selected.carrier, parameters) !== undefined, true,
      "the complete receiver binds only through exact native geometry and its own canonical type identities");
    assert.equal(distinct, true, "the caller's actual physical context is an instance, not a reused callee-template identity");
  }
});

test("only an actual retained factory receiver or physical context requires native ownership", () => {
  for (const [label, input, expected] of [
    ["direct native body", { factory: false, usesThis: true, capturedValues: 2 }, "shared"],
    ["context-free Promise factory", { factory: true, usesThis: false, capturedValues: 0 }, "shared"],
    ["Promise factory reads its receiver", { factory: true, usesThis: true, capturedValues: 0 }, "value"],
    ["Promise factory reads only physical context", { factory: true, usesThis: false, capturedValues: 1 }, "value"],
  ]) assert.equal(selectRustStructuralFactoryReceiver(input), expected, label);
});

test("sealed fixed methods publish actual payloads and native factory receiver decisions", () => {
  for (const [label, source, expected, captures, lowering] of [
    ["settled without receiver or captures", "export function create() { return { async answer(): Promise<number> { return 7; } }; }", "shared", 0, "settled"],
    ["settled receiver state", "export function create() { return { value: 7, async answer(): Promise<number> { return this.value; } }; }", "shared", 0, "settled"],
    ["settled physical context without this", "export function create(value: number) { return { async answer(): Promise<number> { return value; } }; }", "shared", 1, "settled"],
    ["factory without receiver or captures", "export function create() { return { async answer(pending: Promise<number>): Promise<number> { await pending; return 7; } }; }", "shared", 0, "factory"],
    ["factory receiver state", "export function create() { return { value: 7, async answer(pending: Promise<number>): Promise<number> { await pending; return this.value; } }; }", "value", 0, "factory"],
    ["factory physical context without this", "export function create(value: number) { return { async answer(pending: Promise<number>): Promise<number> { await pending; return value; } }; }", "value", 1, "factory"],
  ]) {
    let program;
    assert.doesNotThrow(() => { ({ program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } })); },
      `${label}: the actual selected native completion and capture domain is admitted`);
    const shape = program.structuralShapes.definitions.find(definition => definition.fields.some(field => field.sourceName === "answer"));
    const method = shape?.fields.find(field => field.sourceName === "answer")?.methodPlan;
    assert.equal(method?.kind, "fixed", `${label}: the actual checked native body remains concrete`);
    const asynchronous = program.records.asyncFunction.get(method.declaration);
    assert.equal(asynchronous?.kind === "js-promise" && asynchronous.lowering.kind === lowering, true,
      `${label}: native receiver ownership follows the actual selected completion lifetime`);
    assert.equal(method.payload !== undefined && Object.isFrozen(method.payload), true,
      `${label}: the final payload is required and immutable`);
    assert.equal(method.payload.captures.length, captures, `${label}: captures are the actual source domain, not an empty substitute`);
    assert.equal(method.payload.receiverFields.length, 0, `${label}: no unrelated enclosing receiver field is invented`);
    assert.equal(method.payload.receivers.length, 0, `${label}: this is the literal receiver, not an enclosing captured receiver`);
    assert.equal(method.factoryReceiver, expected, `${label}: retained facade ownership is selected before publication`);
    assert.equal(program.structuralShapes.definitionForCarrier(shape.carrier) !== undefined, true,
      `${label}: the completed native template remains a sealed lookup`);
  }
});
