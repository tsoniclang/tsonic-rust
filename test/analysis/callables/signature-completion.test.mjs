import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { rustResolutionContext } from "../../../dist/analysis/program/walk.js";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import { finalizeRustCallableSignature, resolveRustCallableSignatureCarrier } from "../../../dist/analysis/callables/calls/signature-query.js";
import * as callableSignatures from "../../../dist/analysis/callables/calls/signature-query.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { closedMetadataEquals } from "../../../dist/target-model/metadata/closed-data.js";
import { recordClassSignatureFacts, recordInterfaceFacts } from "../../../dist/analysis/declarations/project-types.js";
import { resolveRustCallableEnvironment } from "../../../dist/analysis/source-evidence/types/resolution/callable-environments.js";
import { rustSourceFunctionValueCarrier } from "../../../dist/analysis/callables/values/function-values.js";
import { rustCallableProtocol, rustCallableInputProtocol, rustCallableInputTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { resolveRustCallableInputCarrier } from "../../../dist/analysis/source-evidence/types/resolution/callable-inputs.js";
import { resolveRustTargetType } from "../../../dist/analysis/source-evidence/types/resolution/target.js";

for (const generic of [true, false]) test(`checked ${generic ? "generic" : "concrete"} callable formals retain their actual native input origin requirement`, () => {
  const type = generic ? "Value" : "number";
  const { context, walk } = analyzeRustOperations(`
export function apply${generic ? "<Value>" : ""}(callback: (value: ${type}) => ${type}, value: ${type}): ${type} {
  return callback(value);
}`, { surfaces: [] });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "apply");
  assert.equal(declaration !== undefined, true, "the actual checked function owns the formal");
  const parameter = sourceCallableValueParameters(context.ast, declaration, context.semanticsFor(declaration))[0];
  const resolution = rustResolutionContext(walk, parameter);
  const sourceType = context.semanticsFor(parameter).declarations.declaredValueType(parameter);
  const carrier = resolveRustTargetType(sourceType, { ...resolution,
    sourceStorageResolution: resolution.sourceStorageResolution?.kind === "resolved"
      ? { ...resolution.sourceStorageResolution, subject: undefined } : resolution.sourceStorageResolution,
    callableRepresentation: "signature" }, walk.operationOptions, new Set());
  const protocol = rustCallableProtocol(carrier);
  assert.equal(protocol !== undefined, true, "the original checked callable signature resolves exactly");
  assert.equal(protocol.parameters[0].kind, generic ? "type-parameter" : "source-primitive",
    "the selected source binder is not a guessed concrete instantiation");
  const subject = resolution.sourceStorage.subject(parameter, "input");
  assert.equal(subject.kind, "resolved", "the same original parameter has an owned input subject");
  let originQueries = 0;
  const selected = resolveRustCallableInputCarrier(subject.subject, carrier, { ...resolution,
    sourceStorage: { ...resolution.sourceStorage, closedOriginsFor(current) {
      originQueries++;
      assert.equal(current === subject.subject, true, "origin selection retains the original input identity");
      assert.equal(generic, false, "an abstract checked generic formal does not require a concrete actual implementation");
      return { kind: "unresolved", reason: "The concrete original input is not yet bound." };
    } },
  }, walk.operationOptions);
  assert.equal(originQueries, generic ? 0 : 1, "only the concrete input depends on actual closed origins");
  if (generic) {
    assert.equal(rustTargetTypeRefEquals(selected, rustCallableInputTargetType(protocol.parameters, protocol.result)), true,
      "the borrowed native input preserves the exact checked parameter and result binders");
    const actual = rustCallableInputProtocol(selected);
    assert.equal(actual?.parameters[0] === protocol.parameters[0] && actual.result === protocol.result, true,
      "input selection neither substitutes another generic identity nor copies a source implementation");
  } else {
    assert.equal(selected === undefined, true, "a genuinely unresolved concrete input remains unavailable");
  }
});

test("a named captured function retains its actual native borrow instead of a static environment", () => {
  const { context, walk } = analyzeRustOperations(`
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export function retain<Region extends Life>(value: Ref<int32, Region>): () => int32 {
  function read(): int32 { return load(value); }
  return read;
}`, { surfaces: [] });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "read");
  assert.equal(declaration !== undefined, true, "the original named callable owns its lexical capture");
  const selected = rustSourceFunctionValueCarrier(walk, declaration, [], { kind: "source-primitive", name: "int32" });
  const protocol = rustCallableProtocol(selected);
  assert.equal(protocol?.lifetime?.kind, "parameter", "a retained native reference stays in its proven environment");
  assert.equal(protocol.lifetime.name, "Region", "the captured authored native region is not widened to static");
});

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
  const semantics = context.semanticsFor(declaration);
  const parameters = sourceCallableValueParameters(context.ast, declaration, semantics, { kind: "declaration" });
  assert.equal(parameters !== undefined, true, "the original checked callable has its complete value-parameter inventory");
  const signature = semantics.declarations.declarationSignature(declaration);
  const pseudo = signature === undefined ? undefined : semantics.types.signatureThisParameterInfo(signature)?.declaration;
  if (pseudo !== undefined) {
    assert.equal(context.ast.parameters(declaration).includes(pseudo), true, "the checked pseudo-this retains its original authored node");
    assert.equal(parameters.includes(pseudo), false, "pseudo-this is not an authored runtime value input");
    assert.equal(context.records.sourceParameterAbi.get(pseudo) === undefined, true, "pseudo-this has no native value ABI");
  }
  const inputs = new Set(parameters);
  const inherited = createRustRecordFixture({
    sourceParameterAbi: { get: node => inputs.has(node) ? undefined : context.records.sourceParameterAbi.get(node) },
    ...Object.fromEntries(["asyncFunction", "generator", "sourceCallableReturn"].map(family =>
      [family, { get: node => node === declaration ? undefined : context.records[family].get(node) }])),
  }, context.records);
  const current = createRustCarrierProbe({ ...walk, context: { ...context,
    records: createRustProgramRecordBuilder(context.typeDefinitions, inherited) } });
  return { current, declaration, parameters, pseudo, original: context.records,
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
  assert.equal(expected.every(selection => selection?.kind === "resolved"), true,
    name + ": the existing intrinsic formal owner admits the inputs");
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
    assert.equal(closedMetadataEquals(abi, expected[index].abi), true, name + ": exact existing ABI " + index);
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
  assert.equal(actual === undefined, expected.some(selection => selection?.kind !== "resolved"),
    name + ": no new effective-argument count rejection");
  if (name === "explicit receiver") {
    assert.equal(input.pseudo !== undefined, true, "the explicit receiver is proved by the actual selected checked signature");
    assert.equal(input.parameters.length, 1, "only the actual offset value occupies the native input vector");
    const nameNode = input.current.context.ast.name(input.parameters[0]);
    assert.equal(input.current.context.ast.is.IsIdentifier(nameNode) && input.current.context.ast.text(nameNode) === "offset", true,
      "the ordinary first value input is retained independently of pseudo-this");
    assert.equal(input.current.context.records.sourceParameterAbi.get(input.pseudo) === undefined, true,
      "input completion never publishes a native value ABI for the checked pseudo receiver");
  }
  if (actual === undefined) {
    for (const parameter of input.parameters) assert.equal(input.current.context.records.sourceParameterAbi.get(parameter) === undefined, true,
      name + ": an unresolved vector publishes no input");
  } else {
    assert.equal(actual.length, input.parameters.length, name + ": one ABI per source formal");
    for (const [index, abi] of actual.entries())
      assert.equal(closedMetadataEquals(abi, expected[index].abi), true, name + ": unchanged intrinsic ABI " + index);
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
  assert.equal(selected.kind === "complete" && selected.suspension !== undefined, true);
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
  assert.equal(selected.kind, "complete");
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
  assert.equal(selected.kind, "complete");
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
  assert.equal(complete.kind, "complete");
  assert.throws(() => finalizeRustCallableSignature(input.current, input.declaration, {
    selectedReturn: { kind: "source-primitive", name: "int32" },
  }), /Conflicting Rust semantic plan/u);
  assert.equal(input.admissions(), inherited ? 0 : 1);
  assert.equal(input.current.context.records.sourceCallableReturn.get(input.declaration) === complete.result, true);
  const request = { selectedReturn: complete.logicalReturn };
  const matching = finalizeRustCallableSignature(input.current, input.declaration, request);
  assert.equal(matching.kind, "complete");
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
  assert.equal(selected.kind, "complete");
  assert.equal(rustTargetTypeRefEquals(selected.logicalReturn, selected.result.returnCarrier), false,
    "a selected logical annotation is not reconstructed from the normalized native fact");
  assert.equal(current.context.records.sourceCallableReturn.get(declaration) === selected.result, true);
  assert.equal(finalizeRustCallableSignature(current, declaration) === selected, true);
});

test("a scalar native signature does not query unrelated retained source storage", () => {
  const input = fixture(false, "export function step(value: number): number { return value; }", []);
  const current = { ...input.current, context: { ...input.current.context, retainedEnvironments: {
    ...input.current.context.retainedEnvironments,
    environmentFor() { throw new Error("a scalar native signature has no retained environment demand"); },
  } } };
  const selected = finalizeRustCallableSignature(current, input.declaration);
  assert.equal(selected.kind, "complete", "the original scalar signature completes without a storage-retention walk");
  assert.equal(current.context.records.retainedEnvironment.get(input.declaration) === undefined, true,
    "a scalar native signature publishes no invented retained environment");
  assert.equal(finalizeRustCallableSignature(current, input.declaration) === selected, true,
    "the completed scalar signature remains a canonical lookup");
});

const retainedInputSource = `
type Identity = <Value>(value: Value) => Value;
export function step(callback: () => number): Identity {
  return <Value>(value: Value): Value => { callback(); return value; };
}`;

test("one completed synchronous owner publishes input-only native retention before caching its signature", () => {
  const input = fixture(false, retainedInputSource, []);
  const records = input.current.context.records;
  const current = input.current;
  const admissions = () => current.context.requiredRecords.filter(requirement =>
    requirement.family === "retainedEnvironment" && requirement.subject === input.declaration);
  assert.equal(admissions().length, 0, "the actual probe begins without a dependent environment publication");
  const selected = finalizeRustCallableSignature(current, input.declaration);
  assert.equal(selected.kind === "complete" && selected.result.returnCarrier.kind === "target-specific", true,
    "the actual generic callable result is distinct from a monomorphic runtime-callable result");
  const environment = records.retainedEnvironment.get(input.declaration);
  const parameter = current.context.ast.parameters(input.declaration)[0];
  const nativeLifetime = rustCallableProtocol(selected.parameterAbis[0].parameterCarrier)?.lifetime;
  assert.equal(environment !== undefined && nativeLifetime?.kind === "parameter", true,
    "the concrete native input already requires its exact declaration-owned environment");
  assert.equal(environment.lifetime.identity === nativeLifetime.identity, true, "the published lifetime is the actual native input lifetime");
  assert.equal(environment.inputs.length, 1, "the complete input vector contains one retained source formal");
  assert.equal(environment.inputs[0].kind === "parameter" && environment.inputs[0].declaration === parameter, true,
    "retention keeps the exact original source parameter, not a callable-family or contextual surrogate");
  assert.equal(admissions().length, 1, "input and result completion have one synchronous environment publisher");
  assert.equal(admissions()[0].producer, "sourceCallableReturns.resolve", "the completed source-return owner owns that publication");
  assert.equal(finalizeRustCallableSignature(current, input.declaration) === selected, true);
  const repeated = finalizeRustCallableSignature(current, input.declaration, { selectedReturn: selected.logicalReturn });
  assert.equal(repeated.kind === "complete" && repeated.result === selected.result, true, "an exact new request reuses the admitted result");
  assert.equal(records.retainedEnvironment.get(input.declaration) === environment, true);
  assert.equal(admissions().length, 1, "matching signature requests do not publish a second environment");
  records.seal(current.context.requiredRecords);
});

test("required native input retention preserves its actual unresolved reason and publishes no completed signature", () => {
  const input = fixture(false, retainedInputSource, []);
  const reason = "the actual retained source input has no completed native storage";
  const current = { ...input.current, context: { ...input.current.context, retainedEnvironments: {
    ...input.current.context.retainedEnvironments, environmentFor: () => ({ kind: "unresolved", reason }),
  } } };
  assert.equal(finalizeRustCallableSignature(current, input.declaration).kind, "unresolved",
    "required retention is a refusal, not an empty environment or a completed result");
  const diagnostics = current.context.diagnostics.filter(diagnostic => diagnostic.code === "RUST_RETAINED_ENVIRONMENT_NOT_EXACT");
  assert.equal(diagnostics.length, 1, "the original source owner emits one precise refusal");
  assert.equal(diagnostics[0].message, reason, "the native retention reason is not replaced with a missing-record failure");
  assert.equal(diagnostics[0].sourceNode === input.declaration, true, "the diagnostic preserves the exact original callable");
  assert.equal(current.rejectedExpressions.has(input.declaration), true, "the existing terminal failure route records the actual declaration");
  assert.equal(current.context.records.sourceCallableReturn.get(input.declaration) === undefined, true,
    "a refused input environment cannot publish its dependent result");
  assert.equal(current.context.records.retainedEnvironment.get(input.declaration) === undefined, true,
    "an unresolved required environment is never published as none");
  assert.equal(current.callableSignatures.get(input.declaration).completed.size, 0,
    "terminal retention refusal never becomes a successful signature-cache entry");
});

test("the cached native callable owns immutable argument containers without copying canonical input carriers", () => {
  const input = fixture(false);
  const selected = finalizeRustCallableSignature(input.current, input.declaration);
  assert.equal(selected.kind === "complete" && selected.callableValue !== undefined, true);
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
  for (const member of members) assert.equal(finalizeRustCallableSignature(current, member).kind, "complete");
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
  for (const member of members) assert.equal(finalizeRustCallableSignature(lookup, member).kind, "complete");
});

test("a computed signature refusal preserves its actual input predicate and does not cache a pending completion", () => {
  const input = fixture(false, "export function step(value: number): number { return value; }", []);
  const parameters = input.current.context.ast.parameters(input.declaration);
  const inherited = createRustRecordFixture({ sourceParameterAbi: {
    get: node => parameters.includes(node) ? undefined : input.current.context.records.sourceParameterAbi.get(node),
  } }, input.current.context.records);
  const current = createRustCarrierProbe({ ...input.current, context: { ...input.current.context,
    records: createRustProgramRecordBuilder(input.current.context.typeDefinitions, inherited) } });
  const pending = { ...current, sourceCallableAbi: { ...current.sourceCallableAbi, resolveParameterAbi: () => undefined } };
  const failure = finalizeRustCallableSignature(pending, input.declaration);
  assert.equal(failure.kind, "unresolved", "a genuine unavailable input is not a successful empty signature");
  assert.equal(failure.sourceNode === input.declaration, true, "the computed reason keeps the original checked owner");
  assert.match(failure.reason, /native callable input stage did not complete; unadmitted original parameter ABIs: value \(KindNumberKeyword\)/u);
  assert.equal(Object.isFrozen(failure), true, "the computed failure is immutable data, not a mutable last-error channel");
  assert.equal(current.callableSignatures.get(input.declaration).completed.size, 0, "pending input completion publishes no cached success");
  assert.equal(current.context.records.sourceCallableReturn.get(input.declaration) === undefined, true,
    "no dependent native result is published for missing input contracts");
  assert.equal(current.context.diagnostics.length, 0, "a retryable query does not emit a final program refusal prematurely");
  const complete = finalizeRustCallableSignature(current, input.declaration);
  assert.equal(complete.kind, "complete", "the same original owner retries after its real input resolver is restored");
  assert.equal(finalizeRustCallableSignature(current, input.declaration) === complete, true,
    "only the completed immutable signature becomes the canonical lookup");
});

for (const [name, path] of [
  ["recordFunctionSignatureFacts", "signatures"], ["recordCallableSuspensionFacts", "signatures"],
  ["recordCallableReturnFact", "signatures"], ["recordRustAsyncBodyFacts", "async-results"],
]) test(`the superseded independent ${name} entrypoint is rejected`, async () => {
  const module = new URL(`../../../dist/analysis/callables/${path}.js`, import.meta.url).href;
  const source = `import { ${name} } from ${JSON.stringify(module)};`;
  await assert.rejects(import("data:text/javascript," + encodeURIComponent(source)), /does not provide an export named/u);
});
