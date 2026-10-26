import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram, TryStatement_CatchClause, TryStatement_TryBlock } from "@tsonic/target-api/source";
import { analyzeRustErrorRegions, selectRustErrorRegion } from "../../../dist/analysis/errors/regions.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

const sourceText = `
function fail(label: string): never { throw label; }
function mark(_label: string): void {}
function consume(_value: never, _body: () => void): void {}
export function local(): void {
  try {
    fail("local");
    function deferred(): void { fail("deferred"); }
    consume(fail("eager"), () => { fail("inline"); });
  } catch { mark("catch"); }
  finally { mark("finally"); }
}
export function finallyOnly(): void {
  try { fail("finally-only"); }
  finally { mark("finally-only-cleanup"); }
}
export function nested(): void {
  try {
    try { fail("inner"); }
    catch { fail("inner-catch"); }
    finally { mark("inner-finally"); }
  } catch { mark("outer-catch"); }
}
export function outward(): void {
  try { fail("outward-protected"); }
  catch { mark("outward-catch"); }
  fail("outward-escape");
}
try { fail("module-protected"); }
catch { mark("module-catch"); }
mark("module-outside");
`;

function fixture({ missingProtected = false, moduleFallible = false, excludedLabel } = {}) {
  const fileName = "/src/index.ts";
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: { [fileName]: sourceText },
    compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, "the exact lexical scopes are checked source, not a fake parent graph");
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile(fileName);
  assert.equal(file !== undefined, true, "the original checked source owner is present");
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(file);
  const functions = new Map(nodes.filter(node => source.ast.is.IsFunctionDeclaration(node)).map(node =>
    [source.ast.text(source.ast.name(node)), node]));
  const calls = new Map(nodes.filter(node => source.ast.is.IsCallExpression(node)).flatMap(node => {
    const label = source.ast.arguments(node)[0];
    return label !== undefined && source.ast.is.IsStringLiteral(label) ? [[source.ast.text(label), node]] : [];
  }));
  const effects = new Map([[file, Object.freeze({ localErrors: false, nativeErrors: Object.freeze([]) })]]);
  const fallible = new Set(["fail", "deferred", "finallyOnly", "outward"]);
  for (const [name, node] of functions) effects.set(node,
    Object.freeze({ localErrors: fallible.has(name), nativeErrors: Object.freeze([]) }));
  const callbacks = nodes.filter(node => source.ast.is.IsArrowFunction(node));
  for (const node of callbacks) effects.set(node,
    Object.freeze({ localErrors: true, nativeErrors: Object.freeze([]) }));
  for (const node of nodes.filter(candidate => source.ast.is.IsTryStatement(candidate))) {
    const body = TryStatement_TryBlock(source.ast, node);
    if (missingProtected && body === source.ast.parent(source.ast.parent(calls.get("local")))) continue;
    effects.set(body, Object.freeze({ localErrors: true, nativeErrors: Object.freeze([]) }));
  }
  let sourceQueriesClosed = false;
  const ast = { ...source.ast,
    getSourceFile(node) {
      assert.equal(sourceQueriesClosed, false, "completed node-local reads never query source files");
      return source.ast.getSourceFile(node);
    },
    forEachChild(node, visitor) {
      assert.equal(sourceQueriesClosed, false, "completed node-local reads never walk source children");
      return source.ast.forEachChild(node, visitor);
    },
  };
  const empty = Object.freeze({ get: () => undefined });
  const component = Object.freeze({ componentId: "root", root: true, errorDomain: "runtime" });
  const input = { ast, sourceFiles: [file],
    isNativeNode: node => node !== calls.get(excludedLabel),
    nativeTasks: [], binaryHooks: [], promiseBodies: { objects: new Map(), declarations: new Map() },
    records: { errorEffects: { get: node => effects.get(node) }, asyncFunction: empty, sourceCallableReturn: empty,
      sourceErrorEffects: empty, contextualValueConversion: empty, projectCallableAdapters: empty, targetOperation: empty },
    names: { nameForDeclaration: () => undefined, functionNameForDeclaration: () => undefined,
      callableValueNameForDeclaration: () => undefined },
    callables: { native: { inputs: [] }, nativeGenericProducers: { errorAritiesFor: () => [] },
      frames: { definitions: Object.freeze([]) } }, producers: { producers: [] }, definitions: emptyRustTypeDefinitions,
    components: { rootComponentId: "root", componentForFile: () => component, forComponent: () => component },
  };
  const selected = analyzeRustErrorRegions(input);
  assert.equal(selected.kind, "resolved", "the existing error-region owner selects the original intrinsic effects");
  const regions = selected.value;
  const root = Object.freeze({ modules: Object.freeze([]), asynchronous: false, error: Object.freeze({ kind: "infallible" }) });
  const lifecycle = regions.lifecycleFor([root], Object.freeze({ kind: "physical", domain: "runtime" }));
  assert.equal(lifecycle.kind, "resolved", "the actual lifecycle owner runs before final publication");
  const moduleSelection = moduleFallible ? selectRustErrorRegion(file,
    Object.freeze({ localErrors: true, nativeErrors: Object.freeze([]) }), input, false) : undefined;
  if (moduleSelection !== undefined) assert.equal(moduleSelection.kind, "resolved", "the initializer keeps its selected native region");
  const module = moduleSelection === undefined ? undefined : Object.freeze({ sourceFile: file, identity: fileName,
    asynchronous: false, region: moduleSelection.value });
  const initialization = Object.freeze({ entrySourceFile: file, root, workers: Object.freeze([]),
    binary: Object.freeze({ lifecycle: lifecycle.value, sources: Object.freeze([]) }),
    moduleFor: candidate => candidate === file ? module : undefined, workerFor: () => undefined });
  return { ast: source.ast, file, functions, callbacks, calls, regions, module,
    complete: () => regions.complete(initialization), closeSourceQueries: () => { sourceQueriesClosed = true; } };
}

test("one local catalog preserves catching protection, catch/finally outward scope and nested protection", () => {
  const current = fixture();
  const catalog = current.complete();
  const call = label => current.calls.get(label);
  const localBody = current.ast.parent(current.ast.parent(call("local")));
  assert.equal(catalog.localFor(call("local")) === catalog.get(localBody), true, "the protected call uses the exact existing body selection");
  assert.equal(catalog.localFor(call("local"))?.kind, "package", "a catching body remains fallible inside an infallible callable");
  assert.equal(catalog.get(current.functions.get("local"))?.kind, "infallible", "local protection never makes its outward callable fallible");
  for (const label of ["catch", "finally"]) assert.equal(catalog.localFor(call(label)) === catalog.get(current.functions.get("local")),
    true, `${label} is outside the try body's own protection`);
  const innerBody = current.ast.parent(current.ast.parent(call("inner")));
  const innerTry = current.ast.parent(innerBody);
  const outerBody = current.ast.parent(innerTry);
  assert.equal(catalog.localFor(call("inner")) === catalog.get(innerBody), true, "nested protection selects the nearest catching body");
  for (const label of ["inner-catch", "inner-finally"]) assert.equal(catalog.localFor(call(label)) === catalog.get(outerBody),
    true, `${label} remains protected by the outer catch only`);
  assert.equal(catalog.localFor(call("outer-catch")) === catalog.get(current.functions.get("nested")), true,
    "a rethrow leaves its current catch and reaches the actual enclosing region");
});

test("finally-only, outward fallibility and nested callable boundaries retain distinct owners", () => {
  const current = fixture();
  const catalog = current.complete();
  for (const label of ["finally-only", "finally-only-cleanup"]) assert.equal(catalog.localFor(current.calls.get(label)) ===
    catalog.get(current.functions.get("finallyOnly")), true, `${label} is not protected by a finally-only body`);
  assert.equal(catalog.localFor(current.calls.get("deferred")) === catalog.get(current.functions.get("deferred")), true,
    "a callable declared inside a protected body never borrows that outer protection");
  assert.equal(catalog.localFor(current.calls.get("deferred")) === catalog.localFor(current.calls.get("local")), false,
    "a deferred invocation's body and its declaration-site try are independent execution owners");
  const outward = catalog.get(current.functions.get("outward"));
  assert.equal(outward?.kind, "package", "the original outward-fallible positive is retained");
  assert.equal(catalog.localFor(current.calls.get("outward-catch")) === outward, true, "a catch uses actual outward transport");
  assert.equal(catalog.localFor(current.calls.get("outward-escape")) === outward, true, "a later escaping operation retains its own selected ABI");
  assert.equal(catalog.localFor(current.calls.get("outward-protected")) === outward, false,
    "a local protected body remains a distinct exact region even in a fallible callable");
});

test("eager argument evaluation and an inline deferred body keep distinct exact regions", () => {
  const current = fixture();
  const catalog = current.complete();
  const protectedRegion = catalog.localFor(current.calls.get("local"));
  const callback = current.callbacks[0];
  assert.equal(catalog.localFor(current.calls.get("eager")) === protectedRegion, true,
    "ordinary argument evaluation remains protected by the surrounding try body");
  assert.equal(catalog.localFor(current.calls.get("inline")) === catalog.get(callback), true,
    "the inline arrow body uses its own selected execution owner");
  assert.equal(catalog.localFor(current.calls.get("inline")) === protectedRegion, false,
    "declaration-site protection never becomes a deferred callback's handler");
});

test("module-local completion uses the finalized initializer rather than an earlier source-file selection", () => {
  const current = fixture({ moduleFallible: true });
  const catalog = current.complete();
  assert.equal(catalog.get(current.file)?.kind, "infallible", "the earlier source effects remain unchanged");
  for (const label of ["module-catch", "module-outside"]) assert.equal(catalog.localFor(current.calls.get(label)) === current.module.region,
    true, `${label} consumes the final initializer selected before the catalog seal`);
  assert.equal(catalog.localFor(current.calls.get("module-protected")) === current.module.region, false,
    "module initialization still preserves the inner protected-body owner");
});

test("completed local-region reads are immutable pure lookups and never publish non-native subjects", () => {
  const current = fixture({ excludedLabel: "module-outside" });
  assert.equal(Object.hasOwn(current.regions, "localFor"), false, "the pre-initialization catalog exposes no incomplete local reader");
  const catalog = current.complete();
  const subject = current.calls.get("local");
  const selection = catalog.localFor(subject);
  current.closeSourceQueries();
  assert.equal(catalog.localFor(subject) === selection, true, "repeated reads preserve exact selected identity without source work");
  assert.equal(Object.isFrozen(catalog) && Object.isFrozen(selection), true, "the sole final publication is immutable");
  assert.equal(catalog.localFor(current.calls.get("module-outside")) === undefined, true, "excluded source subjects receive no invented native region");
  assert.equal(catalog.localFor({}) === undefined, true, "foreign subjects cannot inherit an ambient region");
  assert.throws(current.complete, /seals once/u, "the complete catalog cannot be published twice");
});

test("missing selected protected-body evidence cannot be finalized as an infallible or ambient region", () => {
  const current = fixture({ missingProtected: true });
  assert.throws(current.complete, /protected try body requires its completed local error-region evidence/u,
    "an absent actual protected selection is an owner invariant, not a permissive fallback");
});
