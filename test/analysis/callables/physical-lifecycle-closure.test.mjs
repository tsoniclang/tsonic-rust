import assert from "node:assert/strict";
import test from "node:test";
import { createSourceStorageQuery, targetUseSiteRef } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram, Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { createRustNativeCallableProducerPlan } from "../../../dist/analysis/callables/native/native-producers.js";
import { createRustGenericCallablePhysicalPlan } from "../../../dist/analysis/callables/generics/generic-physical.js";
import { createRustNativeCapturePlan } from "../../../dist/analysis/callables/native/native-captures.js";
import { createRustFrameCallablePlan } from "../../../dist/analysis/callables/values/frame-values.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustOptionElementCarrier } from "../../../dist/target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";

function methodInvocationError(program, field) {
  if (field.methodPlan?.kind === "fixed") {
    const reference = rustProducerErrorReference(program.callableValues.nativeProducers.errorFor(field.methodPlan.declaration, "invoke"));
    assert.equal(reference !== undefined, true, "a fixed body keeps its actual native invocation error owner");
    return program.errorRegions.producerError(reference);
  }
  return rustCallableProtocol(field.presence === "optional"
    ? rustOptionElementCarrier(field.methodPlan?.carrier) : field.methodPlan?.carrier)?.error;
}

const joinedSource = `
type Identity = <Value>(value: Value) => Value;
function make(callback: () => number): Identity {
  const original = <Value>(value: Value): Value => { callback(); return value; };
  const alias: Identity = original;
  return alias;
}
export function choose(left: () => number, right: () => number, select: boolean): Identity {
  return select ? make(left) : make(right);
}
`;

for (const [surface, surfaces] of [["native", []], ["js", ["js"]]]) {
  for (const [label, classKind, fallible, source] of [
    ["implicit class expression", "KindClassExpression", false, `
export function make(seed: number) {
  return new class Capture {
    value = seed;
    read(): number { return this.value; }
  }();
}
export function read(seed: number): number { return make(seed).read(); }
`],
    ["throwing class-expression initializer", "KindClassExpression", true, `
function checked(seed: number): number {
  if (seed < 0) throw new Error("initializer");
  return seed;
}
export function make(seed: number) {
  return new class Capture {
    value = checked(seed);
    read(): number { return this.value; }
  }();
}
export function read(seed: number): number { return make(seed).read(); }
`],
    ["ordinary class declaration", "KindClassDeclaration", false, `
class Regular { value = 7; read(): number { return this.value; } }
export function make(): Regular { return new Regular(); }
export function read(): number { return make().read(); }
`],
  ]) {
    test(`${label} retains its exact constructor invocation and initializer effects (${surface})`, () => {
      const { result } = compileRust({ surfaces, files: { "index.ts": source } });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message}`).join("; "));
      assert.equal(result.program !== undefined && result.plan !== undefined, true,
        "the actual constructor evidence reaches native program and plan publication");
      assert.equal(result.artifacts.some(artifact => String(artifact.path).endsWith(".rs")), true,
        "the complete constructor program emits native source");
      const program = result.program;
      const ast = program.source.ast;
      const nodes = sourceNodes(program);
      const declaration = nodes.find(node => ast.kindName(node) === classKind);
      assert.equal(declaration !== undefined, true, "the actual checked native class identity exists");
      const invocations = nodes.filter(node => ast.is.IsNewExpression(node) &&
        program.records.targetOperation.get(node)?.target?.form === "constructor");
      assert.equal(invocations.length, 1, "one actual native constructor is invoked");
      const invocation = invocations[0];
      const selected = program.records.sourceCallEffects.get(invocation);
      assert.equal(selected !== undefined, true, "the constructor has a completed invocation ABI");
      assert.equal(selected.invocation, fallible ? "fallible" : "infallible", "initializer effects decide invocation fallibility");
      assert.equal(selected.awaiting, "not-applicable", "ordinary construction does not invent an await channel");
      assert.equal(program.records.errorEffects.get(declaration)?.localErrors, fallible,
        "the exact declaration retains all actual throwing initializer effects");
      assert.equal(program.records.errorEffects.get(invocation)?.localErrors, fallible,
        "the invocation preserves those same initializer effects");
      const edges = program.records.sourceErrorEffects.get(invocation)?.edges;
      assert.equal(edges?.length, 1, "the invocation has one exact source-to-constructor correspondence");
      assert.equal(edges[0].declaration === declaration, true,
        "the error edge names the actual checked class, never a synthetic substitute");
      assert.equal(edges[0].effects.localErrors, fallible, "an unresolved initializer is never treated as pure");
    });
  }
}

test("one generic source producer retains both actual captured callback error activations", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
type Identity = <Value>(value: Value) => Value;
function make(callback: () => number): Identity {
  return <Value>(value: Value): Value => { callback(); return value; };
}
export function choose(left: () => number, right: () => number, flag: boolean): number {
  const first = make(left);
  const second = make(right);
  const selected = flag ? first : second;
  return selected<number>(7);
}
` } });
  const ast = program.source.ast;
  const nodes = sourceNodes(program);
  const choose = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "choose");
  const invocation = nodes.find(node => ast.is.IsCallExpression(node) && ast.text(Node_Expression(ast, node)) === "selected");
  assert.equal(invocation !== undefined, true, "the actual joined retained value is invoked");
  const fact = program.records.genericCallableInvocation.get(invocation);
  assert.equal(fact !== undefined, true, "one final generic invocation is published");
  const definition = program.callableValues.generic.physical.definitionFor(fact.carrier);
  assert.equal(definition.members.length, 2, "both exact physical capture environments remain in the family");
  assert.equal(new Set(definition.members.map(member => member.implementation.declaration)).size, 1,
    "the source declaration alone cannot identify the physical member");
  assert.equal(fact.invocation.length, 2, "the final invocation retains both member error channels");
  assert.equal(rustTargetTypeRefEquals(fact.invocation[0].errorType, fact.invocation[1].errorType), false,
    "left and right physical callback errors are not conflated");
  const effects = program.records.errorEffects.get(choose);
  assert.equal(effects.nativeErrors.length, 2, "both private pending activation routes reach final effects");
  for (const error of fact.invocation) assert.equal(effects.nativeErrors.some(selected =>
    rustTargetTypeRefEquals(selected.errorType, error.errorType)), true, "each exact invocation member has its own completed route");
});

for (const budgetFailure of [false, true]) {
  test(`structural source admission rejects unavailable producer evidence before physical publication (${budgetFailure ? "budget" : "domain"})`, () => {
    let context;
    let queries = 0;
    const reason = budgetFailure ? "The source storage work budget was exhausted." : "The actual retained method producer domain is unresolved.";
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": "export function make() { return { value(): number { return 7; } }; }" },
      compileTarget(request) {
        context = analyzeRustCheckedContext(request, original => {
          let preparing = false;
          const callableValues = Object.create(original.callableValues, { preparePhysicalStorage: { value(...arguments_) {
            preparing = true;
            return original.callableValues.preparePhysicalStorage(...arguments_);
          } } });
          return { ...original, callableValues, sourceStorage: { ...original.sourceStorage,
            typeFor(subject) {
              if (preparing && subject.kind === "value" && subject.projection.length === 0 &&
                original.ast.is.IsMethodDeclaration(subject.node)) {
                queries += 1;
                return { kind: "unresolved", reason };
              }
              return original.sourceStorage.typeFor(subject);
            },
            storageProducersFor(subject, bindings) {
              if (preparing && subject.projection.some(projection => projection.kind === "method-value")) {
                queries += 1;
                return { kind: "unresolved", reason };
              }
              return original.sourceStorage.storageProducersFor(subject, bindings);
            },
            failureReason: () => preparing && budgetFailure ? reason : original.sourceStorage.failureReason(),
          } };
        });
        return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
      },
    });
    assert.equal(queries > 0, true, "the actual structural constructor admission asks for its real method domain");
    const code = budgetFailure ? "RUST_SOURCE_STORAGE_NOT_PROVEN" : "RUST_CALLABLE_VALUE_NOT_CLOSED";
    assert.equal(result.diagnostics.length, 1, "one source rejection is reported, not an internal crash");
    assert.equal(result.diagnostics[0].code, code, "resource exhaustion remains distinct from missing semantic evidence");
    assert.equal(result.diagnostics[0].message, reason, "the exact owning source failure is retained");
    const method = context.sourceStorage.nodes.find(node => context.ast.is.IsMethodDeclaration(node));
    assert.equal(method !== undefined && context.records.errorEffects.get(method) === undefined, true,
      "no final physical error publication follows failed source admission");
  });
}

test("literal constructors retain their original physical closure independently of later external slot writes", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function make(value: number) {
  return { read(): number { return value; } };
}
` } });
  const storage = createSourceStorageQuery(createTargetSourceProgram(source),
    program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile));
  const method = sourceNodes(program).find(node => program.source.ast.is.IsMethodDeclaration(node));
  assert.equal(method !== undefined, true, "the literal has its actual checked original method");
  const subject = storage.subject(method, "value");
  assert.equal(subject.kind, "resolved", "the source method has an exact checked value subject");
  const bindings = storage.bindingsForLexicalOwner(method);
  assert.equal(bindings.kind, "resolved", "the actual source constructor retains its lexical bindings");
  const domain = storage.storageProducersFor(subject.subject, bindings.bindings);
  assert.equal(domain.kind === "open" && domain.boundaries.some(boundary => boundary.kind === "external-write"), true,
    "the externally returned mutable method slot is not misreported as a closed future write domain");
  const closure = program.records.targetOperation.get(method);
  assert.equal(closure?.kind, "closure", "the original literal still constructs its own admitted closure");
  const actual = program.callableValues.nativeProducers.physicalFor(method, closure.resultCarrier);
  assert.equal(rustCallablePhysicalSignature(actual) !== undefined, true,
    "that actual construction is completed without replacing its source identity or closing external writes");
});

const structuralSources = {
  "four Promise body edges": `
async function fail(): Promise<void> { throw new Error("selected rejection"); }
const api = {
  async reject(): Promise<void> { await fail(); },
  async forward(): Promise<void> { await api.reject(); },
  async caught(): Promise<void> { try { await fail(); } catch {} },
  async plain(): Promise<void> {},
};
export async function run(): Promise<void> { await api.forward(); await api.caught(); await api.plain(); }
`,
  "two actual implementations of one canonical slot": `
export function choose(flag: boolean): { value(): Promise<number> } {
  return flag ? { async value(): Promise<number> { return 1; } } : { async value(): Promise<number> { return 2; } };
}
`,
  "copied async receiver slot": `
const original = { async value(): Promise<number> { return 1; } };
const copy = { ...original };
export async function read(): Promise<number> { return await copy.value(); }
`,
  "copied receiver-independent method in a distinct shape": `
const original = { async value(): Promise<number> { return 1; } };
const copy = { label: "copy", ...original };
export async function read(): Promise<number> { return await copy.value(); }
`,
  "receiver-dependent async method": `
const counter = { count: 0, async next(): Promise<number> { this.count++; return this.count; } };
export async function read(): Promise<number> { return await counter.next(); }
`,
  "captured scalar async method": `
export function make(value: number) { return { async read(): Promise<number> { return value; } }; }
export async function read(): Promise<number> { return await make(7).read(); }
`,
  "optional absent method keeps its canonical present ABI": `
export function make(flag: boolean): { value?(): Promise<number> } {
  return flag ? { async value(): Promise<number> { return 1; } } : {};
}
`,
  "generic captured result template": `
export function make<Value>(value: Value): { read(): Promise<Value> } {
  return { async read(): Promise<Value> { return value; } };
}
const integers = make<number>(7);
const strings = make<string>("text");
export async function read(): Promise<number> { await strings.read(); return await integers.read(); }
`,
};

const mixedErrorSources = {
  "one canonical slot": `
export function choose(flag: boolean): { value(): number } {
  return flag ? { value(): number { return 1; } } : { value(): number { throw new Error("selected"); } };
}
`,
  "connected original, copied and mixed slots": `
export function choose(flag: boolean) {
  const original = { value(): number { return 1; } };
  const copy = { label: "copy", ...original };
  const mixed = flag ? original : { value(): number { throw new Error("selected"); } };
  return { original, copy, mixed };
}
`,
};

for (const [name, source] of Object.entries(mixedErrorSources)) {
  test(`retained construction selects one physical error ABI before captures: ${name}`, () => {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
    const methods = sourceNodes(program).filter(node => program.source.ast.is.IsMethodDeclaration(node));
    const signatures = methods.map(node => {
      const operation = program.records.targetOperation.get(node);
      assert.equal(operation?.kind === "closure", true, `${name}: actual closure declaration`);
      const logical = program.records.receiverIndependentMethod.get(node)?.carrier ?? operation.resultCarrier;
      const signature = rustCallablePhysicalSignature(program.callableValues.nativeProducers.physicalFor(node, logical));
      assert.equal(signature !== undefined, true, `${name}: completed physical constructor`);
      return signature;
    });
    assert.equal(signatures.length, 2, `${name}: pure and throwing source implementations`);
    assert.equal(signatures[0].error?.id === "rust.core.Infallible", false, `${name}: common storage retains the throwing channel`);
    assert.equal(rustTargetTypeRefEquals(signatures[0].error, signatures[1].error), true, `${name}: producers agree before retention`);
    const pure = methods.find(node => program.records.errorEffects.get(node)?.localErrors === false);
    assert.equal(pure !== undefined, true, `${name}: source implementation remains intrinsically pure`);
    const reference = rustProducerErrorReference(program.callableValues.nativeProducers.errorFor(pure, "invoke"));
    assert.equal(program.errorRegions.producerError(reference)?.id === "rust.core.Infallible", true, `${name}: intrinsic channel is not widened`);
    let fields = 0;
    for (const definition of program.structuralShapes.definitions) for (const field of definition.fields) {
      if (field.method !== true || field.methodPlan?.kind === "native-dispatch") continue;
      if (field.methodPlan.kind === "fixed") {
        const declaration = field.methodPlan.declaration;
        const index = methods.indexOf(declaration);
        const effects = program.records.errorEffects.get(declaration);
        assert.equal(index >= 0 && effects !== undefined, true, `${name}: the native body has its original checked method and source effects`);
        const intrinsic = methodInvocationError(program, field);
        assert.equal(intrinsic !== undefined, true, `${name}: the published native invocation error is complete`);
        assert.equal(intrinsic.id === "rust.core.Infallible", effects.localErrors === false,
          `${name}: a direct fixed body retains its own intrinsic channel rather than the stored family's widened channel`);
        if (effects.localErrors !== false) assert.equal(rustTargetTypeRefEquals(intrinsic, signatures[index].error), true,
          `${name}: the actual throwing body agrees with its independent completed native signature`);
        continue;
      }
      const protocol = rustCallableProtocol(field.presence === "optional" ? rustOptionElementCarrier(field.methodPlan.carrier) : field.methodPlan.carrier);
      assert.equal(rustTargetTypeRefEquals(protocol?.error, signatures[0].error), true, `${name}: canonical retained field agrees`);
      fields += 1;
    }
    assert.equal(fields > 0, true, `${name}: actual retained fields exercised`);
  });
}

for (const [name, source] of Object.entries(structuralSources)) {
  test(`structural method storage publishes the actual invocation facet: ${name}`, () => {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
    const actualShapes = new Set();
    for (const node of sourceNodes(program)) {
      const operation = program.records.targetOperation.get(node);
      const carrier = operation?.kind === "record-literal" && operation.storage === "structural-object"
        ? operation.resultCarrier : operation?.kind === "source-call" && operation.target.form === "structural-method"
          ? operation.target.receiverCarrier : undefined;
      const definition = program.structuralShapes.definitionForCarrier(carrier);
      if (definition !== undefined) actualShapes.add(`${definition.componentId}\0${definition.targetName}`);
    }
    let checked = 0;
    for (const definition of program.structuralShapes.definitions) {
      if (!actualShapes.has(`${definition.componentId}\0${definition.targetName}`)) continue;
      for (const [index, field] of definition.fields.entries()) {
        const storage = field.presence === "optional" ? rustOptionElementCarrier(field.methodPlan?.carrier) : field.methodPlan?.carrier;
        const protocol = rustCallableProtocol(storage);
        if (field.method !== true || field.methodPlan?.kind === "native-dispatch" || protocol === undefined) continue;
        assert.equal(methodInvocationError(program, field)?.id === "rust.core.Infallible", true, `${name}: exact native invocation error`);
        const logical = rustCallableProtocol(field.presence === "optional" ? rustOptionElementCarrier(field.carrier) : field.carrier);
        assert.equal(logical.error?.id === "rust.program.TsonicError", true, `${name}: source call contract is not overwritten`);
        for (const carrier of definition.sourceCarriers) {
          const selected = program.structuralShapes.field(carrier, index);
          assert.equal(selected === program.structuralShapes.field(carrier, index), true, `${name}: indexed field identity`);
          assert.equal(methodInvocationError(program, selected)?.id === "rust.core.Infallible", true, `${name}: every source instance is completed`);
        }
        checked += 1;
      }
    }
    assert.equal(checked > 0, true, `${name}: actual stored method slots exercised`);
    for (const node of sourceNodes(program)) {
      const operation = program.records.targetOperation.get(node);
      if (operation?.kind !== "source-call" || operation.target.form !== "structural-method") continue;
      const selected = program.callableValues.nativeStorage.invocationCallableFor(node);
      const field = program.structuralShapes.field(operation.target.receiverCarrier, operation.target.storageIndex);
      if (field.methodPlan.kind === "fixed") {
        assert.equal(selected.kind, "unresolved", `${name}: no retained callable storage is fabricated for a native fixed body`);
        assert.equal(field.methodPlan.payload !== undefined && program.records.sourceCall.get(node) !== undefined, true,
          `${name}: the actual native body, physical captures and invocation are admitted before publication`);
      } else assert.equal(selected.kind !== "unresolved", true, `${name}: final invocation storage is materialized at readiness`);
      const protocol = rustCallableProtocol(field.presence === "optional" ? rustOptionElementCarrier(field.methodPlan.carrier) : field.methodPlan.carrier);
      assert.equal(rustTargetTypeRefEquals(protocol.result, operation.resultCarrier), true, `${name}: checked result correspondence`);
    }
  });
}

function sourceNodes(program) {
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(file);
  return nodes;
}

test("generic structural physical returns and concrete receiver values retain one actual layout application", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": structuralSources["generic captured result template"] } });
  const nodes = sourceNodes(program);
  const declaration = name => nodes.find(node => program.source.ast.is.IsFunctionDeclaration(node) &&
    program.source.ast.text(program.source.ast.name(node)) === name);
  const make = declaration("make");
  const logical = program.records.sourceCallableReturn.get(make)?.returnCarrier;
  const returned = program.callableValues.nativeStorage.returnFor(make);
  assert.equal(returned.kind !== "unresolved", true, "the authored declaration has one physical aggregate layout owner");
  assert.equal(rustTargetTypeRefEquals(returned.carrier, logical), true, "logical structure identity selects the canonical physical layout");
  const shape = program.structuralShapes.definitionForCarrier(returned.carrier);
  for (const selected of [program.callableValues.nativeProducers.outwardReturnFor(make),
    program.callableValues.nativeProducers.invocationResultFor(make)]) {
    assert.equal(rustTargetTypeRefEquals(selected, returned.carrier), true, "both emitted return facets use the same shape identity");
  }
  const results = [];
  for (const node of nodes) {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind !== "source-call" || operation.target.form !== "structural-method") continue;
    const receiver = program.structuralShapes.definitionForCarrier(operation.target.receiverCarrier);
    assert.equal(receiver.targetName === shape.targetName && receiver.componentId === shape.componentId, true,
      "each actual invocation instantiates the selected template, not a historical contract-only shape");
    const field = program.structuralShapes.field(operation.target.receiverCarrier, operation.target.storageIndex);
    assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(field.methodPlan.carrier)?.result, operation.resultCarrier), true,
      "each forward application preserves the complete concrete Promise output");
    results.push(operation.resultCarrier);
  }
  assert.equal(results.length, 2, "both concrete receiver applications are exercised");
  assert.equal(rustTargetTypeRefEquals(results[0], results[1]), false, "Promise string and number outputs are never conflated");
  for (const name of ["integers", "strings"]) {
    const variable = nodes.find(node => program.source.ast.is.IsVariableDeclaration(node) &&
      program.source.ast.text(program.source.ast.name(node)) === name);
    const selected = program.callableValues.nativeStorage.valueFor(variable);
    assert.equal(selected.kind !== "unresolved", true, `${name}: actual value storage is prepared`);
    const receiver = program.structuralShapes.definitionForCarrier(selected.carrier);
    assert.equal(receiver?.targetName === shape.targetName && receiver?.componentId === shape.componentId, true,
      `${name}: actual emitted storage uses the template owner`);
    const field = program.structuralShapes.field(selected.carrier, 0);
    assert.equal(field === program.structuralShapes.field(selected.carrier, 0), true, `${name}: immutable indexed instance`);
  }
});

test("returned borrowed methods retain the actual closure lifetime without a static destination substitution", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export function make<Region extends Life>(value: Ref<int32, Region>): { label: string; read(): Promise<int32> } {
  const original = { async read(): Promise<int32> { return load(value); } };
  const copy = { label: "borrowed", ...original };
  return copy;
}
` } });
  const method = sourceNodes(program).find(node => program.source.ast.is.IsMethodDeclaration(node));
  const closure = program.records.targetOperation.get(method);
  assert.equal(closure?.kind === "closure", true, "the actual admitted method producer");
  const independent = program.records.receiverIndependentMethod.get(method);
  const retained = rustCallableProtocol(closure.resultCarrier)?.lifetime;
  const selected = rustCallableProtocol(independent?.carrier)?.lifetime;
  assert.equal(retained?.kind === "parameter" && retained.name === "Region", true, "the source closure retains the actual borrowed Region");
  assert.equal(selected?.kind === retained.kind && selected.identity === retained.identity, true,
    "receiver-free evidence transports the same retained lifetime from its producer");
  for (const definition of program.structuralShapes.definitions) {
    for (const field of definition.fields) {
      if (field.method !== true) continue;
      const stored = rustCallableProtocol(field.methodPlan.carrier);
      assert.equal(stored?.lifetime?.kind === "parameter", true, "borrowed method layout is lifetime-parametric, never static");
      assert.equal(stored?.error?.id === "rust.core.Infallible", true, "borrowed async invocation remains infallible");
    }
  }
});

test("structural spread roots retain each actual source declaration through an authored destination contract", () => {
  let context;
  const roots = [];
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
export function make(left: number, right: number, choose: boolean): { label: string; read(): number } {
  const first = { read(): number { return left; } };
  const second = { read(): number { return right; } };
  const firstCopy = { label: "first", ...first };
  const secondCopy = { label: "second", ...second };
  return choose ? firstCopy : secondCopy;
}
` }, compileTarget(request) {
    context = analyzeRustCheckedContext(request, original => {
      let preparing = false;
      const callableValues = Object.create(original.callableValues, { preparePhysicalStorage: { value(...arguments_) {
        preparing = true;
        try { return original.callableValues.preparePhysicalStorage(...arguments_); }
        finally { preparing = false; }
      } } });
      return { ...original, callableValues, sourceStorage: { ...original.sourceStorage,
        subject(node, kind, projection) {
          if (preparing && original.ast.is.IsIdentifier(node) && projection?.length === 1 && projection[0].kind === "method-value")
            roots.push({ node, declaration: projection[0].declaration });
          return original.sourceStorage.subject(node, kind, projection);
        },
      } };
    });
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.equal(result.diagnostics.length, 0, "both real source shapes are admitted without a destination-declaration projection");
  const ast = context.ast;
  const methods = context.sourceStorage.nodes.filter(node => ast.is.IsMethodDeclaration(node));
  assert.equal(methods.length, 2, "two source declarations share the same native field layout");
  assert.equal(roots.length, 2, "each spread registers its actual source value exactly once");
  for (const [index, name] of ["first", "second"].entries()) {
    const selected = roots.filter(root => ast.text(root.node) === name);
    assert.equal(selected.length, 1, name + ": one exact source root");
    assert.equal(selected[0].declaration === methods[index], true, name + ": checked source identity is not selected by layout or spelling");
    assert.equal(ast.is.IsMethodSignatureDeclaration(selected[0].declaration), false, name + ": destination contract is never a source producer");
  }
});

for (const surface of ["native", "js"]) {
  test(`copied source method fields preserve scoped captures in generated storage (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
function make<Region extends Life>(value: Ref<int32, Region>): { label: string; read(): int32 } {
  const original = { read(): int32 { return load(value); } };
  return { label: "borrowed", ...original };
}
export function main(): void {
  const value: int32 = 29;
  const copied = make(ref(value));
  if (copied.read() !== value) throw new Error("copied native loan");
}
main();
` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("; "));
    assert.doesNotMatch(artifactText(result, "src/index.rs"), /Callable<'static|transmute|unreachable_unchecked/u);
    validateGeneratedProject(`physical-source-spread-${surface}`, result.artifacts, { run: true });
  });
}

test("locally invoked copied borrowed methods preserve their exact producer retention", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export async function inspect<Region extends Life>(value: Ref<int32, Region>): Promise<int32> {
  const original = { async read(): Promise<int32> { return load(value); } };
  const copy = { label: "borrowed", ...original };
  return await copy.read();
}
` } });
  const method = sourceNodes(program).find(node => program.source.ast.is.IsMethodDeclaration(node));
  const closure = program.records.targetOperation.get(method);
  const independent = program.records.receiverIndependentMethod.get(method);
  assert.equal(closure?.kind === "closure", true, "the actual admitted captured method");
  const retained = rustCallableProtocol(closure.resultCarrier)?.lifetime;
  const selected = rustCallableProtocol(independent?.carrier)?.lifetime;
  assert.equal(retained?.kind === "parameter" && retained.name === "Region", true, "the capture retains its authored Region");
  assert.equal(selected?.kind === retained.kind && selected.identity === retained.identity, true,
    "copying retains the producer's identical lifetime, never a placeholder or static guess");
  const calls = sourceNodes(program).filter(node => {
    const operation = program.records.targetOperation.get(node);
    return operation?.kind === "source-call" && operation.target.form === "structural-method";
  });
  assert.equal(calls.length, 1, "the copied receiver is actually invoked");
  assert.equal(program.callableValues.nativeStorage.invocationCallableFor(calls[0]).kind !== "unresolved", true,
    "the final native invocation reads its completed storage");
});

test("native-dispatch method fields keep their existing native ABI instead of receiving closure storage", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
class Counter { value(): number { return 1; } }
export function make(): { value(): number } { return new Counter(); }
export function read(): number { return make().value(); }
` } });
  let checked = 0;
  for (const definition of program.structuralShapes.definitions) {
    for (const field of definition.fields) {
      if (field.method !== true) continue;
      assert.equal(field.methodPlan.kind === "native-dispatch", true, "native dispatch retains its own field ABI owner");
      assert.equal(rustCallableProtocol(field.methodPlan.carrier)?.error?.id === "rust.program.TsonicError", true,
        "the declared native dispatch error contract is unchanged");
      checked += 1;
    }
  }
  assert.equal(checked, 1, "the actual native structural view is exercised");
});

test("private native leaf preparation uses the canonical checked subject and preserves complete Future unions", () => {
  const context = analyzeRustErrorEffects(`
export function inspect(input: { count: number; callbacks: (() => number)[]; pair: [number, () => number] },
  pending: Promise<number> | string | undefined): Promise<number> | string | undefined {
  const count = input.count;
  const first = input.callbacks[0];
  const second = input.pair[1];
  return pending;
}
`, { surfaces: [] });
  const owner = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
  const bindings = context.callableValues.native.bindingsFor(owner);
  assert.equal(bindings !== undefined, true, "exact source owner bindings");
  const storage = context.callableValues.nativeStorage;
  let projected = 0;
  for (const node of context.sourceStorage.nodes) {
    if (!context.ast.is.IsVariableDeclaration(node)) continue;
    const initializer = Node_Initializer(context.ast, node);
    const subject = initializer === undefined ? undefined : context.sourceStorage.subjectFor(initializer);
    if (subject?.kind !== "resolved") continue;
    const origin = context.sourceStorage.boundOriginsFor(subject.subject, bindings);
    assert.equal(origin.kind === "resolved", true, "the source storage owner resolves actual projected origins");
    for (const selected of origin.subjects) {
      const carrier = storage.logicalCarrierFor(selected, bindings);
      const expected = context.records.runtimeCarrier.get(initializer)?.carrier;
      assert.equal(rustTargetTypeRefEquals(carrier, expected), true, "the complete projected leaf, not its containing input");
      assert.equal(storage.logicalCarrierFor(selected, bindings) === carrier, true, "one prepared subject and activation");
      assert.equal(Object.isFrozen(carrier), true, "immutable logical leaf metadata");
      projected += 1;
    }
  }
  assert.equal(projected >= 3, true, "member, array and tuple projection controls ran");
  const parameter = context.ast.parameters(owner)[1];
  const subject = context.sourceStorage.subject(parameter, "input");
  assert.equal(subject.kind === "resolved", true, "the exact Future-union parameter");
  const selected = storage.logicalCarrierFor(subject.subject, bindings);
  assert.equal(rustTargetTypeRefEquals(selected, context.records.sourceParameterAbi.get(parameter)?.parameterCarrier), true,
    "Future, string and absence alternatives are not replaced by a selected Future leaf");
  assert.equal(selected === storage.logicalCarrierFor(subject.subject, bindings), true, "complete union metadata is prepared once");
});

test("published callable storage contains only finite read ports and keeps every selected answer stable", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedSource } });
  const storage = program.callableValues.nativeStorage;
  for (const name of ["subjectFor", "boundSubjectFor", "logicalCarrierFor", "genericBindingsFor", "invocationReturnFor", "invocationInputFor",
    "invocationOriginsFor", "implementationOriginsFor"]) assert.equal(name in storage, false, `private construction port ${name}`);
  for (const name of ["bindingsFor", "originsFor", "originsForValue"])
    assert.equal(name in program.callableValues.native, false, `private native input port ${name}`);
  let selected = 0;
  for (const node of sourceNodes(program)) {
    const value = storage.valueFor(node);
    const operand = storage.operandFor(node);
    const returned = storage.returnFor(node);
    assert.equal(storage.valueFor(node) === value, true, "value read identity");
    assert.equal(storage.operandFor(node) === operand, true, "operand read identity");
    assert.equal(storage.returnFor(node) === returned, true, "return read identity");
    if (value.kind === "selected" || operand.kind === "selected" || returned.kind === "selected") selected += 1;
  }
  assert.equal(selected > 0, true, "the witness reads actual selected physical carriers");
});

test("every selected generic flow is one immutable physical application, including both conditional arms", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedSource } });
  // Flow applications are a sealed record family; the planner refuses a missing application with its invariant.
  const applications = program.records.genericCallableFlow;
  let flows = 0;
  for (const node of sourceNodes(program)) {
    const conversion = program.records.contextualValueConversion.get(node)?.conversion;
    if (conversion?.kind !== "generic-callable-flow") continue;
    const application = applications.get(node, conversion, undefined);
    assert.notEqual(application, undefined, "every admitted generic flow has its selected application");
    assert.equal(applications.get(node, conversion, undefined) === application, true, "one selected flow record");
    assert.equal(Object.isFrozen(application), true, "immutable selected flow record");
    flows += 1;
  }
  assert.equal(flows > 0, true, "the witness contains actual admitted generic value flows");
  let inspected = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { inspected += 1; throw new Error("foreign source"); } });
  assert.equal(applications.get(foreign, foreign, foreign), undefined, "an unknown source key has no flow record");
  assert.equal(inspected, 0, "a missing source key never inspects foreign conversion metadata");
});

test("native producer publication reads completed results after source and return selection are revoked", () => {
  const { source, program } = analyzeRust({ surfaces: [], files: { "index.ts": `
export function identity(value: number): number { return value; }
export function choose(): typeof identity { return identity; }
` } });
  const ast = Proxy.revocable(program.source.ast, {});
  const records = Proxy.revocable(program.records, {});
  let open = true;
  let selections = 0;
  const construction = createRustNativeCallableProducerPlan({ source: { ...createTargetSourceProgram(source), ast: ast.proxy }, ast: ast.proxy, nodes: sourceNodes(program), records: records.proxy,
    native: program.callableValues.native, definitions: program.typeDefinitions,
    returnCarrierFor(declaration) {
      assert.equal(open, true, "only private construction selects return storage");
      selections += 1;
      const selected = program.callableValues.nativeStorage.returnFor(declaration);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  construction.selectConstructionErrors(new Map());
  const captured = Object.fromEntries(["outwardReturnFor", "invocationResultFor", "bodyResultFor", "errorFor", "physicalFor"]
    .map(name => [name, construction[name]]));
  const requests = [];
  const bindings = Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() });
  for (const node of sourceNodes(program)) {
    const value = program.records.directCallableReference.get(node);
    if (value !== undefined && rustCallableProtocol(value.carrier) !== undefined)
      requests.push(Object.freeze({ kind: "producer", subject: node, owner: program.source.ast.getSourceFile(node),
        declaration: value.sourceDeclaration, carrier: value.carrier, bindings,
        context: targetUseSiteRef(node, "native-producer", "completed-native-producer-control") }));
  }
  const finalized = construction.seal(Object.freeze(requests));
  assert.equal(finalized.kind, "resolved", "every original required native producer correspondence is complete");
  const published = finalized.value;
  assert.equal("seal" in published, false, "the producer construction port is private");
  assert.equal("selectConstructionErrors" in published, false, "constructor ABI selection is private");
  const before = selections;
  open = false;
  ast.revoke();
  records.revoke();
  assert.equal(published.producers.length > 0, true, "real native producer domain");
  for (const producer of published.producers) {
    const declaration = producer.declaration;
    const outward = published.outwardReturnFor(declaration);
    const invocation = published.invocationResultFor(declaration);
    const body = published.bodyResultFor(declaration);
    const error = published.errorFor(declaration, "invoke");
    assert.equal(captured.outwardReturnFor(declaration) === outward, true, "captured outward reader is terminal");
    assert.equal(captured.invocationResultFor(declaration) === invocation, true, "captured invocation reader is terminal");
    assert.equal(captured.bodyResultFor(declaration) === body, true, "captured body reader is terminal");
    assert.equal(captured.errorFor(declaration, "invoke") === error, true, "captured intrinsic-error reader is terminal");
    assert.equal(published.outwardReturnFor(declaration) === outward, true, "outward result identity");
    assert.equal(published.invocationResultFor(declaration) === invocation, true, "invocation result identity");
    assert.equal(published.bodyResultFor(declaration) === body, true, "body result identity");
    assert.equal(published.errorFor(declaration, "invoke") === error, true, "producer error identity");
    for (const { carrier } of requests.filter(request => request.declaration === declaration)) {
      const physical = published.physicalFor(declaration, carrier);
      assert.equal(captured.physicalFor(declaration, carrier) === physical, true, "captured physical reader is terminal");
      assert.equal(physical !== undefined, true, "required physical request selected before publication");
      assert.equal(published.physicalFor(declaration, carrier) === physical, true, "physical producer identity");
    }
  }
  assert.equal(selections, before, "no source or storage selection after publication");
  assert.throws(() => construction.seal(requests), /exactly once/u, "one native producer publication");
});

test("published producer physical lookup rejects a foreign declaration without inspecting its carrier", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": "export function answer(): number { return 42; }" } });
  let inspected = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { inspected += 1; throw new Error("foreign carrier"); } });
  assert.equal(program.callableValues.nativeProducers.physicalFor(foreign, foreign) === undefined, true, "unknown declaration is absent");
  assert.equal(inspected, 0, "foreign declaration/metadata is not source-inspected");
});

test("a physical reader captured during construction becomes the same terminal lookup without family reselection", () => {
  const context = analyzeRustErrorEffects(`export function make(): <Value>(value: Value) => Value {
    return <Value>(value: Value): Value => value;
  }`, { surfaces: [] });
  const generic = context.callableValues.generic;
  let open = true;
  let selections = 0;
  const captures = createRustNativeCapturePlan({ records: context.records, storage: context.sourceStorage,
    nativeStorage: context.callableValues.nativeStorage });
  const construction = createRustGenericCallablePhysicalPlan(generic.definitions, carrier => {
    assert.equal(open, true, "logical family selection is construction-only");
    selections += 1;
    return generic.definitionFor(carrier);
  }, { ast: context.ast, lifetimes: context.sourceLifetimes, storage: context.sourceStorage, captures, native: context.callableValues.native,
    genericBindingsFor: context.callableValues.nativeStorage.genericBindingsFor,
    boundSubjectFor: (subject, carrier, bindings) =>
      context.callableValues.nativeStorage.boundSubjectFor(subject, carrier, bindings) });
  const implementation = generic.definitions[0].implementations[0];
  const subject = context.sourceStorage.subject(implementation.declaration, "value");
  assert.equal(subject.kind, "resolved", "actual source producer");
  const selected = construction.carrierFor(implementation.carrier, implementation.sourceFileName, subject.subject,
    context.sourceStorage.emptyBindings, [{ subject: subject.subject, bindings: context.sourceStorage.emptyBindings }]);
  assert.equal(selected !== undefined, true, "actual owned physical source admitted");
  const captured = construction.plan;
  construction.closeAdmission();
  const published = construction.closeKeys();
  construction.publish();
  const count = selections;
  open = false;
  assert.equal(captured.definitionFor(selected.carrier) === published.definitionFor(selected.carrier), true,
    "early reader uses the same completed definition");
  assert.equal(captured.argumentsFor(selected.carrier) === published.argumentsFor(selected.carrier), true,
    "early reader uses the same completed argument object");
  assert.equal(captured.existingSelectionFor(selected.carrier) === published.existingSelectionFor(selected.carrier), true,
    "early optional reader uses the identical completed selection");
  assert.equal(captured.conversionFor(selected.carrier, selected.carrier) === published.conversionFor(selected.carrier, selected.carrier), true,
    "early conversion reader uses the identical completed application");
  assert.equal(selections, count, "captured completion/error inputs never select a family after publication");
});

test("frame reads and same-activation proofs remain data-only after construction inputs are revoked", () => {
  const { program, source: checked } = analyzeRust({ surfaces: [], files: { "index.ts": `
class Value {
  recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  rebind(): void { this.recurse = (count: number): number => count === 0 ? 2 : this.recurse(count - 1); }
}
export function escaped(): (count: number) => number {
  const value = new Value();
  const before = value.recurse;
  value.rebind();
  return before;
}
` } });
  const source = createTargetSourceProgram(checked);
  const sourceStorage = createSourceStorageQuery(source, program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile));
  const guarded = [];
  const guard = value => {
    const selected = Proxy.revocable(value, {});
    guarded.push(selected);
    return selected.proxy;
  };
  const frameInput = { ast: guard(program.source.ast), records: guard(program.records),
    frameBindingCarriers: new Map(program.callableValues.frames.definitions.flatMap(definition => definition.bindings
      .filter(binding => definition.activation.slotDeclarations.includes(binding.declaration))
      .map(binding => [binding.declaration, binding.carrier]))),
    ownership: guard(program.callableOwnership), sourceStorage: guard(sourceStorage), nativeNodes: sourceNodes(program), usedNames: new Set(),
    navigation: guard(source.navigation), projectTypes: guard(program.projectTypes),
    objectRepresentations: guard(program.objectRepresentations) };
  const frames = createRustFrameCallablePlan(frameInput);
  assert.equal(frames.issues.length, 0, "the original completed native slots agree with every original physical entry");
  for (const [declaration, carrier] of frameInput.frameBindingCarriers) {
    assert.equal(frames.bindingFor(declaration)?.carrier === carrier, true, "one exact original completed slot carrier");
  }
  const missing = createRustFrameCallablePlan({ ...frameInput, frameBindingCarriers: new Map() });
  assert.equal(missing.issues.some(issue => frameInput.frameBindingCarriers.has(issue.subject) &&
    issue.message === "A native frame binding requires its exact selected carrier and closed entry protocol."), true,
  "a source declaration schema cannot replace the required completed native slot carrier");
  const nodes = sourceNodes(program);
  const witnesses = frames.definitions.flatMap(definition => definition.entries.flatMap(entry => entry.implementations
    .map(implementation => ({ definition, entry, implementation }))));
  assert.equal(witnesses.length > 0, true, "real class/frame entry alternatives");
  for (const selected of guarded) selected.revoke();
  for (const { definition, entry, implementation } of witnesses) {
    assert.equal(frames.definitionFor(implementation.carrier) === definition, true, "prepared frame owner");
    assert.equal(frames.entryFor(implementation.carrier) === entry, true, "prepared frame signature");
    const before = frames.isSameActivationInput(implementation.declaration, definition);
    assert.equal(before, true, "an owned entry belongs to its own activation");
    assert.equal(frames.isSameActivationInput(implementation.declaration, definition), before, "stable same-activation proof");
  }
  for (const node of nodes) {
    const definition = frames.definitionForOwner(node);
    if (definition !== undefined) assert.equal(frames.definitionForOwner(node) === definition, true, "native activation owner identity");
  }
  assert.equal(frames.isSameActivationInput({}, {}), false, "foreign activation is absent without source inspection");
});
