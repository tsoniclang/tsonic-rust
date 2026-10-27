import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createRustSourceCallableAbiResolver } from "../../../dist/analysis/callables/calls/source-callable-abi.js";
import { rustCallableTargetType, rustSourcePrimitiveTargetType, rustStructuralObjectTargetType, rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { rustResolutionContext } from "../../../dist/analysis/program/walk.js";
import { rustSourceParameterSupportsMemberWrites } from "../../../dist/policy/ownership/source-parameter-contracts.js";

import { borrowedCallbackInputSource } from "../../../../tsonic/test/fixtures/borrowed-callback-inputs.mjs";

test("published native parameter ABI supersedes a pre-finalization missing cache entry", () => {
  const parameter = {};
  const carrier = rustSourcePrimitiveTargetType("int64");
  const abi = Object.freeze({ form: "required", valueCarrier: carrier, parameterCarrier: carrier, mode: "value" });
  let published;
  const resolver = createRustSourceCallableAbiResolver({ isNativeCallableExpression: () => true,
    parameterAbiFor: selected => selected === parameter ? published : undefined });
  assert.equal(resolver.resolveParameterAbi(parameter, {
    ast: { parent: () => undefined, typeNode: () => undefined, as: { AsParameterDeclaration: () => undefined } },
  }, {}, carrier), undefined);
  published = abi;
  const sealedContext = { ast: new Proxy({}, { get() { throw new Error("Published ABI must not query syntax"); } }) };
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {})?.abi === abi, true,
    "the resolved result retains the identical published ABI");
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {}, { ...carrier })?.abi === abi, true,
    "equal contextual evidence reads the identical published ABI");
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {}, rustSourcePrimitiveTargetType("uint64")), undefined);
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {})?.abi === abi, true,
    "a rejected contextual lookup never replaces the published ABI");
});

test("native formals preserve original data and method geometry when their contracts already satisfy demand", async () => {
  const policy = await import("../../../dist/policy/ownership/source-parameter-contracts.js");
  assert.equal(Object.hasOwn(policy, "selectRustSourceParameterStructuralCarrier"), false,
    "the obsolete carrier-selecting API is absent, not a compatibility alias");
  assert.equal(policy.rustSourceParameterSupportsMemberWrites === rustSourceParameterSupportsMemberWrites, true,
    "one current native member-write predicate owns the admission decision");
  const value = rustSourcePrimitiveTargetType("int32");
  const logical = rustStructuralObjectTargetType("index.ts", [
    { sourceName: "first", type: value, presence: "required", readonly: false },
    { sourceName: "second", type: value, presence: "optional", readonly: false,
      accessor: { getter: true, setter: true } },
  ]);
  assert.equal(rustSourceParameterSupportsMemberWrites(logical, new Set()), true,
    "an empty demand validates the original native carrier without selecting a replacement");
  const readFields = rustStructuralObjectCarrierValue(logical)?.fields;
  assert.equal(readFields?.length, 2, "the native read role keeps every original physical field");
  assert.equal(readFields.every(field => !field.readonly), true, "data-only formals do not acquire gratuitous readonly facets");
  assert.equal(readFields[0].type === value && readFields[1].type === value, true, "exact native value carriers are not widened");
  assert.equal(readFields[0].presence, "required", "required source presence is unchanged");
  assert.equal(readFields[1].presence, "optional", "native absence remains one optional state");
  assert.equal(readFields[1].accessor.setter, true, "the original data accessor contract is unchanged");
  assert.equal(rustStructuralObjectCarrierValue(logical).fields.every(field => !field.readonly), true,
    "the globally declared logical contract is never rewritten");
  assert.equal(rustSourceParameterSupportsMemberWrites(logical, new Set([1])), true,
    "the original native data contract supports its exact demanded member");
  const writeFields = rustStructuralObjectCarrierValue(logical)?.fields;
  assert.equal(writeFields?.[0].readonly === false && writeFields[1].readonly === false, true,
    "a demanded data write does not alter any original native field");
  assert.equal(writeFields[1].accessor.setter, true, "the demanded native setter remains available");
  const readonly = rustStructuralObjectTargetType("index.ts", [
    { sourceName: "first", type: value, presence: "required", readonly: true },
    { sourceName: "second", type: value, presence: "optional", readonly: true,
      accessor: { getter: true, setter: false } },
  ]);
  assert.equal(rustSourceParameterSupportsMemberWrites(readonly, new Set([1])), false,
    "an actually readonly native protocol cannot satisfy a write demand");
  assert.equal(rustSourceParameterSupportsMemberWrites(logical, new Set()), true,
    "an independent native protocol is validated without silently rewriting its input ABI");
  for (const invalid of [-1, 2, 0.5, Number.NaN])
    assert.equal(rustSourceParameterSupportsMemberWrites(logical, new Set([invalid])), false,
      "invalid original field index is rejected: " + invalid);
  const direct = rustStructuralObjectTargetType("index.ts", [
    { sourceName: "first", type: value, presence: "required", readonly: false },
    { sourceName: "second", type: value, presence: "required", readonly: false },
  ], "value");
  const directFields = rustStructuralObjectCarrierValue(direct)?.fields;
  assert.equal(directFields?.length, 2, "the independent native-value positive has a valid required-field domain");
  assert.equal(rustSourceParameterSupportsMemberWrites(direct, new Set([1])), true,
    "a native value carrier supports its exact write without a replacement representation");
  const accessorValue = rustStructuralObjectTargetType("index.ts", [
    directFields[0], { ...directFields[1], accessor: { getter: true, setter: true } },
  ], "value");
  assert.equal(rustStructuralObjectCarrierValue(accessorValue) === undefined, true,
    "an accessor alone is outside the native-value domain even when both fields are required");
  assert.equal(rustSourceParameterSupportsMemberWrites(accessorValue, new Set([1])), false,
    "a native value carrier cannot acquire an accessor dispatch contract");
  const optionalValue = rustStructuralObjectTargetType("index.ts", [
    directFields[0], { ...directFields[1], presence: "optional" },
  ], "value");
  assert.equal(rustStructuralObjectCarrierValue(optionalValue) === undefined, true,
    "optional presence alone is outside the native-value domain without an accessor");
  assert.equal(rustSourceParameterSupportsMemberWrites(optionalValue, new Set([1])), false,
    "a native value carrier cannot acquire an optional source slot");
  const method = rustCallableTargetType([], value);
  const methods = rustStructuralObjectTargetType("index.ts", [
    { sourceName: "first", type: method, presence: "required", readonly: false, method: true },
    { sourceName: "second", type: method, presence: "required", readonly: false, method: true },
  ]);
  assert.equal(rustSourceParameterSupportsMemberWrites(methods, new Set()), true,
    "a no-write method formal validates its original native contract");
  assert.equal(rustSourceParameterSupportsMemberWrites(methods, new Set([0])), true,
    "the original declaration permits the method write; actual native slot admission is separate");
  assert.equal(rustStructuralObjectCarrierValue(methods).fields[1].readonly, false,
    "a write demand never gratuitously rewrites an unrelated method contract");
});

for (const surfaces of [[], ["js"]]) {
  const label = surfaces[0] ?? "native";
  test(`${label} one original data formal preserves its native contract for read and member-write uses`, () => {
    const { context, walk } = analyzeRustOperations(`
type Reader = { first: number; second: number; };
export function read(owner: Reader): number { return owner.first + owner.second; }
export function replace(owner: Reader): void { const alias = owner; alias.second = 9; }
`, { surfaces });
    const { ast } = context;
    const declarations = context.sourceStorage.nodes.filter(node => ast.is.IsFunctionDeclaration(node) && ast.body(node) !== undefined);
    const read = declarations.find(node => ast.text(ast.name(node)) === "read");
    const replace = declarations.find(node => ast.text(ast.name(node)) === "replace");
    assert.equal(read !== undefined && replace !== undefined, true, "both actual implementation bodies exist");
    const readParameter = ast.parameters(read)[0];
    const writeParameter = ast.parameters(replace)[0];
    const readSelection = walk.sourceCallableAbi.resolveParameterAbi(readParameter, rustResolutionContext(walk, readParameter), walk.operationOptions);
    const writeSelection = walk.sourceCallableAbi.resolveParameterAbi(writeParameter, rustResolutionContext(walk, writeParameter), walk.operationOptions);
    assert.equal(readSelection?.kind, "resolved", "the complete read formal has its native ABI");
    assert.equal(writeSelection?.kind, "resolved", "the aliased writer formal has its native ABI");
    const readFields = rustStructuralObjectCarrierValue(readSelection.abi.valueCarrier)?.fields;
    const writeFields = rustStructuralObjectCarrierValue(writeSelection.abi.valueCarrier)?.fields;
    assert.equal(readFields?.every(field => !field.readonly), true, "a data-only reader retains its original native field contract");
    assert.equal(writeFields?.find(field => field.sourceName === "first")?.readonly, false, "a data-only writer does not rewrite unrelated fields");
    assert.equal(writeFields?.find(field => field.sourceName === "second")?.readonly, false, "the identical original aliased member requires a writer");
    const readShape = walk.sourceTypes.structuralObjectForCarrier(readSelection.abi.valueCarrier);
    const writeShape = walk.sourceTypes.structuralObjectForCarrier(writeSelection.abi.valueCarrier);
    assert.equal(readShape?.sourceType === writeShape?.sourceType && readShape !== undefined, true,
      "native role selection does not manufacture a second checked SourceType");
    assert.equal(readShape.fields.every((field, index) => field.declarations.every((declaration, memberIndex) =>
      declaration === writeShape.fields[index].declarations[memberIndex])), true,
    "all native roles retain the identical original checked member Nodes");
    assert.equal(readShape.fields.every((field, index) => field.symbols.length === writeShape.fields[index].symbols.length &&
      field.symbols.every((symbol, memberIndex) => symbol === writeShape.fields[index].symbols[memberIndex])), true,
    "all native roles retain the identical original checked member Symbols");
    const canonical = walk.sourceTypes.structuralObjectForType(readShape.sourceType);
    assert.equal(canonical?.fields.every(field => !field.readonly), true, "the bare logical Reader template remains untouched");
    assert.equal(rustTargetTypeRefEquals(canonical.carrier, readSelection.abi.valueCarrier), true,
      "the data reader consumes the original complete native carrier");
    assert.equal(rustTargetTypeRefEquals(canonical.carrier, writeSelection.abi.valueCarrier), true,
      "the data writer consumes the same original complete native carrier");
    assert.equal(walk.sourceTypes.structuralObjects().some(shape => shape.sourceType === readShape.sourceType &&
      !rustTargetTypeRefEquals(shape.carrier, canonical.carrier)), false,
    "data-only formals publish no gratuitous replacement shape");
    assert.equal(context.records.sourceParameterAbi.get(readParameter) === readSelection.abi, true, "body bindings retain the published read ABI identity");
    assert.equal(context.records.sourceParameterAbi.get(writeParameter) === writeSelection.abi, true, "body bindings retain the published writer ABI identity");
  });

  test(`${label} closed method formals preserve original checked identity under exact declared write demand`, () => {
    const { context, walk } = analyzeRustOperations(`
type Reader = { first(): number; second(): number; };
function read(owner: Reader): number { return owner.first() + owner.second(); }
export function run(): number {
  const owner = { first(): number { return 1; }, second(): number { return 2; } };
  return read(owner);
}
`, { surfaces });
    const { ast } = context;
    const declarations = context.sourceStorage.nodes.filter(node => ast.is.IsFunctionDeclaration(node) && ast.body(node) !== undefined);
    const read = declarations.find(node => ast.text(ast.name(node)) === "read");
    assert.equal(read !== undefined, true, "the actual closed method reader has an implementation body");
    const calls = context.sourceStorage.nodes.filter(node => ast.is.IsCallExpression(node));
    assert.equal(calls.length, 3, "the original closed producer retains its function call and both method calls");
    for (const call of calls) {
      const checked = context.semanticsFor(call).operations.call(call);
      const operation = context.records.selectedOperation.get(call);
      assert.equal(checked !== undefined && operation !== undefined, true, "each original invocation has its checked source and one selected operation");
      assert.equal(operation.provenance?.sourceExpression === call, true, "the selected operation retains its original invocation Node");
      assert.equal(operation.provenance?.sourceSelectedSignature === checked.selectedSignature, true,
        "the operation retains the actual checked selected signature, not a reconstructed native header");
      const callee = checked.sourceCalleeAccess === undefined ? checked.sourceCallee : checked.sourceCalleeAccess;
      const receiver = checked.sourceCalleeAccess === undefined ? checked.sourceReceiver?.expression : checked.sourceCalleeAccess.receiver.expression;
      assert.equal(operation.provenance?.sourceReceiver === receiver, true,
        "method receiver identity and genuine function-call receiver absence are preserved");
      assert.equal(operation.provenance?.sourceCallee === checked.sourceCallee.expression, true,
        "the original checked callable operand is not reconstructed from emitted syntax");
      assert.equal(operation.provenance?.sourceSelectedDeclaration === callee.selectedDeclaration &&
        operation.provenance?.sourceSelectedSymbol === callee.selectedSymbol, true,
      "the actual selected member declaration and Symbol remain one checked correspondence");
    }
    const readParameter = ast.parameters(read)[0];
    const readDemand = context.sourceStorage.formalMemberWriteDemand(read, readParameter);
    assert.equal(readDemand.kind, "complete", "the reader has complete shared write-demand evidence");
    assert.equal(readDemand.members.length, 0, "a reader is not polluted by a sibling writer's demand");
    const readSelection = walk.sourceCallableAbi.resolveParameterAbi(readParameter, rustResolutionContext(walk, readParameter), walk.operationOptions);
    assert.equal(readSelection?.kind, "resolved", "the actual no-write method formal has an admitted native ABI");
    const readShape = walk.sourceTypes.structuralObjectForCarrier(readSelection.abi.valueCarrier);
    const declared = readShape.fields.find(field => field.sourceName === "second");
    assert.equal(declared?.method === true && declared.declarations.length === 1 && declared.symbols.length !== 0, true,
      "the declaration permission control uses the exact checked method and its original Symbol");
    let queries = 0;
    const resolver = createRustSourceCallableAbiResolver({
      isNativeCallableExpression: walk.moduleBindings.isNativeCallableExpression,
      parameterAbiFor: () => undefined,
    });
    const original = rustResolutionContext(walk, readParameter);
    const writeSelection = resolver.resolveParameterAbi(readParameter, { ...original, sourceStorage: { ...context.sourceStorage,
      formalMemberWriteDemand(owner, parameter) {
        assert.equal(owner === read && parameter === readParameter, true, "the permission query retains the actual implementation and formal");
        queries++;
        return Object.freeze({ kind: "complete", members: Object.freeze([declared.declarations[0]]) });
      },
    } }, walk.operationOptions);
    assert.equal(writeSelection?.kind, "resolved", "exact declared write permission does not invent or require a replacement ABI");
    assert.equal(queries, 1, "declared method permission reads the existing shared summary exactly once");
    const writeShape = walk.sourceTypes.structuralObjectForCarrier(writeSelection.abi.valueCarrier);
    const written = writeShape.fields.find(field => field.sourceName === "second");
    assert.equal(written?.method, true, "the demand targets the actual native method, not an unrelated data field");
    assert.equal(written.readonly, false, "the declared method permission remains unchanged, not native slot proof");
    assert.equal(written.declarations.includes(declared.declarations[0]), true, "the shared demand retains its exact original member declaration");
    assert.equal(readShape.sourceType === writeShape.sourceType, true, "the two method uses retain one checked source identity");
    assert.equal(readShape.fields.every((field, index) => field.declarations.length === writeShape.fields[index].declarations.length &&
      field.declarations.every((declaration, memberIndex) => declaration === writeShape.fields[index].declarations[memberIndex]) &&
      field.symbols.length === writeShape.fields[index].symbols.length &&
      field.symbols.every((symbol, symbolIndex) => symbol === writeShape.fields[index].symbols[symbolIndex])), true,
    "all method fields retain the original complete declaration and symbol correspondence");
    const canonical = walk.sourceTypes.structuralObjectForType(readShape.sourceType);
    assert.equal(rustTargetTypeRefEquals(canonical.carrier, readSelection.abi.valueCarrier), true,
      "a no-write method formal retains its original native contract");
    assert.equal(rustTargetTypeRefEquals(canonical.carrier, writeSelection.abi.valueCarrier), true,
      "declared write permission does not create a native facet or claim physical write admission");
    assert.equal(writeSelection.abi.mode, readSelection.abi.mode, "declared permission preserves native passing mode");
    assert.equal(writeSelection.abi.form, readSelection.abi.form, "declared permission preserves the original required/default/rest form");
    assert.equal(rustTargetTypeRefEquals(writeSelection.abi.parameterCarrier, readSelection.abi.parameterCarrier), true,
      "declared permission preserves the exact physical parameter header and native lifetime");
    assert.equal(context.records.sourceParameterAbi.get(readParameter) === readSelection.abi, true,
      "a unit permission query cannot replace the actual closed program's published ABI");
  });

  test(`${label} shared-formal method replacement has one precise Rust v1 write-admission refusal`, () => {
    const { result, source } = compileRust({ surfaces, files: { "index.ts": `
type Reader = { first(): number; second(): number; };
export function read(owner: Reader): number { return owner.first() + owner.second(); }
export function replace(owner: Reader): void { const alias = owner; alias.second = () => 9; }
` } });
    const checked = createTargetSourceProgram(source);
    const storage = createSourceStorageQuery(checked, checked.sourceFiles);
    const { ast } = checked;
    const read = storage.nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "read");
    const replace = storage.nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "replace");
    const reader = storage.nodes.find(node => ast.is.IsTypeAliasDeclaration(node) && ast.text(ast.name(node)) === "Reader");
    assert.equal(read !== undefined && replace !== undefined && reader !== undefined, true,
      "the original complete read/write program retains its actual checked declarations");
    const readDemand = storage.formalMemberWriteDemand(read, ast.parameters(read)[0]);
    const writeDemand = storage.formalMemberWriteDemand(replace, ast.parameters(replace)[0]);
    const member = ast.members(ast.typeNode(reader)).find(node => ast.text(ast.name(node)) === "second");
    assert.equal(readDemand.kind === "complete" && readDemand.members.length === 0, true,
      "the original source reader has no sibling write demand");
    assert.equal(writeDemand.kind === "complete" && writeDemand.members.length === 1 && writeDemand.members[0] === member, true,
      "the actual qualified alias demands exactly the original checked method Node");
    const symbol = checked.navigation.declarationSymbol(member, ast.getSourceFile(member));
    assert.equal(symbol !== undefined && checked.navigation.declarationSymbol(writeDemand.members[0], ast.getSourceFile(member)) === symbol, true,
      "the refusal preserves the original checked member Symbol rather than a name-based replacement");
    const assignment = storage.nodes.find(node => ast.is.IsBinaryExpression(node) &&
      ast.kindName(ast.as.AsBinaryExpression(node).OperatorToken) === "KindEqualsToken");
    const target = assignment === undefined ? undefined : ast.as.AsBinaryExpression(assignment).Left;
    assert.equal(target !== undefined, true, "the refusal retains the actual original method-write target");
    assert.equal(result.diagnostics.length, 1, "the explicit v1 cut has one source write-admission diagnostic");
    assert.equal(result.diagnostics[0].code, "RUST_STRUCTURAL_METHOD_WRITE_UNSUPPORTED",
      "method replacement is refused at its existing source write-admission owner");
    assert.equal(result.diagnostics[0].message,
      "Rust v1 does not support replacing a structural method through a shared source parameter or its alias.",
      "the diagnostic states an explicit v1 scope cut, not native impossibility");
    assert.equal(result.diagnostics[0].sourceNode === target, true, "the diagnostic retains the exact original write target");
    assert.equal(result.artifacts.length, 0, "the unsupported program publishes no native artifacts");
  });
}

test("native formal refusal retains the exact unknown and budget reasons and rejects same-spelled foreign members", () => {
  const { context, walk } = analyzeRustOperations(`
type Reader = { value(): number; };
type Other = { value(): number; };
function read(owner: Reader): number { return owner.value(); }
export function run(): number {
  const owner = { value(): number { return 1; } };
  return read(owner);
}
`);
  const { ast } = context;
  const declaration = context.sourceStorage.nodes.find(node => ast.is.IsFunctionDeclaration(node) &&
    ast.body(node) !== undefined && ast.text(ast.name(node)) === "read");
  assert.equal(declaration !== undefined, true, "the closed producer reaches the exact original read implementation");
  const parameter = ast.parameters(declaration)[0];
  const published = context.records.sourceParameterAbi.get(parameter);
  assert.equal(published !== undefined, true, "the real closed producer admits the original formal before negative injection");
  const original = rustResolutionContext(walk, parameter);
  for (const reason of ["The actual callee is unknown.", "The finite source member-write budget is exhausted."]) {
    let queries = 0;
    const resolver = createRustSourceCallableAbiResolver({ isNativeCallableExpression: () => true, parameterAbiFor: () => undefined });
    const selection = resolver.resolveParameterAbi(parameter, { ...original, sourceStorage: { ...context.sourceStorage,
      formalMemberWriteDemand(owner, input) {
        assert.equal(owner === declaration && input === parameter, true, "the summary query uses the original implementation and value parameter");
        queries++;
        return Object.freeze({ kind: "unresolved", reason });
      },
    } }, walk.operationOptions);
    assert.equal(selection?.kind, "rejected", "uncertainty is a typed refusal, never pending or an empty demand");
    assert.equal(selection.reason, reason, "the canonical producer reason is retained without reclassification");
    assert.equal(queries, 1, "one actual native selection reads the sealed shared demand once");
    assert.equal(context.records.sourceParameterAbi.get(parameter) === published, true, "a rejected open query cannot replace an admitted ABI");
  }
  const other = context.sourceStorage.nodes.find(node => ast.is.IsTypeAliasDeclaration(node) && ast.text(ast.name(node)) === "Other");
  const foreignMember = ast.members(ast.typeNode(other))[0];
  assert.equal(foreignMember !== undefined, true, "the negative member is an actual checked declaration, not a spelling guess");
  const resolver = createRustSourceCallableAbiResolver({ isNativeCallableExpression: () => true, parameterAbiFor: () => undefined });
  const selected = resolver.resolveParameterAbi(parameter, { ...original, sourceStorage: { ...context.sourceStorage,
    formalMemberWriteDemand: () => Object.freeze({ kind: "complete", members: Object.freeze([foreignMember]) }),
  } }, walk.operationOptions);
  assert.equal(selected?.kind, "rejected", "a same-spelled foreign member cannot borrow another source slot's identity");
  assert.equal(selected.reason, "Formal member-write demand requires one exact original checked native field correspondence.",
    "unmapped original member evidence is a precise refusal");
});

test("selected native callable inputs retain logical arrays and exact physical mutability", () => {
  const { program } = analyzeRust({ files: { "index.ts": borrowedCallbackInputSource } });
  const { ast } = program.source;
  const selected = [];
  const visit = node => {
    if (ast.is.IsCallExpression(node)) {
      const operation = program.records.targetOperation.get(node);
      if (operation?.kind === "source-call" && operation.target.form === "callable") {
        selected.push(operation);
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(selected.length, 4, "both callback bodies retain both repeated invocations");
  assert.equal(selected.filter(operation => operation.parameters[0]?.mode === "mut-ref").length, 2);
  assert.equal(selected.filter(operation => operation.parameters[0]?.mode === "ref").length, 2);
  for (const operation of selected) {
    const parameter = operation.parameters[0];
    assert.equal(parameter.valueCarrier.kind, "array");
    assert.equal(parameter.parameterCarrier.kind, "reference");
    assert.equal(parameter.parameterCarrier.referent.kind, "slice");
    assert.equal(parameter.parameterCarrier.mutable, parameter.mode === "mut-ref");
    assert.deepEqual(parameter.inputs[0].carrier, parameter.valueCarrier);
    assert.deepEqual(parameter.valueCarrier.element, rustSourcePrimitiveTargetType("float64"));
  }
});

test("a selected readonly callable does not admit a mutable source body", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
function invoke(values: readonly number[], apply: (items: readonly number[]) => number): number {
  return apply(values);
}
export function run(): number { return invoke([1, 2], items => { items[0] += 1; return items[0]; }); }
` } }), /TS2542: Index signature in type 'readonly number\[\]' only permits reading/u);
});
