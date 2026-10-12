import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram, sourceProjectFiles } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createRustSession, checkRustSession } from "../../helpers/rust-session.mjs";
import { createRustRetainedEnvironmentQueries } from "../../../dist/policy/ownership/retained-environment-queries.js";
import { rustRetainedEnvironment } from "../../../dist/policy/ownership/retained-environments.js";
import { emptyRustLifetimeIndex } from "../../../dist/target-model/lifetimes/index.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";

function fixture(text, configure = input => input, maximumSteps) {
  const checked = checkRustSession(createRustSession({ surfaces: ["js"], files: { "index.ts": text } }));
  const source = createTargetSourceProgram(checked);
  const sourceStorage = createSourceStorageQuery(source, sourceProjectFiles(checked));
  assert.equal(sourceStorage.failureReason(), undefined);
  const input = configure({ source, sourceStorage, sourceLifetimes: emptyRustLifetimeIndex });
  const queries = createRustRetainedEnvironmentQueries(input, maximumSteps);
  const declarations = new Map(sourceStorage.nodes.filter(node => source.ast.is.IsFunctionDeclaration(node))
    .map(node => [source.ast.text(source.ast.name(node)), node]));
  return { ...input, queries, declarations };
}

const suspended = `
export async function outer(callback: () => number, unused: () => number): Promise<number> {
  function helper(): number { return callback(); }
  return helper();
}
`;

test("suspended retention uses checked nested-function capture evidence and excludes unused parameters", () => {
  const { source, queries, declarations } = fixture(suspended);
  const owner = declarations.get("outer");
  const parameters = source.ast.parameters(owner);
  const uses = source.navigation.parameterUseSummary(parameters[0]);
  assert.equal(uses.captured, true);
  assert.equal(uses.uses.some(use => use.captured && use.role === "call-target"), true);
  const selected = queries.environmentFor(owner);
  assert.equal(selected.kind, "selected");
  assert.equal(selected.environment.parameters.length, 1);
  assert.equal(selected.environment.parameters[0] === parameters[0], true);
  assert.equal(queries.suspendedParametersFor(owner)[0] === parameters[0], true);
  assert.equal(Object.isFrozen(selected.environment.parameters), true);
});

test("retention distinguishes type-only parameter uses from evaluated default and body uses", () => {
  const { source, queries, declarations } = fixture(`
export async function outer(typeOnly: () => number, callback: () => number, value = callback()): Promise<number> {
  type Signature = typeof typeOnly;
  return value;
}
`);
  const owner = declarations.get("outer");
  const parameters = source.ast.parameters(owner);
  const retained = queries.suspendedParametersFor(owner);
  assert.equal(retained.length, 2);
  assert.equal(retained[0] === parameters[1], true);
  assert.equal(retained[1] === parameters[2], true);
});

test("declaration use evidence and lexical storage queries are memoized independently of selected carriers", () => {
  let parameterQueries = 0;
  let producerQueries = 0;
  const context = fixture(`${suspended}
export function returned(callback: () => number): () => number { return () => callback(); }
`, input => ({ ...input, source: { ...input.source, navigation: { ...input.source.navigation,
    parameterUseSummary(parameter) { parameterQueries += 1; return input.source.navigation.parameterUseSummary(parameter); },
  } }, sourceStorage: { ...input.sourceStorage,
    storageProducersFor(...arguments_) { producerQueries += 1; return input.sourceStorage.storageProducersFor(...arguments_); },
  } }));
  const outer = context.declarations.get("outer");
  const returned = context.declarations.get("returned");
  const first = context.queries.environmentFor(outer);
  const second = context.queries.environmentFor(returned);
  assert.equal(first.kind, "selected");
  assert.equal(second.kind, "selected");
  for (let index = 0; index < 1_000; index += 1) {
    assert.equal(context.queries.environmentFor(outer) === first, true);
    assert.equal(context.queries.environmentFor(returned) === second, true);
  }
  assert.equal(parameterQueries, 2);
  assert.equal(producerQueries, 1);
  const scalar = { kind: "source-primitive", name: "float64" };
  const callback = rustCallableTargetType([], scalar);
  const policy = { ...context, ast: context.source.ast, retainedEnvironments: context.queries };
  assert.equal(rustRetainedEnvironment(outer, [scalar, scalar], policy).kind, "none");
  assert.equal(rustRetainedEnvironment(outer, [callback, callback], policy).kind, "selected");
  assert.equal(parameterQueries, 2);
});

test("retention fails closed on missing checked uses and finite work exhaustion without widening lifetimes", () => {
  for (const maximumSteps of [0, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, 1]) {
    const { queries, declarations } = fixture(suspended, undefined, maximumSteps);
    const owner = declarations.get("outer");
    const selected = queries.environmentFor(owner);
    assert.equal(selected.kind, "unresolved", String(maximumSteps));
    assert.equal(queries.environmentFor(owner) === selected, true);
  }
  const { queries, declarations } = fixture(suspended, input => ({ ...input,
    source: { ...input.source, navigation: { ...input.source.navigation, parameterUseSummary: () => undefined } },
  }));
  assert.equal(queries.environmentFor(declarations.get("outer")).kind, "unresolved");
});
