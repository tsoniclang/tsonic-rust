import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { createRustCallableEntryHeaderSelections } from "../../../dist/analysis/callables/emission/entry-header-selections.js";
import { createRustCallableEntryHeaderPlacements } from "../../../dist/analysis/callables/emission/entry-header-placements.js";
import { prepareRustProjectGenericMembership } from "../../../dist/analysis/project-types/generic-membership.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

function fixture(source = "export async function empty<Value>(): Promise<void> {}", name = "empty", surfaces = []) {
  const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
  const { ast } = program.source;
  const file = program.sourceFiles[0];
  const declaration = ast.statements(file).find(node => node !== undefined && ast.is.IsFunctionDeclaration(node) &&
    program.records.sourceName.get(node) === name);
  assert.equal(declaration !== undefined, true, "the checked source retains the exact original function");
  const header = program.records.callableLeading.get(declaration)?.genericHeader;
  assert.equal(header !== undefined, true, "the admitted source owns its completed original header inputs");
  const construction = createRustCallableEntryHeaderSelections({ headers: new Map([[declaration, header]]),
    requirements: program.declarationGenericRequirements });
  const request = { inherited: { types: new Map(), lifetimes: new Map(), consts: new Map() },
    ownerLifetimes: new Set(), capturedParameters: [], specialization: undefined, enclosingArguments: [],
    trailingArguments: [], finalArguments: undefined, splitBody: false };
  return { program, file, declaration, header, construction, request };
}

function placementsFor(program) {
  const headers = new Map();
  const visit = node => {
    const header = program.records.callableLeading.get(node)?.genericHeader;
    if (header !== undefined) headers.set(node, header);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  const construction = createRustCallableEntryHeaderSelections({ headers, requirements: program.declarationGenericRequirements });
  return createRustCallableEntryHeaderPlacements({ program, entries: {
    get: declaration => program.records.callableLeading.get(declaration),
    selectHeader: (...arguments_) => construction.select(...arguments_),
  }, classContexts: { forInstance() { assert.fail("these direct entries do not request a rooted class context"); } },
  memberships: prepareRustProjectGenericMembership(program.declarationGenericRequirements) });
}

test("native body header requests select the original module body without traversing late wrappers", () => {
  const { program, file, declaration, header } = fixture();
  const placements = placementsFor(program);
  const selected = placements.nativeBody(declaration, undefined, () => true);
  assert.equal(selected.kind, "resolved", "the checked module declaration has an exact original emitted placement");
  assert.equal(selected.entry === program.records.callableLeading.get(declaration).nativeEntry.direct.body, true,
    "early selection preserves the exact original physical body entry");
  assert.equal(selected.header.captureArguments.some(argument => argument.kind === "type" &&
    argument.type.kind === "type-parameter" && argument.type.identity === header.sourceContract.parameters[0].identity), true,
    "unused native header binders remain actual pending lifetime obligations");
  assert.equal(placements.nativeBody(declaration, undefined, () => true).header === selected.header, true,
    "repeated early reads reuse one exact selected row");
  placements.module(file);
  assert.equal(placements.nativeBody(declaration, undefined, () => true).header === selected.header, true,
    "late module preparation consumes the identical original selection");
  assert.equal(placements.nativeBody(declaration, undefined, () => false).kind, "unresolved",
    "exhausted shared work cannot grant a native entry");
});

test("native body header requests share direct class placement with late method emission", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
class Box { value(): number { return 7; } }
export function read(): number { return new Box().value(); }
` } });
  const definition = program.projectTypes.definitions.find(entry => entry.sourceName === "Box");
  assert.equal(definition !== undefined, true, "the real emitted class has its original definition");
  const declaration = program.source.ast.members(definition.declaration).find(node => node !== undefined &&
    program.source.ast.is.IsMethodDeclaration(node));
  assert.equal(declaration !== undefined, true, "the real native method is present");
  const placements = placementsFor(program);
  const selected = placements.nativeBody(declaration, undefined, () => true);
  assert.equal(selected.kind, "resolved", "the direct nonpolymorphic class has an exact native body placement");
  assert.equal(selected.entry === program.records.callableLeading.get(declaration).nativeEntry.direct.body, true,
    "the original physical method entry is not replaced by a module/helper entry");
  placements.directClass(definition);
  assert.equal(placements.nativeBody(declaration, undefined, () => true).header === selected.header, true,
    "late direct-class preparation reuses the exact early row");
});

test("native body header requests require the identical registered specialization variant", () => {
  const { program, declaration, header } = fixture();
  const variant = { declaration, sourceTypeParameterIdentities: [header.sourceContract.parameters[0].identity],
    targetTypeArguments: [rustSourcePrimitiveTargetType("int32")], targetName: "empty_int32" };
  const placements = placementsFor({ ...program, sourceCallableSpecializations: {
    ...program.sourceCallableSpecializations, requiresSpecialization: node => node === declaration,
    variantsForCallable: node => node === declaration ? [variant] : [],
  } });
  assert.equal(placements.nativeBody(declaration, undefined, () => true).kind, "unresolved",
    "a specialized emitted item cannot select an unspecialized header domain");
  assert.equal(placements.nativeBody(declaration, { ...variant }, () => true).kind, "unresolved",
    "equal-shaped foreign specialization rows cannot select an emitted native body");
  assert.equal(placements.nativeBody(declaration, { ...variant, declaration: {} }, () => true).kind, "unresolved",
    "a variant cannot change the original declaration owner");
  const selected = placements.nativeBody(declaration, variant, () => true);
  assert.equal(selected.kind, "resolved", "the exact original registered variant selects its native body");
  assert.equal(selected.header.specialization.get(variant.sourceTypeParameterIdentities[0]) === variant.targetTypeArguments[0], true,
    "the selected header preserves its exact registered specialization argument");
});

test("native body header requests cannot replace an unknown lexical placement with a module row", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
export function outer(): number { function inner(): number { return 7; } return inner(); }
` } });
  const { ast } = program.source;
  const outer = ast.statements(program.sourceFiles[0]).find(node => node !== undefined && ast.is.IsFunctionDeclaration(node));
  const inner = ast.statements(ast.body(outer)).find(node => node !== undefined && ast.is.IsFunctionDeclaration(node));
  assert.equal(inner !== undefined, true, "the source contains its original nested native function");
  const original = program.records.callableLeading.get(inner);
  assert.equal(original?.nativeEntry.direct !== undefined, true, "the nested function has an actual direct native entry");
  const placements = placementsFor({ ...program, callableValues: { ...program.callableValues,
    generic: { ...program.callableValues.generic, implementationFor: () => undefined },
    frames: { ...program.callableValues.frames, implementationFor: () => undefined } },
  records: { ...program.records, lexicalFunction: { get: () => undefined } },
  source: { ...program.source, ast: { ...ast, is: { ...ast.is,
    IsFunctionDeclaration: node => node === outer ? false : ast.is.IsFunctionDeclaration(node) } } } });
  assert.equal(placements.nativeBody(inner, undefined, () => true).kind, "unresolved",
    "missing actual parent placement evidence cannot acquire a module header from absence of a class");
});

test("entry header selections snapshot request containers and retain exact placement and parent identities", () => {
  const { file, declaration, header, construction, request } = fixture();
  const selected = construction.select(declaration, file, undefined, undefined, request);
  const reader = construction.readerFor(declaration);
  assert.equal(reader.get(file, undefined, undefined) === selected, true, "the original placement reads the one selected row");
  assert.equal(reader.get({ ...file }, undefined, undefined) === undefined, true, "foreign equal-shaped source owners cannot select this row");
  assert.equal(reader.get(file, undefined, selected.body) === undefined, true, "an enclosing emitted body is part of the exact selection key");
  assert.equal(selected.source === selected.body, true, "an unsplit native entry retains one source/body header identity");
  assert.equal(selected.body.captureArguments.some(argument => argument.kind === "type" &&
    argument.type.kind === "type-parameter" && argument.type.identity === header.sourceContract.parameters[0].identity), true,
  "the actual phantom source binder remains an opaque native Future capture obligation");
  const scalar = rustSourcePrimitiveTargetType("int32");
  request.inherited.types.set("foreign", scalar);
  request.ownerLifetimes.add("foreign");
  request.enclosingArguments.push({ kind: "type", type: scalar });
  assert.equal(selected.body.bindings.types.has("foreign"), false, "mutating the caller's map cannot rewrite selected binding evidence");
  assert.equal(selected.body.captureArguments.some(argument => argument.kind === "type" && argument.type === scalar), false,
    "mutating the caller's array cannot rewrite an already selected capture inventory");
  assert.throws(() => construction.select(declaration, file, undefined, undefined, request),
    /one original header binding domain/u, "a mutated request cannot validate itself against borrowed premise containers");
  construction.seal();
  assert.equal(reader.get(file, undefined, undefined) === selected, true, "sealed publication remains a pure identity-preserving lookup");
  assert.equal(selected.body.bindings.types.set === undefined && selected.body.nativeBinders.clear === undefined && Object.isFrozen(selected.body), true,
    "selected bindings and membership expose no mutator path");
  assert.throws(() => construction.select(declaration, declaration, undefined, undefined, request),
    /sealed native entry cannot select another/u, "a sealed owner never computes a new contextual row");
});

test("entry header specialization preserves exact selected arguments and final emitted helper captures", () => {
  const { file, declaration, header, construction, request } = fixture();
  const identity = header.sourceContract.parameters[0].identity;
  const scalar = rustSourcePrimitiveTargetType("int32");
  const variant = { declaration, sourceTypeParameterIdentities: [identity], targetTypeArguments: [scalar], targetName: "empty_int32" };
  const specialization = new Map([[identity, scalar]]);
  const frameArgument = { kind: "type", type: { kind: "type-parameter", identity: "frame/environment", name: "Environment" } };
  const trailing = { kind: "type", type: { kind: "type-parameter", identity: "class/environment", name: "ClassEnvironment" } };
  const selected = construction.select(declaration, file, variant, undefined,
    { ...request, specialization, finalArguments: [frameArgument], trailingArguments: [trailing] });
  assert.equal(selected.body.parameters.some(parameter => parameter.kind === "type" && parameter.identity === identity), false,
    "specialized source parameters are substitutions, not duplicate emitted native binders");
  assert.equal(selected.body.bindings.types.get(identity) === scalar && selected.body.specialization.get(identity) === scalar, true,
    "the selected original source binder keeps the exact admitted argument");
  assert.equal(selected.body.captureArguments.length === 2 && selected.body.captureArguments[0] === frameArgument &&
    selected.body.captureArguments[1] === trailing, true, "a final frame header replaces discarded ordinary binders and keeps trailing environment order");
  assert.equal(construction.readerFor(declaration).get(file, { ...variant }, undefined) === undefined, true,
    "another same-shaped specialization cannot select the original row");
  specialization.clear();
  assert.equal(selected.body.specialization.get(identity) === scalar, true, "the selected specialization inventory is immutable");
});

test("entry header source and native Promise body facets retain distinct exact requirement roles", () => {
  const { program, file, declaration, construction, request } = fixture(`
export async function invoke(callback: () => Promise<number>): Promise<number> { return await callback(); }
`, "invoke", ["js"]);
  assert.equal(program.promiseBodies.declarations.has(declaration), true, "the real source has distinct native body and Promise object entries");
  const selected = construction.select(declaration, file, undefined, undefined, { ...request, splitBody: true });
  assert.equal(selected.source !== selected.body && !selected.source.promiseBody && selected.body.promiseBody, true,
    "the two ABI facets retain their selected requirement roles without a second renderer decision");
  assert.equal(selected.source.nativeBinders.size === 1 && selected.body.nativeBinders.size === 1, true,
    "both facets retain their one exact native input binder");
});

test("nested native items inherit the exact emitted body domain rather than declaration self bindings", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
export function outer<Value>(value: Value): Value {
  function inner(): Value { return value; }
  return inner();
}
` } });
  const { ast } = program.source;
  const file = program.sourceFiles[0];
  const outer = ast.statements(file).find(node => node !== undefined && ast.is.IsFunctionDeclaration(node));
  const inner = ast.statements(ast.body(outer)).find(node => node !== undefined && ast.is.IsFunctionDeclaration(node));
  assert.equal(inner !== undefined, true, "the admitted source contains its actual independently emitted lexical item");
  const parent = program.records.callableLeading.get(outer).headerSelections.get(file, undefined, undefined)?.body;
  assert.equal(parent !== undefined, true, "the original enclosing function has its selected emitted body header");
  const identity = parent.sourceTypeParameterIdentities[0];
  assert.equal(parent.bindings.types.has(identity), false, "an unspecialized emitted source binder is not an activation self substitution");
  const reader = program.records.callableLeading.get(inner).headerSelections;
  const selected = reader.get(parent, undefined, parent)?.body;
  assert.equal(selected !== undefined, true, "the exact enclosing body identity selects the lexical item's native header");
  assert.equal(selected.parameters.some(parameter => parameter.kind === "type" && parameter.identity === identity), true,
    "the nested Rust item declares the captured generic it cannot borrow from an outer item header");
  assert.equal(selected.captureArguments.filter(argument => argument.kind === "type" &&
    argument.type.kind === "type-parameter" && argument.type.identity === identity).length, 1,
  "the independent nested item captures its own declared binder once, not the outer function header as well");
  assert.equal(reader.get(file, undefined, undefined) === undefined, true, "a module placement cannot stand in for its actual enclosing body");
});

test("native field initializer lexical items use their exact admitted constructor layer placement", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
class Box {
  value: number = (() => { function initial(): number { return 7; } return initial(); })();
}
export function main(): number { return new Box().value; }
` } });
  const { ast } = program.source;
  const definition = program.projectTypes.definitions.find(definition => definition.sourceName === "Box");
  assert.equal(definition !== undefined, true, "the real checked class owns its construction inventory");
  const construction = program.records.classConstruction.get(definition.declaration);
  const layer = construction.layers.find(layer => layer.definition === definition);
  assert.equal(layer?.fields.some(field => field.initializer !== undefined), true, "the admitted construction actually renders a field initializer");
  let declaration;
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node) && program.records.sourceName.get(node) === "initial") declaration = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(definition.declaration);
  assert.equal(declaration !== undefined, true, "the initializer contains an actual independently emitted native lexical item");
  const reader = program.records.callableLeading.get(declaration).headerSelections;
  assert.equal(reader.get(layer, undefined, undefined) !== undefined, true, "the exact original admitted layer selects its initializer's native header");
  assert.equal(reader.get({ ...layer }, undefined, undefined) === undefined, true, "an equal-shaped foreign construction layer cannot select the entry");
});

test("static initializer lexical items retain their actual module header placement", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
class Box {
  static value: number = (() => { function initial(): number { return 7; } return initial(); })();
}
export function main(): number { return Box.value; }
` } });
  const { ast } = program.source;
  const file = program.sourceFiles[0];
  const definition = program.projectTypes.definitions.find(definition => definition.sourceName === "Box");
  assert.equal(definition !== undefined, true, "the checked class owns its module initialization inventory");
  assert.equal(program.records.classInitialization.get(definition.declaration).some(entry => entry.kind !== "block"), true,
    "the original static field initializer is actually emitted at module initialization");
  let declaration;
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node) && program.records.sourceName.get(node) === "initial") declaration = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(definition.declaration);
  assert.equal(declaration !== undefined, true, "the actual static initializer contains its native lexical function");
  const reader = program.records.callableLeading.get(declaration).headerSelections;
  assert.equal(reader.get(file, undefined, undefined) !== undefined, true, "the module-built initializer selects its exact original module header");
  assert.equal(reader.get(definition.declaration, undefined, undefined) === undefined, true,
    "a static initializer does not invent an enclosing instance method or constructor header");
});
