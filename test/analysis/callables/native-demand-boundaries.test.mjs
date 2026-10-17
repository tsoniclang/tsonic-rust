import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";
import { Node_Name, createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustAbsenceTargetType, rustUnitTargetType, rustCallableProtocol, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustFrameCallableValue } from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rustSourceTypeCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { planCallableExpression, planRustCallableExpressionBody } from "../../../dist/backend/planner/expressions/callable.js";
import { selectRustRuntimeCallableGenerics } from "../../../dist/policy/types/callables/runtime-callable-generics.js";
import { rustLifetimeKey } from "../../../dist/target-model/lifetimes/index.js";
import { rustFunctionValueLifetimeBinding } from "../../../dist/target-model/lifetimes/identity.js";

const surfaces = [["native", []], ["js", ["js"]]];

test("source function lifetime binding preserves every exact formal and substituted outlives edge", () => {
  const first = { kind: "lifetime", declaration: {}, sourceName: "First",
    lifetime: { kind: "parameter", identity: "first", name: "First" }, outlives: [{ kind: "static" }] };
  const second = { kind: "lifetime", declaration: {}, sourceName: "Second",
    lifetime: { kind: "parameter", identity: "second", name: "Second" }, outlives: [first.lifetime] };
  const selected = rustFunctionValueLifetimeBinding("function", [first, second]);
  assert.equal(selected !== undefined && selected.binder.parameters.length === 2 && selected.substitutions.size === 2, true,
    "each actual source lifetime has one complete native binder correspondence");
  assert.equal(selected.substitutions.get(rustLifetimeKey(first.lifetime)) === selected.binder.parameters[0].lifetime, true,
    "the first original formal maps to its exact generated bound lifetime");
  assert.equal(selected.substitutions.get(rustLifetimeKey(second.lifetime)) === selected.binder.parameters[1].lifetime, true,
    "the second original formal maps to its exact generated bound lifetime");
  assert.equal(selected.binder.parameters[0].outlives[0] === first.outlives[0], true,
    "an actual external static outlives edge remains unchanged");
  assert.equal(selected.binder.parameters[1].outlives[0] === selected.binder.parameters[0].lifetime, true,
    "a source formal outlives edge binds to the same selected native lifetime");
  assert.equal(Object.isFrozen(selected.binder) && Object.isFrozen(selected.binder.parameters) &&
    selected.binder.parameters.every(parameter => Object.isFrozen(parameter) && Object.isFrozen(parameter.outlives)), true,
  "the published binder and all of its contract vectors are immutable");
  for (const [identity, parameters] of [["", [first]], ["function", []], ["function", [first, first]],
    ["function", [{ ...first, lifetime: selected.binder.parameters[0].lifetime }]]]) {
    assert.equal(rustFunctionValueLifetimeBinding(identity, parameters) === undefined, true,
      "missing, duplicate or already-bound evidence cannot manufacture a second generated binder");
  }
});

test("terminal selected-call refusals retain exact source evidence without inventing a binding failure", () => {
  for (const [form, values] of [["bare", "[signed, unsigned]"], ["literal last", "[signed, unsigned, 1]"],
    ["literal middle", "[signed, 1, unsigned]"], ["literal first", "[1, signed, unsigned]"]]) {
    const sourceText = `import type { int32, uint32 } from "@tsonic/core/types.js";
export function check(signed: int32, unsigned: uint32): boolean {
  const values = ${values}; const keys = new Set(values);
  return keys.has(values[1]) && keys.size === 1;
}`;
    const { result, source } = compileRust({ surfaces: ["js"], files: { "index.ts": sourceText } });
    assert.deepEqual(result.diagnostics.map(issue => issue.code),
      ["RUST_SELECTED_OPERATION_UNSUPPORTED", "RUST_SELECTED_OPERATION_UNSUPPORTED"],
      `${form}: each actual operation keeps its refusal without a derivative native-binding diagnostic`);
    const ast = createTargetSourceProgram(source).ast;
    for (const [index, text, message] of [
      [0, "new Set(values)", "The selected JavaScript constructor 'SetConstructor' has no closed Rust operation row for the selected argument carriers."],
      [1, "keys.has(values[1])", "The selected JavaScript call 'ReadonlySet.has' has no closed Rust operation row for the selected receiver and argument carriers."],
    ]) {
      const issue = result.diagnostics[index];
      const range = ast.authoredRange(issue.sourceNode);
      assert.equal(issue.message, message, `${form}: the original selected-operation message is unchanged`);
      assert.equal(range.kind === "authored" && range.start === sourceText.indexOf(text) &&
        range.end === range.start + text.length, true,
      `${form}: the original checked operation owns its exact diagnostic span`);
      assert.equal(issue.evidence.includes("target.capability=rust.selected-operation"), true,
        `${form}: the original policy refusal retains its evidence`);
    }
    assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
      `${form}: a real unsupported operation still publishes no native output`);
  }
});

for (const [surface, selected] of surfaces) {
  for (const [use, declarations, invocation] of [
    ["direct", "", "identity(value)"],
    ["immutable alias", "const selected = identity;", "selected(value)"],
    ["forwarded immutable alias", "const selected = identity; const forwarded = selected;", "forwarded(value)"],
  ]) {
    for (const explicit of [false, true]) {
      test(`named lifetime function ${use} preserves its ${explicit ? "explicit" : "inferred"} actual invocation (${surface})`, () => {
        const expression = explicit ? invocation.replace("(value)", "<Caller>(value)") : invocation;
        const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
function identity<Region extends Life>(value: Ref<int32, Region>): Ref<int32, Region> { return value; }
export function run<Caller extends Life>(value: Ref<int32, Caller>): Ref<int32, Caller> {
  ${declarations}
  return ${expression};
}` } });
        assert.equal(result.diagnostics.length, 0,
          result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("; "));
        assert.equal(result.program !== undefined && result.plan !== undefined, true,
          "the complete checked source preserves a native named-lifetime invocation");
        const program = result.program;
        const ast = program.source.ast;
        const pending = [...program.sourceFiles];
        let declaration;
        let call;
        while (pending.length !== 0) {
          const node = pending.pop();
          if (ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "run") declaration = node;
          if (ast.is.IsCallExpression(node)) call = node;
          ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
        }
        const lifetime = program.sourceLifetimes.contractFor(declaration)?.parameters[0]?.lifetime;
        const carrier = program.records.runtimeCarrier.get(call)?.carrier;
        assert.equal(lifetime?.kind, "parameter", "the caller owns its actual named lifetime");
        assert.equal(carrier?.kind === "reference" && carrier.lifetime !== undefined &&
          rustLifetimeKey(carrier.lifetime) === rustLifetimeKey(lifetime), true,
        "the returned loan has the exact caller lifetime, never a callee binder or static replacement");
        assert.doesNotMatch(rustSourceText(result), /Callable::new/u,
          "a named native function alias introduces no heap callable adaptation");
        if (use === "direct") return;
        const semantics = program.source.semantics.forNode(call);
        const source = semantics.operations.call(call);
        const sourceSelectedDeclaration = semantics.declarations.signatureDeclaration(source.selectedSignature);
        const reference = program.source.navigation.sourceReferenceFor(source.sourceCallee.expression);
        const callable = program.records.runtimeCarrier.get(reference?.declaration)?.carrier;
        const request = { source, sourceSelectedDeclaration };
        const context = { ast, currentSemantics: semantics, sourceLifetimes: program.sourceLifetimes };
        assert.equal(callable?.kind === "function-pointer" && callable.lifetimeBinder !== undefined, true,
          "the actual alias owns the original native higher-ranked function pointer");
        const arguments_ = selectRustRuntimeCallableGenerics(request, callable, context);
        assert.equal(arguments_?.length === 1 && arguments_[0].kind === "lifetime", true,
          "the checked original formal maps to its generated native binder");
        for (const [label, changed, changedRequest, changedContext] of [
          ["foreign binder", { ...callable, lifetimeBinder: { ...callable.lifetimeBinder, identity: "foreign" } }, request, context],
          ["missing formal", callable, { ...request, source: { ...source, sourceSelectedMethodTypeArguments: [] } }, context],
          ["foreign formal name", callable, { ...request, source: { ...source,
            sourceSelectedMethodTypeArguments: source.sourceSelectedMethodTypeArguments.map(argument => ({ ...argument, typeParameterName: "Foreign" })) } }, context],
          ["missing declaration", callable, { ...request, sourceSelectedDeclaration: undefined }, context],
          ["foreign declaration", callable, { ...request, sourceSelectedDeclaration: declaration }, context],
          ["missing lifetime contract", callable, request, { ...context, sourceLifetimes: { ...context.sourceLifetimes, contractFor: () => undefined } }],
          ["missing formal evidence", callable, request, { ...context, sourceLifetimes: { ...context.sourceLifetimes, parameterFor: () => undefined } }],
          ["foreign outlives", { ...callable, lifetimeBinder: { ...callable.lifetimeBinder,
            parameters: callable.lifetimeBinder.parameters.map(parameter => ({ ...parameter, outlives: [{ kind: "static" }] })) } }, request, context],
        ]) {
          assert.equal(selectRustRuntimeCallableGenerics(changedRequest, changed, changedContext) === undefined, true,
            `${label}: unavailable or foreign correspondence never becomes a native argument`);
        }
      });
    }
  }
}

test("erased callable rendering reads its sole sealed participation before native body and capture facts", () => {
  const declaration = {};
  const forbidden = new Proxy({}, { get() { assert.fail("an erased callable cannot inspect native body or source navigation"); } });
  const context = { input: { program: { source: { ast: forbidden }, records: {
    nativeParticipation: { get: node => node === declaration ? "erased" : undefined },
    closureCapture: forbidden, targetOperation: forbidden,
  } } } };
  for (const planner of [planCallableExpression, planRustCallableExpressionBody]) {
    const planned = planner(declaration, context);
    assert.equal(planned?.kind === "tuple-literal" && planned.elements.length === 0, true,
      "both callable entry points consume the same exact sealed erasure without reading missing native evidence");
  }
});

for (const [surface, selected] of surfaces) {
  for (const [form, lambda] of [
    ["arrow", '(key: string): number => { const value = { [key]: 7 }; return value[key]; }'],
    ["function expression", 'function(key: string): number { const value = { [key]: 7 }; return value[key]; }'],
  ]) {
    for (const use of ["direct", "immutable alias"]) {
      test(`unused stored ${form} native participation follows its complete ${use} source uses (${surface})`, () => {
        const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  const ignored = ${lambda};
  ${use === "immutable alias" ? "const alias = ignored; alias;" : "ignored;"}
  return 3;
}` } });
        assert.equal(result.diagnostics.length, 0,
          "a checked stored definition with only discarded reads adds no native computed-key or callable-body obligation");
        assert.equal(result.program !== undefined && result.plan !== undefined, true, "the whole accepted program is published");
        const ast = result.program.source.ast;
        const pending = [...result.program.sourceFiles];
        let declaration;
        while (pending.length !== 0) {
          const node = pending.pop();
          if (ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node)) declaration = node;
          ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
        }
        assert.equal(declaration !== undefined, true, "the original checked callable definition remains present");
        assert.equal(result.program.records.nativeParticipation.get(declaration), "erased", "one analysis owner admits exact callable erasure");
        assert.equal(result.program.records.closureCapture.get(declaration) === undefined, true, "an erased body has no fabricated captures");
        assert.equal(result.program.records.targetOperation.get(declaration) === undefined, true, "an erased body has no fabricated operation");
        assert.doesNotMatch(rustSourceText(result), /Callable::new|callable_arguments|\[key\]/u,
          "a discarded stored definition introduces neither native callable allocation nor its unreachable dynamic field");
      });
    }
    test(`invoking a stored ${form} retains its real native body even when the result is discarded (${surface})`, () => {
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  const invoked = ${lambda};
  const alias = invoked;
  alias("value");
  return 3;
}` } });
      assert.equal(result.diagnostics.some(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN"), true,
        "an actual call reaches the original precise unsupported nonconstant-key owner");
      assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
        "discarding the call result never erases the invoked body's real obligation");
    });
  }

  for (const generic of [false, true]) {
    test(`class-frame invocation and owner arguments use the same exact instantiation (${surface}, ${generic ? "generic" : "concrete"})`, () => {
      const { program } = analyzeRust({ surfaces: selected, files: { "index.ts": `
class Value<T> {
  constructor(readonly seed: T) {}
  recurse = (count: number, value: T): T => count === 0 ? value : this.recurse(count - 1, value);
  rebind(): void { this.recurse = (count: number, value: T): T => count === 0 ? value : this.recurse(count - 1, value); }
}
export function escaped${generic ? "<U>(seed: U)" : "(seed: string)"}: (count: number, value: ${generic ? "U" : "string"}) => ${generic ? "U" : "string"} {
  const value = new Value(seed);
  const before = value.recurse;
  value.rebind();
  return before;
}` } });
      const ast = program.source.ast;
      const pending = [...program.sourceFiles];
      let factory;
      let before;
      while (pending.length !== 0) {
        const node = pending.pop();
        const name = ast.name(node);
        if (name !== undefined && ast.is.IsIdentifier(name)) {
          if (ast.is.IsFunctionDeclaration(node) && ast.text(name) === "escaped") factory = node;
          if (ast.is.IsVariableDeclaration(node) && ast.text(name) === "before") before = node;
        }
        ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
      }
      assert.equal(factory !== undefined && before !== undefined, true, "the retained source identities are exact");
      const local = program.records.runtimeCarrier.get(before)?.carrier;
      const returned = program.records.sourceCallableReturn.get(factory)?.returnCarrier;
      assert.equal(rustTargetTypeRefEquals(local, returned), true, "owner, invocation signature and captured environment are one complete instantiation");
      const frame = rustFrameCallableValue(returned);
      assert.equal(frame?.owner.kind, "class", "the retained value uses the same class frame");
      const protocol = rustCallableProtocol(returned);
      const instance = frame.owner.instance.value.genericArguments[0];
      assert.equal(instance?.kind, "type", "the class has its exact original generic parameter slot");
      assert.equal(rustTargetTypeRefEquals(protocol.parameters[1], instance.type), true,
        "the invocation input never substitutes independently of the actual receiver");
      assert.equal(rustTargetTypeRefEquals(protocol.result, instance.type), true,
        "the invocation result uses the same concrete or factory parameter, never the class declaration T");
    });
  }

  test(`retained class callback entries preserve their real rebinding behavior (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: selected, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
class Value<T> {
  constructor(readonly seed: T) {}
  recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  rebind(): void { this.recurse = (count: number): number => count === 0 ? 2 : this.recurse(count - 1); }
}
const value = new Value("seed");
const before = value.recurse;
value.rebind();
if (before(0) !== 1 || value.recurse(0) !== 2 || before(1) !== 2) throw new Error("frame entry identity");
` } });
    assert.equal(result.diagnostics.length, 0, "the actual retained frame reaches native output without a binder reconciliation");
    assert.equal(result.program !== undefined && result.plan !== undefined, true, "native publication keeps the exact selected physical frame");
    validateGeneratedProject(`retained-class-frame-entries-${surface}`, result.artifacts, { run: true });
  });

  for (const mixed of [false, true]) {
    test(`class callback storage validates every actual receiver instance (${surface}, ${mixed ? "mixed" : "same"})`, () => {
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
class Value<T> {
  constructor(readonly seed: T) {}
  recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  rebind(): void { this.recurse = (count: number): number => count === 0 ? 2 : this.recurse(count - 1); }
}
export function escaped(flag: boolean): (count: number) => number {
  const left = new Value("left");
  const right = new Value(${mixed ? "7" : '"right"'});
  const chosen = flag ? left.recurse : right.recurse;
  return chosen;
}` } });
      if (mixed) {
        assert.equal(result.diagnostics.some(issue => String(issue.code).startsWith("RUST_") && issue.category === "error"), true,
          "incompatible actual receiver arguments require a precise native source refusal");
        assert.equal(result.diagnostics.some(issue => String(issue.code).includes("INTERNAL")), false,
          "a checked mixed receiver domain is not relabelled an internal invariant");
        assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
          "no first receiver or partially selected frame is published");
      } else {
        assert.equal(result.diagnostics.length, 0,
          result.diagnostics.slice(0, 4).map(issue => `${issue.code}: ${issue.message}`).join("; "));
        assert.equal(result.program !== undefined && result.plan !== undefined, true,
          "different instances with the same concrete layout remain natively representable");
        const ast = result.program.source.ast;
        const declaration = result.program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
          node !== undefined && ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "escaped");
        assert.equal(declaration !== undefined, true, "the exact factory remains published");
        const frame = rustFrameCallableValue(result.program.records.sourceCallableReturn.get(declaration)?.returnCarrier);
        assert.equal(frame?.owner.kind, "class", "the actual class frame is retained");
        assert.equal(frame.owner.instance !== undefined, true, "the concrete receiver layout is required evidence");
      }
    });
  }
}

for (const [surface, selected] of surfaces) {
  for (const active of [false, true]) {
    test(`ambient runtime reads require implementation only in an actual native body (${surface}, ${active ? "active" : "dormant"})`, () => {
      const { source, result } = compileRust({ surfaces: selected, files: { "index.ts": `
declare const external: number;
export function run(): number {
  function hidden(): number { return external; }
  return ${active ? "hidden()" : "42"};
}` } });
      if (active) {
        assert.equal(result.diagnostics.filter(issue => issue.code === "RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING").length, 1,
          "the actual native reference retains its one precise implementation refusal");
        assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
          "an unsupported actual native read publishes no program, plan or artifact");
      } else {
        assert.equal(result.diagnostics.length, 0, "an erased body adds no native implementation obligation");
        assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
          "the remaining native program is published");
        const ast = result.program.source.ast;
        const nodes = [...result.program.sourceFiles];
        let hidden;
        let external;
        while (nodes.length !== 0) {
          const node = nodes.pop();
          const name = ast.name(node);
          if (name !== undefined && ast.is.IsIdentifier(name)) {
            if (ast.is.IsFunctionDeclaration(node) && ast.text(name) === "hidden") hidden = node;
            if (ast.is.IsVariableDeclaration(node) && ast.text(name) === "external") external = node;
          }
          ast.forEachChild(node, child => { if (child !== undefined) nodes.push(child); });
        }
        assert.equal(hidden !== undefined && external !== undefined, true, "both original source declarations remain available");
        assert.equal(result.program.records.nativeParticipation.get(hidden), "erased", "the canonical owner selects the dormant body");
        assert.equal(result.program.records.typeOnlyDeclaration.get(external)?.reason, "ambient",
          "ambient source metadata is preserved without a native value implementation");
        assert.equal(createTargetSourceProgram(source).navigation.declarationUses(external).length, 1,
          "the original checked source reference is not filtered out");
        assert.equal(/\bfn hidden\b|\bstatic external\b/u.test(rustSourceText(result)), false,
          "neither the erased body nor an invented ambient runtime binding is emitted");
      }
    });
  }
  for (const [kind, prelude, body] of [
    ["object", "", 'function unused(key: string): number { const value = { [key]: 7 }; return 1; }'],
    ["struct", 'import { field, struct } from "@tsonic/core/lang.js"; function key(): "value" { return "value"; }',
      'function unused(): number { const Shape = struct({ [key()]: field<number>() }); return 1; }'],
  ]) {
    test(`erased ${kind} bodies impose no native storage or key obligation (${surface})`, () => {
      const source = `${prelude}
export function run(): number {
  ${body}
  return 42;
}`;
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": source } });
      assert.equal(result.diagnostics.length, 0, "unused native syntax is not admitted as a physical obligation");
      assert.equal(result.artifacts.some(artifact => String(artifact.path).endsWith(".rs")), true, "the native program is emitted");
      assert.equal(/\bfn unused\b/u.test(rustSourceText(result)), false, "the erased declaration has no native body");
    });

    test(`required ${kind} bodies retain their actual native key refusal (${surface})`, () => {
      const source = `${prelude}
export function run(): number {
  ${body}
  return ${kind === "object" ? 'unused("value")' : "unused()"};
}`;
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": source } });
      assert.equal(result.diagnostics.some(diagnostic => diagnostic.category === "error"), true,
        "an actual native representation is required and its invalid key is refused");
      assert.equal(result.program === undefined, true, "no partial target program");
      assert.equal(result.plan === undefined, true, "no partial native plan");
      assert.equal(result.artifacts.length, 0, "no partial native output");
    });
  }

  test(`erased descendants do not create signature, struct, capture or ownership-flow requests (${surface})`, () => {
    let context;
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
import { field, struct } from "@tsonic/core/lang.js";
function key(): "value" { return "value"; }
export function run(): number {
  function dormant(): number {
    const Shape = struct({ [key()]: field<number>() });
    function nested(value = 1e400): number { return value; }
    const captured = (): number => nested();
    class Hidden { read(): number { return captured(); } }
    class Resource { [Symbol.dispose](): void {} }
    using resource = new Resource();
    async function pending(): Promise<number> { return nested(); }
    const future = pending();
    try { for (const name in { value: 1 }) { nested(); } } catch {}
    return new Hidden().read();
  }
  return 42;
}` }, compileTarget(request) {
      context = analyzeRustCheckedContext(request);
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
    } });
    assert.equal(result.diagnostics.length, 0, "a complete erased subtree cannot impose native obligations");
    const ast = context.ast;
    const dormant = context.sourceStorage.nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "dormant");
    assert.equal(dormant !== undefined, true, "the checked source keeps the exact erased root");
    assert.equal(context.records.nativeParticipation.get(dormant), "erased", "the canonical owner selects erasure once");
    const subtree = new Set();
    const pending = [dormant];
    while (pending.length !== 0) {
      const node = pending.pop();
      subtree.add(node);
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
    assert.equal(context.nativeNodes.some(node => subtree.has(node)), false, "all descendants share the completed exclusion");
    assert.equal(context.sourceStorage.nodes.some(node => subtree.has(node)), true, "checked source transport is never filtered");
    for (const node of subtree) {
      assert.equal(context.records.runtimeCarrier.get(node) === undefined, true, "no native carrier request for an erased descendant");
      assert.equal(context.records.sourceParameterAbi.get(node) === undefined, true, "no syntax-only parameter ABI request");
      assert.equal(context.records.closureCapture.get(node) === undefined, true, "no erased native capture record");
      assert.equal(context.records.resourceManagement.get(node) === undefined, true, "no erased native resource obligation");
      assert.equal(context.records.futureValue.get(node) === undefined, true, "no erased native Future obligation");
      if (node !== dormant && ast.is.IsFunctionDeclaration(node))
        assert.equal(context.records.nativeParticipation.get(node) === undefined, true,
          "a descendant is not classified or written a second time inside an erased root");
    }
  });

  test(`an unused nested enum does not create a native declaration obligation (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  function unused(): number { enum Hidden { Value = 7 } const member: Hidden = Hidden.Value; return 1; }
  return 42;
}` } });
    assert.equal(result.diagnostics.length, 0, "an enum in an erased body needs no emitted native declaration");
    assert.equal(/\benum Hidden\b/u.test(rustSourceText(result)), false, "no native enum escapes the erased subtree");
  });

  test(`erased enum bodies retain the shared source enum-numeric rule (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  function unused(): number { enum Hidden { Value = 7 } return Hidden.Value; }
  return 42;
}` } });
    assert.equal(result.diagnostics.length, 1, "the original source retains its one shared source diagnostic");
    assert.equal(result.diagnostics[0]?.code, "TSONIC_ENUM_NUMERIC_USE_NOT_SUPPORTED");
    assert.equal(result.diagnostics[0]?.message,
      "Enum value 'Hidden' is used as a number; enum-numeric operations are not supported yet. Use equality or bitwise operations within the same enum instead.");
    assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
      "the shared source refusal precedes all native publication");
  });

  test(`a type-only callable reference preserves its required native signature without demanding its unused body (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  function unused(value: number): number { return value + 1; }
  const callback: typeof unused = (value: number): number => value * 2;
  return callback(21);
}` } });
    assert.equal(result.diagnostics.length, 0, "the checked callable type remains usable independently of its source implementation");
    assert.equal(/\bfn unused\b/u.test(rustSourceText(result)), false, "a type reference is not an implementation demand");
  });

  for (const implementationThrows of [false, true]) {
    test(`callable ABI never attributes an invoked value to its separately called signature declaration (${surface}, ${implementationThrows ? "throwing" : "pure"})`, () => {
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  function signature(value: number): number { return value + 1; }
  const callback: typeof signature = (value: number): number => {
    ${implementationThrows ? 'if (value < 0) throw new Error("callback");' : ""}
    return value * 2;
  };
  return callback(21) + signature(1);
}` } });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message}`).join("; "));
      assert.equal(result.program !== undefined && result.plan !== undefined, true,
        "both actual call routes reach native program and plan publication");
      assert.equal(result.artifacts.some(artifact => String(artifact.path).endsWith(".rs")), true,
        "the complete actual callable program emits native source");
      const program = result.program;
      const ast = program.source.ast;
      const pending = [...program.sourceFiles];
      const nodes = [];
      while (pending.length !== 0) {
        const node = pending.pop();
        nodes.push(node);
        ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
      }
      const signature = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "signature");
      const implementation = nodes.find(ast.is.IsArrowFunction);
      const valueCall = nodes.find(node => ast.is.IsCallExpression(node) && ast.text(ast.as.AsCallExpression(node).Expression) === "callback");
      const directCall = nodes.find(node => ast.is.IsCallExpression(node) && ast.text(ast.as.AsCallExpression(node).Expression) === "signature");
      assert.equal(signature !== undefined && implementation !== undefined && valueCall !== undefined && directCall !== undefined, true,
        "the actual signature, implementation and both calls retain their checked identities");
      assert.equal(program.records.errorEffects.get(signature)?.localErrors, false,
        "the separately called signature declaration really has completed source effects");
      assert.equal(program.records.errorEffects.get(implementation)?.localErrors, implementationThrows,
        "the actual arrow keeps its own throwing or pure body effects");
      assert.equal(program.records.sourceCallEffects.get(valueCall)?.invocation, "fallible",
        "the selected runtime Callable ABI is authoritative even for a pure known implementation");
      assert.equal(program.records.sourceErrorEffects.get(valueCall)?.edges.some(edge => edge.declaration === signature) === true, false,
        "a type signature is never substituted for the invoked value's implementation");
      const direct = program.records.sourceErrorEffects.get(directCall)?.edges;
      assert.equal(direct?.length, 1, "the real direct call retains its one exact source edge");
      assert.equal(direct[0].declaration === signature, true, "the direct source edge keeps its actual declaration");
    });
  }

  test(`actual default parameters keep their native rejection (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  function required(value = 1e400): number { return value; }
  return required();
}` } });
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_NUMERIC_LITERAL_NOT_FINITE"), true,
      "an actually used default retains its exact native numeric rule");
    assert.equal(result.artifacts.length, 0, "a required invalid default has no partial output");
  });

  test(`a value closure inherits its exact callable protocol error and preserves thrown identity (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: selected, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
export function run(): boolean {
  const failure = new Error("exact callable failure");
  function signature(value: number): number { return value; }
  const callback: typeof signature = (value: number): number => {
    if (value > 0) throw failure;
    return value;
  };
  signature(0);
  try { callback(1); } catch (caught) { return caught === failure; }
  return false;
}
export function main(): void {
  if (!run()) throw new Error("callable error identity");
}
main();
` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message}`).join("; "));
    assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
      "the real captured throwing closure reaches native planning and emission");
    const program = result.program;
    const ast = program.source.ast;
    const pending = [...program.sourceFiles];
    const nodes = [];
    while (pending.length !== 0) {
      const node = pending.pop();
      nodes.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
    const implementation = nodes.find(ast.is.IsArrowFunction);
    const invocation = nodes.find(node => ast.is.IsCallExpression(node) && ast.text(ast.as.AsCallExpression(node).Expression) === "callback");
    assert.equal(implementation !== undefined && invocation !== undefined, true,
      "the actual captured implementation and value invocation retain their checked identities");
    const closure = program.records.targetOperation.get(implementation);
    const call = program.records.targetOperation.get(invocation);
    assert.equal(closure?.kind === "closure" && call?.kind === "source-call" && call.target.form === "callable", true,
      "this is the inherited runtime protocol route, not a guessed direct declaration edge");
    const inheritedError = rustCallableProtocol(closure.resultCarrier)?.error;
    assert.equal(inheritedError !== undefined, true,
      "the actual closure construction retains an explicit protocol error carrier");
    assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(call.target.carrier)?.error, inheritedError), true,
      "the actual value call preserves the precise inherited error carrier identity");
    assert.equal(program.records.sourceCallEffects.get(invocation)?.invocation, "fallible",
      "an inherited protocol error is never reclassified as pure");
    validateGeneratedProject(`callable-protocol-error-identity-${surface}`, result.artifacts, { run: true });
  });

  test(`type-only escape from an erased local class is a precise native refusal (${surface})`, () => {
    let result;
    assert.doesNotThrow(() => {
      result = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  function unused() { class Local { value = 1; } return new Local(); }
  type Escaped = ReturnType<typeof unused>;
  const values: Escaped[] = [];
  return 42;
}` } }).result;
    }, "an unmaterialized erased native class is never a planner invariant");
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.category === "error"), true,
      "the native type-demand owner refuses an unavailable local representation precisely");
    assert.equal(result.diagnostics.some(diagnostic => String(diagnostic.code).includes("INTERNAL")), false,
      "the unsupported native type does not become an internal failure");
    assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
      "the refusal precedes native program publication");
  });

  test(`an erased writer preserves checked source facts without native capture storage (${surface})`, () => {
    const { program, source } = analyzeRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  let value = 1;
  function unused(): void { value = 2; }
  return value;
}` } });
    const checked = createTargetSourceProgram(source);
    const ast = program.source.ast;
    const pending = [...program.sourceFiles];
    let binding;
    let unused;
    while (pending.length !== 0) {
      const node = pending.pop();
      const name = Node_Name(ast, node);
      if (ast.is.IsVariableDeclaration(node) && name !== undefined && ast.text(name) === "value") binding = node;
      if (ast.is.IsFunctionDeclaration(node) && name !== undefined && ast.text(name) === "unused") unused = node;
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
    assert.equal(binding !== undefined && unused !== undefined, true, "the actual checked identities remain available");
    assert.equal(checked.navigation.declarationUseSummary(binding).bindingWritten, true,
      "native erasure never truncates the checked source write summary");
    assert.equal(program.records.nativeParticipation.get(unused), "erased", "one owner selects the unused capturing writer");
    assert.equal(program.records.closureCapture.get(unused) === undefined, true, "no native capture record is manufactured");
    assert.equal(program.records.bindingStorage.get(binding) === undefined, true, "an erased writer does not require a native capture cell");
  });

  test(`an unused capturing function requires no frame or native body (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(value: number): number {
  function unused(): number { return value; }
  return value;
}` } });
    assert.equal(result.diagnostics.length, 0, "the unused source capture adds no native obligation");
    assert.equal(/\bfn unused\b/u.test(rustSourceText(result)), false, "the unused capturing implementation is not emitted");
  });

  test(`consumed conditional enum members retain their actual nominal carrier (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
export enum Value { First = 1, Second = 2 }
export function run(flag: boolean): boolean {
  const selected = flag ? Value.First : Value.Second;
  return selected === (flag ? Value.First : Value.Second);
}
if (!run(true) || !run(false)) throw new Error("enum composition");
` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message}`).join("; "));
    assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
      "the original consumed enum source reaches native publication without an annotation or erased storage query");
    const { program } = result;
    const ast = program.source.ast;
    const pending = program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts"));
    const conditionals = [];
    while (pending.length !== 0) {
      const node = pending.pop();
      if (ast.is.IsConditionalExpression(node)) conditionals.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
    assert.equal(conditionals.length, 2, "both original consumed choices retain their checked source nodes");
    for (const node of conditionals) {
      const expression = ast.as.AsConditionalExpression(node);
      const resultCarrier = program.records.runtimeCarrier.get(node)?.carrier;
      const trueCarrier = program.records.runtimeCarrier.get(expression.WhenTrue)?.carrier;
      const falseCarrier = program.records.runtimeCarrier.get(expression.WhenFalse)?.carrier;
      assert.equal(rustSourceTypeCarrierValue(resultCarrier)?.shape === "enum", true,
        "the selected result is the native enum, never the checker's numeric approximation");
      assert.equal(rustTargetTypeRefEquals(resultCarrier, trueCarrier), true, "the true branch retains the same exact enum carrier");
      assert.equal(rustTargetTypeRefEquals(resultCarrier, falseCarrier), true, "the false branch retains the same exact enum carrier");
    }
  });

  test(`native conditional selection preserves scalar domains, expected types, throws and evaluation order (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: selected, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
enum Value { First = 1, Second = 2 }
let sequence = 0;
function condition(flag: boolean): boolean { sequence = sequence * 10 + 1; return flag; }
function first(): Value { sequence = sequence * 10 + 2; return Value.First; }
function second(): Value { sequence = sequence * 10 + 3; return Value.Second; }
function failure(): Value { sequence = sequence * 10 + 4; throw new Error("selected conditional"); }
export function explicit(flag: boolean, value: int32): number { return flag ? value : 7; }
export function run(flag: boolean): boolean {
  sequence = 0;
  const nominal = condition(flag) ? first() : second();
  if (sequence !== (flag ? 12 : 13) || nominal !== (flag ? Value.First : Value.Second)) return false;
  const annotated: Value = flag ? Value.First : Value.Second;
  const bitwise = flag ? (Value.First | Value.Second) : Value.First;
  const small: int32 = 23;
  const numeric = flag ? small : 7;
  const truth = flag ? true : false;
  const text = flag ? "left" : "right";
  const absent = flag ? null : undefined;
  const optional = flag ? small : undefined;
  const nominalOptional = flag ? Value.First : undefined;
  if (annotated !== nominal || bitwise !== (flag ? (Value.First | Value.Second) : Value.First)
    || numeric !== (flag ? 23 : 7) || explicit(flag, small) !== (flag ? 23 : 7)
    || truth !== flag || text !== (flag ? "left" : "right") || absent !== null || absent !== undefined
    || (flag ? optional !== 23 : optional !== undefined)
    || (flag ? nominalOptional !== Value.First : nominalOptional !== undefined)) return false;
  sequence = 0;
  let caught = false;
  try {
    const selected = condition(flag) ? first() : failure();
    if (!flag || selected !== Value.First) return false;
  } catch {
    if (flag) return false;
    sequence = sequence * 10 + 5;
    caught = true;
  }
  return caught === !flag && sequence === (flag ? 12 : 145);
}
if (!run(true) || !run(false)) throw new Error("conditional native domains");
` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message}`).join("; "));
    assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
      "the whole native conditional matrix reaches one published program");
    const { program } = result;
    const ast = program.source.ast;
    const pending = program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts"));
    let numeric;
    let explicit;
    while (pending.length !== 0) {
      const node = pending.pop();
      const name = Node_Name(ast, node);
      const text = name === undefined ? undefined : ast.text(name);
      if (ast.is.IsVariableDeclaration(node) && text === "numeric") numeric = node;
      if (ast.is.IsFunctionDeclaration(node) && text === "explicit") explicit = node;
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
    assert.equal(numeric !== undefined && explicit !== undefined, true, "the exact inferred and authored numeric declarations are present");
    assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(numeric)?.carrier,
      rustSourcePrimitiveTargetType("int32")), true, "a whole integer literal uses its actual native integer sibling");
    assert.equal(rustTargetTypeRefEquals(program.records.sourceCallableReturn.get(explicit)?.returnCarrier,
      rustSourcePrimitiveTargetType("float64")), true, "an authored number result remains its explicit floating contract");
    validateGeneratedProject(`conditional-native-domains-${surface}`, result.artifacts, { run: true });
  });

  test(`a consumed conditional does not erase the explicit enum-to-number refusal (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
enum Value { First = 1, Second = 2 }
export function run(flag: boolean): number {
  const selected: number = flag ? Value.First : Value.Second;
  return selected;
}` } });
    assert.equal(result.diagnostics.length, 1, "the shared enum use owns one precise explicit-context rejection");
    assert.equal(result.diagnostics[0]?.code, "TSONIC_ENUM_NUMERIC_USE_NOT_SUPPORTED", "native branch selection does not grant enum numeric conversion");
    assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
      "the rejected explicit context has no sealed program, plan or output");
  });

  for (const value of ["3.5e38", "-3.5e38"]) {
    test(`a consumed conditional preserves the ${value} float32 refusal (${surface})`, () => {
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
import type { float32 } from "@tsonic/core/types.js";
export function run(flag: boolean): float32 {
  return flag ? (${value} as float32) : 0;
}` } });
      assert.equal(result.diagnostics.some(issue => issue.code === "RUST_ASSERTION_UNSUPPORTED"), true,
        "actual branch selection preserves native float32 range validation");
      assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
        "a consumed invalid branch cannot receive a discarded-unit or widened expected carrier");
    });
  }

  for (const [wrapper, expression] of [
    ["bare", "LAMBDA"],
    ["parenthesized", "(LAMBDA)"],
    ["as", "(LAMBDA as (() => number))"],
    ["satisfies", "(LAMBDA satisfies (() => number))"],
    ["non-null", "(LAMBDA)!"],
    ["type-assertion", "(<(() => number)>LAMBDA)"],
    ["void", "void LAMBDA"],
    ["conditional", 'key === "selected" ? LAMBDA : LAMBDA'],
  ]) {
    const lambda = '((): number => { const value = { [key]: 7 }; return 1; })';
    test(`discarded ${wrapper} callable bodies are never admitted (${surface})`, () => {
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(key: string): number {
  ${expression.replaceAll("LAMBDA", lambda)};
  return 42;
}` } });
      assert.equal(result.diagnostics.length, 0, "only wrapper evaluation, not a discarded body, requires native evidence");
      assert.equal(result.artifacts.some(artifact => String(artifact.path).endsWith(".rs")), true,
        "discarding the callable does not discard the program");
    });
  }

  test(`an actually invoked callable retains the same native key refusal (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(key: string): number {
  return (() => { const value = { [key]: 7 }; return 1; })();
}` } });
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN"), true,
      "the actual called inverse still requires the exact native key contract");
    assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
      "a required invalid callable has no partial native output");
  });

  for (const [wrapper, expression] of [
    ["as", "(LAMBDA as (() => number))"],
    ["type-assertion", "(<(() => number)>LAMBDA)"],
    ["conditional", 'key === "selected" ? LAMBDA : LAMBDA'],
  ]) {
    test(`consumed ${wrapper} callable retains its native body obligations (${surface})`, () => {
      const lambda = '((): number => { const value = { [key]: 7 }; return 1; })';
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(key: string): number {
  const callback = ${expression.replaceAll("LAMBDA", lambda)};
  return callback();
}` } });
      assert.equal(result.diagnostics.some(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN"), true,
        "a consumed callable still requires its actual native body and exact field key");
      assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
        "consuming the callable never acquires the discarded-unit path");
    });
  }

  test(`discarded absence assertions and conditionals retain the native absence carrier (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(flag: boolean): number {
  (null as null);
  (undefined as undefined);
  flag ? null : undefined;
  return 42;
}` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message}`).join("; "));
    assert.equal(result.program !== undefined && result.plan !== undefined, true,
      "native absence remains representable without pretending it is erased callable unit");
    const program = result.program;
    const ast = program.source.ast;
    const pending = [...program.sourceFiles];
    const expressions = [];
    while (pending.length !== 0) {
      const node = pending.pop();
      if (ast.is.IsAsExpression(node) || ast.is.IsConditionalExpression(node)) expressions.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
    assert.equal(expressions.length, 3, "both absence assertions and their conditional remain checked expressions");
    for (const expression of expressions) {
      const carrier = program.records.runtimeCarrier.get(expression)?.carrier;
      assert.equal(rustTargetTypeRefEquals(carrier, rustAbsenceTargetType()), true,
        "the actual discarded absence value keeps the canonical native absence carrier");
      assert.equal(rustTargetTypeRefEquals(carrier, rustUnitTargetType()), false,
        "native absence is never promoted to empty-tuple erasure");
    }
  });

  for (const value of ["3.5e38", "-3.5e38"]) {
    test(`discarded ${value} as float32 retains its exact numeric refusal (${surface})`, () => {
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
import type { float32 } from "@tsonic/core/types.js";
export function run(): number {
  ${value} as float32;
  return 42;
}` } });
      assert.equal(result.diagnostics.some(issue => issue.code === "RUST_ASSERTION_UNSUPPORTED"), true,
        "discarding a numeric result does not turn an unsupported native conversion into unit identity");
      assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
        "the native numeric assertion still refuses before publication");
    });
  }

  test(`discarded callable wrappers preserve exact condition and numeric operand effects (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: selected, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
let conditionCalls = 0;
let operandTotal = 0;
function condition(flag: boolean): boolean { conditionCalls += 1; return flag; }
function effect(value: number): number { operandTotal += value; return value; }
export function run(flag: boolean, key: string): boolean {
  conditionCalls = 0;
  operandTotal = 0;
  condition(flag)
    ? ((): number => { const value = { [key]: 7 }; return 1; })
    : ((): number => { const value = { [key]: 7 }; return 1; });
  (((): number => { const value = { [key]: 7 }; return 1; }) as (() => number));
  (<(() => number)>(() => { const value = { [key]: 7 }; return 1; }));
  const selectedValue = condition(flag) ? 3 : 7;
  const effectValue = condition(flag) ? effect(5) : effect(11);
  (effect(13) as number);
  (<number>effect(17));
  return conditionCalls === 3 && operandTotal === (flag ? 35 : 41)
    && selectedValue === (flag ? 3 : 7) && effectValue === (flag ? 5 : 11);
}
export function main(): void {
  if (!run(true, "runtime") || !run(false, "runtime")) throw new Error("discarded callable effects");
}
main();
` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message}`).join("; "));
    assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
      "the complete effectful source has a published native program and plan");
    validateGeneratedProject(`discarded-callable-effects-${surface}`, result.artifacts, { run: true });
  });

  for (const [kind, prelude, body] of [
    ["receiver", "", "class Cell { value = 1; read = (): number => this.value; } const cell = new Cell(); cell.read();"],
    ["resource", "", "class Resource { constructor() {} [Symbol.dispose](): void {} } using resource = new Resource();"],
    ["future", "", "async function pending(): Promise<number> { return 1; } const value = pending();"],
    ["error-region", "", 'try { throw new Error("unused"); } catch {} finally {}'],
    ["computed-binding", "", "const values: Record<string, number> = { value: 1 }; const { [key]: value } = values;"],
  ]) {
    test(`composite erased ${kind} work has no native admission (${surface})`, () => {
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
${prelude}
export function run(key: string): number {
  function unused(): number { ${body} const overflow = 1e400; return 1; }
  return 42;
}` } });
      assert.equal(result.diagnostics.length, 0, "the entire unused native subtree is excluded before all native owners");
    });

    test(`composite required ${kind} work keeps its native range refusal (${surface})`, () => {
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
${prelude}
export function run(key: string): number {
  function required(): number { ${body} const overflow = 1e400; return 1; }
  return required();
}` } });
      assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_NUMERIC_LITERAL_NOT_FINITE"), true,
        "a required body keeps the original precise native range rule");
      assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
        "required invalid syntax is refused before native publication");
    });
  }
}
