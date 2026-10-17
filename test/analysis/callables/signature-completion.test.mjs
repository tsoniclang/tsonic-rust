import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { rustOperationContext, rustResolutionContext } from "../../../dist/analysis/program/walk.js";
import { finalizeRustCallableSignature, resolveRustCallableSignatureCarrier } from "../../../dist/analysis/callables/signature-query.js";
import * as callableSignatures from "../../../dist/analysis/callables/signature-query.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { closedMetadataEquals } from "../../../dist/target-model/metadata/closed-data.js";
import { recordClassSignatureFacts, recordInterfaceFacts } from "../../../dist/analysis/declarations/project-types.js";
import { resolveRustCallableEnvironment } from "../../../dist/policy/types/resolution/callable-environments.js";
import { resolveReferencedDeclarationType } from "../../../dist/policy/types/resolution/tuples.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { selectedRustCheckedCallInputCarrier } from "../../../dist/analysis/operations/provider/calls/input-contract.js";
import { selectRustClosedCallableInputs } from "../../../dist/analysis/callables/contextual-inputs.js";

test("source callable captures read their completed native input value and never replace a missing ABI with checked primitive evidence", () => {
  const { context, walk } = analyzeRustOperations(`
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export function step<Region extends Life>(value: Ref<int32, Region>): int32 {
  const read = (): int32 => load(value);
  return read();
}`, { surfaces: [] });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
  const closure = context.sourceStorage.nodes.find(node => context.ast.is.IsArrowFunction(node));
  assert.equal(declaration !== undefined && closure !== undefined, true, "the actual native capture and owner are checked");
  const parameter = context.ast.parameters(declaration)[0];
  const abi = context.records.sourceParameterAbi.get(parameter);
  assert.equal(abi?.valueCarrier.kind === "reference" && abi.valueCarrier.lifetime?.name === "Region", true,
    "the source input ABI preserves the authored native reference");
  const resolution = rustResolutionContext(walk, closure);
  const environment = resolveRustCallableEnvironment(closure, resolution, walk.operationOptions, new Set());
  assert.equal(environment?.length === 1 && environment[0] === abi.valueCarrier, true,
    "source retention consumes the exact completed body value, not the checked numeric alias");
  const missing = { ...resolution, records: createRustRecordFixture({ sourceParameterAbi: {
    get: node => node === parameter ? undefined : context.records.sourceParameterAbi.get(node),
  } }, context.records) };
  assert.equal(resolveRustCallableEnvironment(closure, missing, { ...walk.operationOptions,
    callableParameterCarriers: () => undefined }, new Set()) === undefined, true,
  "an unfinished input stage is unresolved rather than a static primitive capture");
  assert.equal(resolveRustCallableEnvironment(closure, missing, walk.operationOptions, new Set()) === undefined, true,
    "even a purported ready stage cannot substitute a missing canonical input record");
});

for (const [name, parameter] of [
  ["object", "{ value }: { value: Ref<int32, Region> }"],
  ["tuple", "[value]: [Ref<int32, Region>]"],
]) test(`captured ${name} binding elements consume their canonical native binding projection`, () => {
  const { context, walk } = analyzeRustOperations(`
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export function step<Region extends Life>(${parameter}): int32 {
  const read = (): int32 => load(value);
  return read();
}`, { surfaces: [] });
  const closure = context.sourceStorage.nodes.find(node => context.ast.is.IsArrowFunction(node));
  assert.equal(closure !== undefined, true, name + ": actual captured callable");
  const lexical = context.retainedEnvironments.lexicalFor(closure);
  assert.equal(lexical.kind, "resolved", name + ": checked lexical capture inventory");
  const capture = lexical.captures.find(captured => context.ast.is.IsBindingElement(captured.declaration));
  assert.equal(capture !== undefined, true, name + ": exact authored binding declaration");
  const projection = context.records.bindingProjection.get(capture.declaration);
  assert.equal(projection?.bindingCarrier.kind === "reference" && projection.bindingCarrier.lifetime?.name === "Region", true,
    name + ": the existing binding owner preserves the actual native region");
  const masked = new Set([capture.declaration, ...capture.references]);
  const resolution = { ...rustResolutionContext(walk, closure), records: createRustRecordFixture({ runtimeCarrier: {
    get: node => masked.has(node) ? undefined : context.records.runtimeCarrier.get(node),
  } }, context.records) };
  const selected = resolveRustCallableEnvironment(closure, resolution, walk.operationOptions, new Set());
  assert.equal(selected?.length === 1 && selected[0] === projection.bindingCarrier, true,
    name + ": source retention reads the one completed binding projection, never erased checked reference evidence");
  const missing = { ...resolution, records: createRustRecordFixture({ bindingProjection: {
    get: node => node === capture.declaration ? undefined : context.records.bindingProjection.get(node),
  } }, resolution.records) };
  assert.equal(resolveRustCallableEnvironment(closure, missing, walk.operationOptions, new Set()) === undefined, true,
    name + ": missing required projection remains unresolved even when the checked primitive is available");
});

function inputFixture(source, select = (ast, node) => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "step") {
  assert.equal(typeof callableSignatures.finalizeRustCallableParameterAbis, "function", "the actual signature lifecycle exposes its input stage");
  const { context, walk } = analyzeRustOperations(source, { surfaces: ["js"] });
  const declaration = context.sourceStorage.nodes.find(node => select(context.ast, node));
  assert.equal(declaration !== undefined, true, "the checked source owns the selected callable");
  const parameters = context.ast.parameters(declaration);
  const inputs = new Set(parameters);
  const inherited = createRustRecordFixture({
    sourceParameterAbi: { get: node => inputs.has(node) ? undefined : context.records.sourceParameterAbi.get(node) },
    ...Object.fromEntries(["asyncFunction", "generator", "sourceCallableReturn"].map(family =>
      [family, { get: node => node === declaration ? undefined : context.records[family].get(node) }])),
  }, context.records);
  const current = createRustCarrierProbe({ ...walk, context: { ...context,
    records: createRustProgramRecordBuilder(context.typeDefinitions, inherited) } });
  return { current, declaration, parameters, original: context.records,
    complete: current => callableSignatures.finalizeRustCallableParameterAbis(current, declaration) };
}

for (const [name, source, select, forms] of [
  ["declaration", "export function step(value: number): number { return value; }", undefined, ["required"]],
  ["arrow", "export const step = (value: number): number => value;", (ast, node) => ast.is.IsArrowFunction(node), ["required"]],
  ["function expression", "export const step = function(value: number): number { return value; };", (ast, node) => ast.is.IsFunctionExpression(node), ["required"]],
  ["destructuring/default/rest", "export function step({ value }: { value: number }, count: number = 1, ...rest: number[]): number { return value + count; }", undefined, ["required", "default", "rest"]],
  ["optional", "export function step(value?: number): number { return value ?? 7; }", undefined, ["optional"]],
  ["no inputs", "export function step(): number { return 7; }", undefined, []],
]) test(`the ${name} input stage completes actual formal ABIs without selecting its owner result`, () => {
  const input = inputFixture(source, select);
  const expected = input.parameters.map(parameter => input.current.sourceCallableAbi.resolveParameterAbi(
    parameter, rustResolutionContext(input.current, parameter), input.current.operationOptions));
  assert.equal(expected.every(abi => abi !== undefined), true, name + ": the existing intrinsic formal owner admits the inputs");
  let ownerQueries = 0;
  const current = { ...input.current, context: { ...input.current.context,
    semanticsFor(node) {
      const semantics = input.current.context.semanticsFor(node);
      return node !== input.declaration ? semantics : { ...semantics, types: { ...semantics.types,
        declarationSignatureInfo() { ownerQueries++; throw new Error("input admission queried its owner's result signature"); },
        expressionType(expression) {
          if (expression === input.declaration) { ownerQueries++; throw new Error("input admission queried its owner's complete callable type"); }
          return semantics.types.expressionType(expression);
        },
      } };
    },
  } };
  const actual = input.complete(current);
  assert.equal(actual !== undefined, true, name + ": the actual input stage completes");
  assert.equal(actual.length, forms.length, name + ": source formals are not expanded invocation arguments");
  for (const [index, abi] of actual.entries()) {
    assert.equal(abi.form, forms[index], name + ": form " + index);
    assert.equal(closedMetadataEquals(abi, expected[index]), true, name + ": exact existing ABI " + index);
    assert.equal(current.context.records.sourceParameterAbi.get(input.parameters[index]) === abi, true,
      name + ": one admitted canonical input " + index);
  }
  assert.equal(ownerQueries, 0, name + ": no owner return query");
  for (const family of ["asyncFunction", "generator", "sourceCallableReturn"])
    assert.equal(current.context.records[family].get(input.declaration) === undefined, true, name + ": no " + family + " publication");
});

for (const [name, source] of [
  ["tuple rest", "export function step(...values: [number, string]): number { return values[0]; }"],
  ["explicit receiver", "export function step(this: { value: number }, offset: number): number { return offset; }"],
]) test(`the ${name} input stage preserves the actual formal ABI owner's disposition`, () => {
  const input = inputFixture(source);
  const expected = input.parameters.map(parameter => input.current.sourceCallableAbi.resolveParameterAbi(
    parameter, rustResolutionContext(input.current, parameter), input.current.operationOptions));
  const actual = input.complete(input.current);
  assert.equal(actual === undefined, expected.some(abi => abi === undefined), name + ": no new effective-argument count rejection");
  if (actual === undefined) {
    for (const parameter of input.parameters) assert.equal(input.current.context.records.sourceParameterAbi.get(parameter) === undefined, true,
      name + ": an unresolved vector publishes no input");
  } else {
    assert.equal(actual.length, input.parameters.length, name + ": one ABI per source formal");
    for (const [index, abi] of actual.entries())
      assert.equal(closedMetadataEquals(abi, expected[index]), true, name + ": unchanged intrinsic ABI " + index);
  }
});

test("input-stage reentrancy is unresolved independently of an active full signature", () => {
  const input = inputFixture("export function step(value: number): number { return value; }");
  const state = { active: true, inputActive: false, completed: new Map(), suspensions: new Map() };
  input.current.callableSignatures.set(input.declaration, state);
  let reentries = 0;
  const current = { ...input.current, sourceCallableAbi: { ...input.current.sourceCallableAbi,
    resolveParameterAbi(...arguments_) {
      reentries++;
      assert.equal(input.complete(current) === undefined, true, "a genuine input dependency remains unresolved");
      return input.current.sourceCallableAbi.resolveParameterAbi(...arguments_);
    },
  } };
  assert.equal(input.complete(current)?.length, 1, "the outer real input stage completes");
  assert.equal(reentries, 1, "a completed input lookup cannot recompute its ABI");
  assert.equal(input.complete(current)?.[0] === current.context.records.sourceParameterAbi.get(input.parameters[0]), true,
    "repeated completion keeps the canonical admitted ABI");
  assert.equal(reentries, 1, "the second read remains a lookup");
  assert.equal(state.active, true, "input completion does not end full result selection");
  assert.equal(state.inputActive, false, "the input guard is released");
  assert.equal(state.completed.size, 0, "input selection publishes no full completion");
  assert.equal(state.suspensions.size, 0, "input selection publishes no suspension");
});

test("an unresolved actual input vector publishes no partial ABIs and can complete when its real input is ready", () => {
  const input = inputFixture("export function step(left: number, right: number): number { return left + right; }");
  let ready = false;
  const current = { ...input.current, sourceCallableAbi: { ...input.current.sourceCallableAbi,
    resolveParameterAbi(parameter, ...arguments_) {
      return !ready && parameter === input.parameters[1] ? undefined
        : input.current.sourceCallableAbi.resolveParameterAbi(parameter, ...arguments_);
    },
  } };
  assert.equal(input.complete(current) === undefined, true, "the actual unresolved formal is not a default ABI");
  for (const parameter of input.parameters) assert.equal(current.context.records.sourceParameterAbi.get(parameter) === undefined, true,
    "the incomplete input vector publishes nothing");
  ready = true;
  assert.equal(input.complete(current)?.length, 2, "only actual readiness permits both admissions");
});

test("the carrier probe's required input callback writes only its own construction records", () => {
  const input = inputFixture("export function step(value: number): number { return value; }");
  const original = input.original.sourceParameterAbi.get(input.parameters[0]);
  const carriers = input.current.operationOptions.callableParameterCarriers(input.declaration);
  const actual = input.current.context.records.sourceParameterAbi.get(input.parameters[0]);
  assert.equal(actual !== undefined && carriers?.length === 1, true, "the probe's own input stage admitted its missing record");
  assert.equal(carriers[0] === actual.parameterCarrier, true, "the callback returns its exact local admitted carrier");
  assert.equal(input.original.sourceParameterAbi.get(input.parameters[0]) === original, true, "the original source walk is untouched");
});

function fixture(inherit, source = "export async function step(value: number): Promise<number> { return value; }", surfaces = ["js"]) {
  const { context, walk } = analyzeRustOperations(source, { surfaces });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
  assert.equal(declaration !== undefined, true);
  const inherited = inherit ? context.records : createRustRecordFixture(Object.fromEntries(
    ["asyncFunction", "generator", "sourceCallableReturn", "retainedEnvironment"].map(family =>
      [family, { get: node => node === declaration ? undefined : context.records[family].get(node) }])), context.records);
  const current = createRustCarrierProbe({ ...walk, context: { ...context,
    records: createRustProgramRecordBuilder(context.typeDefinitions, inherited) } });
  let admissions = 0;
  const records = current.context.records;
  return { declaration, current: { ...current, context: { ...current.context, records: { ...records,
    asyncFunctions: { ...records.asyncFunctions,
      promise(...arguments_) { admissions++; return records.asyncFunctions.promise(...arguments_); },
      native(...arguments_) { admissions++; return records.asyncFunctions.native(...arguments_); },
    },
    generators: { ...records.generators,
      suspend(...arguments_) { admissions++; return records.generators.suspend(...arguments_); },
    },
  } } }, admissions: () => admissions };
}

for (const inherited of [false, true]) test(`complete source signatures reuse ${inherited ? "inherited" : "local"} native suspension facts`, () => {
  const input = fixture(inherited);
  assert.equal(resolveRustCallableSignatureCarrier(input.current, input.declaration) !== undefined, true);
  const suspension = input.current.context.records.asyncFunction.get(input.declaration);
  const result = input.current.context.records.sourceCallableReturn.get(input.declaration);
  assert.equal(suspension !== undefined && result !== undefined, true);
  assert.equal(resolveRustCallableSignatureCarrier(input.current, input.declaration) !== undefined, true);
  assert.equal(input.current.context.records.asyncFunction.get(input.declaration) === suspension, true);
  assert.equal(input.current.context.records.sourceCallableReturn.get(input.declaration) === result, true);
  assert.equal(input.admissions(), inherited ? 0 : 1, "actual native constructor admissions are not query hits");
});

for (const [name, source, surfaces] of [
  ["native future", "export async function step(value: number): Promise<number> { return value; }", []],
  ["generator", "export function* step(value: number): Generator<number, number, number> { yield value; return value; }", []],
  ["async generator", "export async function* step(value: number): AsyncGenerator<number, number, number> { yield value; return value; }", ["js"]],
]) for (const inherited of [false, true]) test(`complete ${name} signatures reuse ${inherited ? "inherited" : "local"} native facts`, () => {
  const input = fixture(inherited, source, surfaces);
  const selected = finalizeRustCallableSignature(input.current, input.declaration);
  assert.equal(selected !== undefined && selected.suspension !== undefined, true);
  assert.equal(finalizeRustCallableSignature(input.current, input.declaration) === selected, true);
  assert.equal(input.admissions(), inherited ? 0 : 1);
  if (name !== "native future") {
    assert.equal(input.current.context.records.asyncFunction.get(input.declaration) === undefined, true,
      "a generator cannot also acquire an ordinary async fact");
    assert.equal(input.current.context.records.generator.get(input.declaration) === selected.suspension, true);
  }
});

test("a completed full signature is a canonical lookup and rejects closed access before metadata", () => {
  const input = fixture(false);
  const selected = finalizeRustCallableSignature(input.current, input.declaration);
  assert.equal(selected !== undefined, true);
  let reads = 0;
  const lookup = { ...input.current, context: { ...input.current.context,
    get ast() { reads++; throw new Error("metadata read during completed lookup"); },
    semanticsFor() { reads++; throw new Error("source selection during completed lookup"); },
  } };
  assert.equal(finalizeRustCallableSignature(lookup, input.declaration) === selected, true);
  assert.equal(resolveRustCallableSignatureCarrier(lookup, input.declaration) === selected.callableValue, true);
  assert.equal(reads, 0);
  input.current.context.records.seal(input.current.context.requiredRecords);
  assert.throws(() => finalizeRustCallableSignature(lookup, input.declaration), /after analysis is sealed/u);
  assert.throws(() => resolveRustCallableSignatureCarrier(lookup, input.declaration), /after analysis is sealed/u);
  assert.equal(reads, 0);
});

test("a differing full parameter ABI cannot be hidden by a completed native signature", () => {
  const input = fixture(false);
  const selected = finalizeRustCallableSignature(input.current, input.declaration);
  assert.equal(selected !== undefined, true);
  assert.throws(() => finalizeRustCallableSignature(input.current, input.declaration, {
    parameterAbis: selected.parameterAbis.map(abi => ({ ...abi, form: "optional" })),
  }), /Conflicting Rust semantic plan 'tsonic.rust.sourceParameterAbi'/u);
  assert.equal(input.admissions(), 1);
  assert.equal(input.current.context.records.sourceCallableReturn.get(input.declaration) === selected.result, true);
});

for (const [name, source] of [
  ["async", "export async function step(value: number): Promise<number> { return value; }"],
  ["generator", "export function* step(value: number): Generator<number, number, number> { yield value; return value; }"],
]) for (const inherited of [false, true]) test(`a different ${name} logical result cannot hide behind ${inherited ? "inherited" : "local"} suspension facts`, () => {
  const input = fixture(inherited, source);
  const complete = finalizeRustCallableSignature(input.current, input.declaration);
  assert.equal(complete !== undefined, true);
  assert.throws(() => finalizeRustCallableSignature(input.current, input.declaration, {
    selectedReturn: { kind: "source-primitive", name: "int32" },
  }), /Conflicting Rust semantic plan/u);
  assert.equal(input.admissions(), inherited ? 0 : 1);
  assert.equal(input.current.context.records.sourceCallableReturn.get(input.declaration) === complete.result, true);
  const request = { selectedReturn: complete.logicalReturn };
  const matching = finalizeRustCallableSignature(input.current, input.declaration, request);
  assert.equal(matching !== undefined, true);
  assert.equal(matching.result === complete.result, true);
  assert.equal(matching.suspension === complete.suspension, true);
  assert.equal(finalizeRustCallableSignature(input.current, input.declaration, request) === matching, true);
  assert.equal(input.admissions(), inherited ? 0 : 1);
});

test("a complete callable keeps its selected logical contract separate from native retained storage", () => {
  const { context, walk } = analyzeRustOperations('import type { int32 } from "@tsonic/core/types.js"; export function step(callback: () => int32): () => int32 { return callback; }', { surfaces: [] });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
  assert.equal(declaration !== undefined, true);
  const current = createRustCarrierProbe(walk);
  const selected = finalizeRustCallableSignature(current, declaration);
  assert.equal(selected !== undefined, true);
  assert.equal(rustTargetTypeRefEquals(selected.logicalReturn, selected.result.returnCarrier), false,
    "a selected logical annotation is not reconstructed from the normalized native fact");
  assert.equal(current.context.records.sourceCallableReturn.get(declaration) === selected.result, true);
  assert.equal(finalizeRustCallableSignature(current, declaration) === selected, true);
});

test("the cached native callable owns immutable argument containers without copying canonical input carriers", () => {
  const input = fixture(false);
  const selected = finalizeRustCallableSignature(input.current, input.declaration);
  assert.equal(selected !== undefined && selected.callableValue !== undefined, true);
  const carrier = selected.callableValue;
  assert.equal(carrier.kind, "target-named");
  const arguments_ = carrier.genericArguments;
  const parameters = arguments_[1].type;
  assert.equal(parameters.kind, "tuple");
  for (const value of [selected, selected.parameterAbis, carrier, arguments_, parameters, parameters.elements])
    assert.equal(Object.isFrozen(value), true);
  assert.equal(parameters.elements[0] === selected.parameterAbis[0].parameterCarrier, true);
  assert.throws(() => { parameters.elements.length = 0; }, TypeError);
  assert.throws(() => { carrier.genericArguments = []; }, TypeError);
  assert.equal(resolveRustCallableSignatureCarrier(input.current, input.declaration) === carrier, true);
  assert.equal(parameters.elements.length, 1);
});

test("class and interface callable orchestration delegates parameter completion to the full owner", () => {
  const { context, walk } = analyzeRustOperations(`
export interface Shape { size(value: number): number; }
export class Square {
  side: number;
  constructor(value: number) { this.side = value; }
  size(value: number): number { return this.side + value; }
  get value(): number { return this.side; }
  set value(value: number) { this.side = value; }
}
`, { surfaces: [] });
  const { ast } = context;
  const current = createRustCarrierProbe(walk);
  const declarations = context.sourceStorage.nodes.filter(node => ast.is.IsClassDeclaration(node) || ast.is.IsInterfaceDeclaration(node));
  const members = context.sourceStorage.nodes.filter(node => ast.is.IsMethodDeclaration(node) || ast.kindName(node) === "KindMethodSignature" ||
    ast.is.IsGetAccessorDeclaration(node) || ast.is.IsSetAccessorDeclaration(node));
  assert.equal(declarations.length, 2);
  assert.equal(members.length, 4);
  for (const member of members) assert.equal(finalizeRustCallableSignature(current, member) !== undefined, true);
  const lookup = { ...current, context: { ...current.context, ast: { ...ast,
    parameters(node) {
      assert.equal(members.includes(node), false, "a completed full callable cannot re-enter outer parameter orchestration");
      return ast.parameters(node);
    },
  } } };
  for (const declaration of declarations) {
    if (ast.is.IsClassDeclaration(declaration)) recordClassSignatureFacts(lookup, declaration);
    else recordInterfaceFacts(lookup, declaration);
  }
  for (const member of members) assert.equal(finalizeRustCallableSignature(lookup, member) !== undefined, true);
});

for (const [name, path] of [
  ["recordFunctionSignatureFacts", "signatures"], ["recordCallableSuspensionFacts", "signatures"],
  ["recordCallableReturnFact", "signatures"], ["recordRustAsyncBodyFacts", "async-results"],
]) test(`the superseded independent ${name} entrypoint is rejected`, async () => {
  const module = new URL(`../../../dist/analysis/callables/${path}.js`, import.meta.url).href;
  const source = `import { ${name} } from ${JSON.stringify(module)};`;
  await assert.rejects(import("data:text/javascript," + encodeURIComponent(source)), /does not provide an export named/u);
});

for (const [surface, surfaces] of [["native", []], ["js", ["js"]]]) {
  for (const [name, source] of [
    ["direct", "function owner(value: boolean): boolean { return value; } export function step(): typeof owner { return owner; }"],
    ["immutable alias", "function owner(value: boolean): boolean { return value; } const alias = owner; export function step(): typeof owner { return alias; }"],
    ["forward reference", "export function step(): typeof owner { return owner; } function owner(value: boolean): boolean { return value; }"],
    ["function expression", "const owner = function(value: boolean): boolean { return value; }; export function step(): typeof owner { return owner; }"],
    ["arrow", "const owner = (value: boolean): boolean => value; export function step(): typeof owner { return owner; }"],
    ["parenthesized alias", "function owner(value: boolean): boolean { return value; } const alias = (owner); export function step(): typeof owner { return (alias); }"],
  ]) test(`${surface} ${name} callable return retains the function value rather than its result annotation`, () => {
    const { program } = analyzeRust({ files: { "index.ts": source }, surfaces });
    const ast = program.source.ast;
    const declaration = program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
      ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "step");
    assert.equal(declaration !== undefined, true, name + ": actual returned function owner");
    const returned = program.records.sourceCallableReturn.get(declaration)?.returnCarrier;
    assert.equal(returned !== undefined, true, name + ": actual completed retained result");
    const signature = rustCallableProtocol(returned);
    assert.equal(signature !== undefined, true, name + ": return is a callable, not bool");
    assert.equal(signature.parameters.length, 1, name + ": full parameter arity preserved");
    assert.equal(signature.parameters[0].kind === "source-primitive" && signature.parameters[0].name === "bool", true,
      name + ": original native input preserved");
    assert.equal(signature.result.kind === "source-primitive" && signature.result.name === "bool", true,
      name + ": bool remains the callable result, not the callable value");
  });

  test(`${surface} referenced function values require their existing canonical signature reader`, () => {
    const { context, walk } = analyzeRustOperations(
      "function owner(value: boolean): boolean { return value; } export function step(value: boolean): boolean { return owner(value); }",
      { surfaces });
    const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
      context.ast.text(context.ast.name(node)) === "owner");
    const reference = context.sourceStorage.nodes.find(node => context.ast.is.IsIdentifier(node) &&
      context.source.navigation.referenceFor(node)?.declaration === declaration);
    assert.equal(declaration !== undefined && reference !== undefined, true, "actual function reference correspondence");
    const resolution = { ...rustResolutionContext(walk, reference), records: createRustRecordFixture({ runtimeCarrier: {
      get: node => node === declaration ? undefined : context.records.runtimeCarrier.get(node),
    } }, context.records) };
    const canonical = walk.operationOptions.callableSignatureCarrier(declaration);
    assert.equal(canonical !== undefined && rustCallableProtocol(canonical) !== undefined, true,
      "the existing callable owner has complete signature evidence");
    let queries = 0;
    const selected = resolveReferencedDeclarationType(reference, resolution, { ...walk.operationOptions,
      callableSignatureCarrier(subject) {
        queries++;
        assert.equal(subject === declaration, true, "the actual selected declaration owns this request");
        return walk.operationOptions.callableSignatureCarrier(subject);
      },
    });
    assert.equal(selected === canonical, true, "the complete callable carrier is consumed without reconstruction");
    assert.equal(queries, 1, "one canonical reader, not a return-annotation path");
    assert.equal(resolveReferencedDeclarationType(reference, resolution, { ...walk.operationOptions,
      callableSignatureCarrier: () => undefined }) === undefined, true,
    "unavailable function evidence is unresolved rather than its bool return annotation");
  });

  test(`${surface} generic function references cannot turn their result type parameter into a function value`, () => {
    const { context, walk } = analyzeRustOperations(
      "function owner<Value>(value: Value): Value { return value; } export function step(value: boolean): boolean { return owner(value); }",
      { surfaces });
    const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
      context.ast.text(context.ast.name(node)) === "owner");
    const reference = context.sourceStorage.nodes.find(node => context.ast.is.IsIdentifier(node) &&
      context.source.navigation.referenceFor(node)?.declaration === declaration);
    assert.equal(declaration !== undefined && reference !== undefined, true, "actual generic invocation reference");
    const resolution = { ...rustResolutionContext(walk, reference), records: createRustRecordFixture({ runtimeCarrier: {
      get: node => node === declaration ? undefined : context.records.runtimeCarrier.get(node),
    } }, context.records) };
    assert.equal(resolveReferencedDeclarationType(reference, resolution, { ...walk.operationOptions,
      callableSignatureCarrier: () => undefined }) === undefined, true,
    "generic completion remains owned by its canonical reader, never the generic return annotation");
  });

  test(`${surface} a wrong callable signature remains a checked source rejection`, () => {
    assert.throws(() => compileRust({ surfaces, files: { "index.ts":
      "function owner(value: number): number { return value; } export function step(): (value: boolean) => boolean { return owner; }" } }),
    /error TS2322: Type '\(value: number\) => number' is not assignable to type '\(value: boolean\) => boolean'/u,
    "the source checker rejects the exact incompatible signature before target analysis or emission");
  });
}

test("referenced getter, property, parameter and local values retain their value annotations", () => {
  const { context, walk } = analyzeRustOperations(`
export class Box { field: number = 1; get size(): number { return this.field; } }
export function step(value: number): number { const local: number = value; return local; }
export function inspect(box: Box): number { return box.size + box.field; }`, { surfaces: [] });
  for (const name of ["size", "field", "value", "local"]) {
    const reference = context.sourceStorage.nodes.find(node => context.ast.is.IsIdentifier(node) &&
      context.ast.text(node) === name && context.source.navigation.referenceFor(node)?.declaration !== undefined);
    assert.equal(reference !== undefined, true, name + ": checked value reference");
    const declaration = context.source.navigation.referenceFor(reference).declaration;
    const resolution = { ...rustResolutionContext(walk, reference), records: createRustRecordFixture({ runtimeCarrier: {
      get: node => node === declaration ? undefined : context.records.runtimeCarrier.get(node),
    } }, context.records) };
    const value = resolveReferencedDeclarationType(reference, resolution, { ...walk.operationOptions,
      callableSignatureCarrier() { throw new Error("a non-function value must not query a callable signature"); },
    });
    assert.equal(value?.kind === "source-primitive" && value.name === "float64", true,
      name + ": the actual value annotation is still authoritative");
  }
});

const genericConstructorCapture = `
function wrap<Value>(value: Value): Promise<Value> {
  return new Promise<Value>(resolve => {
    const first = (): void => { resolve(value); };
    const second = (): void => { resolve(value); };
    const callback = value === value ? first : second;
    [0].forEach(callback);
  });
}
export function run(): Promise<number> { return wrap(7); }
`;

function executorInputFixture() {
  return inputFixture(genericConstructorCapture, (ast, node) => ast.is.IsArrowFunction(node) &&
    ast.parameters(node).some(parameter => ast.text(ast.name(parameter)) === "resolve"));
}

test("a generic constructor executor publishes its actual native parameter before captured callbacks observe it", () => {
  const input = executorInputFixture();
  const completed = input.complete(input.current);
  assert.equal(completed?.length, 1, "one actual authored resolve formal, not the constructor's unused trailing reject formal");
  const resolve = rustCallableProtocol(completed[0].valueCarrier);
  assert.equal(resolve?.parameters[0]?.kind === "target-named" && resolve.parameters[0].id === "rust.js.PromiseResolution" &&
    resolve.error?.kind === "target-named" && resolve.error.id === "rust.js.JsValue", true,
  "the sole native Promise constructor contract owns payload adoption and its exact rejection ABI");
  assert.equal(resolve.lifetime?.kind, "static", "the actual native constructor contract, not source placeholder inference");
  assert.equal(completed[0] === input.current.context.records.sourceParameterAbi.get(input.parameters[0]), true,
    "the environment and body share the exact first canonical parameter record");
  assert.equal(input.complete(input.current)?.[0] === completed[0], true, "a second input request is the same sealed construction fact");
});

test("checked constructor input metadata does not execute its callback environment to select that callback's ABI", () => {
  const input = executorInputFixture();
  const ast = input.current.context.ast;
  const constructor = ast.parent(input.declaration);
  assert.equal(ast.is.IsNewExpression(constructor), true, "the original executor is an actual checked constructor argument");
  const semantics = input.current.context.semanticsFor(constructor);
  const checked = semantics.operations.call(constructor);
  const sourceSelectedDeclaration = semantics.declarations.signatureDeclaration(checked.selectedSignature);
  const selected = selectedRustCheckedCallInputCarrier({ source: checked, sourceSelectedDeclaration }, 0,
    rustOperationContext(input.current, constructor), { ...input.current.operationOptions,
      callableParameterCarriers() { throw new Error("constructor input metadata cannot demand its own capture environment"); },
    });
  const executor = rustCallableProtocol(selected);
  assert.equal(executor?.parameters.length, 2, "the actual native constructor still retains both resolve and reject slots");
  assert.equal(rustCallableProtocol(executor.parameters[0])?.parameters[0]?.id, "rust.js.PromiseResolution",
    "the canonical row supplies the resolve input without a raw checked-union fallback");
});

test("an eligible constructor with unavailable selected generic evidence publishes no raw parameter ABI", () => {
  const input = executorInputFixture();
  const context = input.current.context;
  const constructor = context.ast.parent(input.declaration);
  const originalSemantics = context.semanticsFor(constructor);
  const checked = originalSemantics.operations.call(constructor);
  const pending = { ...input.current, context: { ...context,
    semanticsFor(node) {
      const semantics = context.semanticsFor(node);
      return node !== constructor ? semantics : { ...semantics, operations: { ...semantics.operations,
        call(subject) { return subject !== constructor ? semantics.operations.call(subject)
          : { ...checked, sourceSelectedMethodTypeArguments: [] }; },
      } };
    },
  } };
  assert.equal(selectRustClosedCallableInputs(pending, input.declaration, []) === undefined, true,
    "missing required selected constructor evidence is not an ineligible transport or known-empty context");
  assert.equal(input.complete(pending) === undefined, true, "the input stage remains unresolved before any environment read");
  assert.equal(context.records.sourceParameterAbi.get(input.parameters[0]) === undefined, true,
    "the old placeholder/source-union ABI is never published as a substitute");
  assert.equal(input.complete(input.current)?.length, 1, "the same canonical stage completes after its real selected input becomes ready");
});

for (const [name, source] of [
  ["constructor", `
class Box<Value> {
  value: Value;
  constructor(value: Value, transform: (value: Value) => Value) { this.value = transform(value); }
}
export function run(): number { return new Box<number>(3, value => value).value; }
`],
  ["method", `
class Box {
  apply<Value>(value: Value, transform: (value: Value) => Value): Value { return transform(value); }
}
export function run(): number { return new Box().apply<number>(3, value => value); }
`],
  ["function", `
function apply<Value>(value: Value, transform: (value: Value) => Value): Value { return transform(value); }
export function run(): number { return apply<number>(3, value => value); }
`],
]) test(`checked generic ${name} metadata substitutes its exact selected owner before completing callback inputs`, () => {
  const input = inputFixture(source, (ast, node) => ast.is.IsArrowFunction(node));
  const context = input.current.context;
  const call = context.ast.parent(input.declaration);
  const semantics = context.semanticsFor(call);
  const checked = semantics.operations.call(call);
  const sourceSelectedDeclaration = semantics.declarations.signatureDeclaration(checked.selectedSignature);
  assert.equal(sourceSelectedDeclaration !== undefined && checked.sourceSelectedMethodTypeArguments.length === 1, true,
    name + ": one actual checked generic declaration and argument");
  const selected = selectedRustCheckedCallInputCarrier({ source: checked, sourceSelectedDeclaration }, 1,
    rustOperationContext(input.current, call), { ...input.current.operationOptions,
      callableParameterCarriers() { throw new Error("selected formal metadata must not reenter callback capture completion"); },
    });
  const protocol = rustCallableProtocol(selected);
  assert.equal(protocol?.parameters.length === 1 && protocol.parameters[0]?.kind === "source-primitive" &&
    protocol.parameters[0].name === "float64" && protocol.result.kind === "source-primitive" &&
    protocol.result.name === "float64", true, name + ": exact class or callable substitution, never its unbound formal");
  const missing = { ...checked, sourceSelectedMethodTypeArguments: [] };
  assert.equal(selectedRustCheckedCallInputCarrier({ source: missing, sourceSelectedDeclaration }, 1,
    rustOperationContext(input.current, call), input.current.operationOptions) === undefined, true,
  name + ": unavailable selected evidence cannot publish an unsubstituted callback signature");
  const completed = input.complete(input.current);
  assert.equal(completed?.length === 1 && completed[0].valueCarrier.kind === "source-primitive" &&
    completed[0].valueCarrier.name === "float64", true, name + ": the same input lifecycle publishes the selected native body value");
});

test("reduce callback input metadata uses the same selected accumulator without entering its environment", () => {
  const input = inputFixture(`
export function run(values: number[]): boolean {
  return values.reduce((same: boolean, item: number): boolean => same && item > 0, true);
}`, (ast, node) => ast.is.IsArrowFunction(node));
  const context = input.current.context;
  const call = context.ast.parent(input.declaration);
  const semantics = context.semanticsFor(call);
  const checked = semantics.operations.call(call);
  const sourceSelectedDeclaration = semantics.declarations.signatureDeclaration(checked.selectedSignature);
  assert.equal(sourceSelectedDeclaration !== undefined, true, "the real selected reduce declaration is available");
  const selected = selectedRustCheckedCallInputCarrier({ source: checked, sourceSelectedDeclaration }, 0,
    rustOperationContext(input.current, call), { ...input.current.operationOptions,
      callableParameterCarriers() { throw new Error("reduce input selection cannot query the callback environment"); },
    });
  assert.equal(selected?.kind === "closure" && selected.args[0]?.kind === "source-primitive" &&
    selected.args[0].name === "bool" && selected.result.kind === "source-primitive" && selected.result.name === "bool", true,
  "both callback accumulator and result use the same exact selected bool, not the opaque infer marker");
  const missing = { ...checked, sourceArgumentBindings: checked.sourceArgumentBindings.filter(binding => binding.sourceArgumentIndex !== 1) };
  assert.equal(selectedRustCheckedCallInputCarrier({ source: missing, sourceSelectedDeclaration }, 0,
    rustOperationContext(input.current, call), input.current.operationOptions) === undefined, true,
  "missing accumulator source correspondence stays unresolved instead of using contextual or checked-return evidence");
});
