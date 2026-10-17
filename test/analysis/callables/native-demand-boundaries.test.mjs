import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";
import { Node_Name, createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";

const surfaces = [["native", []], ["js", ["js"]]];

for (const [surface, selected] of surfaces) {
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
