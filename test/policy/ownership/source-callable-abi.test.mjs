import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceCallableAbiResolver } from "../../../dist/analysis/callables/source-callable-abi.js";
import { rustCallableTargetType, rustSourcePrimitiveTargetType, rustStructuralObjectTargetType, rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { rustResolutionContext } from "../../../dist/analysis/program/walk.js";
import { selectRustSourceParameterStructuralCarrier } from "../../../dist/policy/ownership/source-parameter-contracts.js";

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

test("native formals preserve original data and method geometry when their contracts already satisfy demand", () => {
  const value = rustSourcePrimitiveTargetType("int32");
  const logical = rustStructuralObjectTargetType("index.ts", [
    { sourceName: "first", type: value, presence: "required", readonly: false },
    { sourceName: "second", type: value, presence: "optional", readonly: false,
      accessor: { getter: true, setter: true } },
  ]);
  const read = selectRustSourceParameterStructuralCarrier(logical, new Set());
  const readFields = rustStructuralObjectCarrierValue(read)?.fields;
  assert.equal(read === logical, true, "an empty demand retains the identical original native carrier");
  assert.equal(readFields?.length, 2, "the native read role keeps every original physical field");
  assert.equal(readFields.every(field => !field.readonly), true, "data-only formals do not acquire gratuitous readonly facets");
  assert.equal(readFields[0].type === value && readFields[1].type === value, true, "exact native value carriers are not widened");
  assert.equal(readFields[0].presence, "required", "required source presence is unchanged");
  assert.equal(readFields[1].presence, "optional", "native absence remains one optional state");
  assert.equal(readFields[1].accessor.setter, true, "the original data accessor contract is unchanged");
  assert.equal(rustStructuralObjectCarrierValue(logical).fields.every(field => !field.readonly), true,
    "the globally declared logical contract is never rewritten");
  const write = selectRustSourceParameterStructuralCarrier(logical, new Set([1]));
  const writeFields = rustStructuralObjectCarrierValue(write)?.fields;
  assert.equal(write === logical, true, "an already-sufficient native data contract keeps the identical carrier");
  assert.equal(writeFields?.[0].readonly === false && writeFields[1].readonly === false, true,
    "a demanded data write does not alter any original native field");
  assert.equal(writeFields[1].accessor.setter, true, "the demanded native setter remains available");
  const readonly = rustStructuralObjectTargetType("index.ts", [
    { sourceName: "first", type: value, presence: "required", readonly: true },
    { sourceName: "second", type: value, presence: "optional", readonly: true,
      accessor: { getter: true, setter: false } },
  ]);
  assert.equal(selectRustSourceParameterStructuralCarrier(readonly, new Set([1])) === undefined, true,
    "an actually readonly native protocol cannot satisfy a write demand");
  assert.equal(selectRustSourceParameterStructuralCarrier(logical, new Set()) === logical, true,
    "an independent selected native protocol is consumed without silently rewriting its input ABI");
  for (const invalid of [-1, 2, 0.5, Number.NaN])
    assert.equal(selectRustSourceParameterStructuralCarrier(logical, new Set([invalid])) === undefined, true,
      "invalid original field index is rejected: " + invalid);
  const direct = rustStructuralObjectTargetType("index.ts", rustStructuralObjectCarrierValue(logical).fields, "value");
  assert.equal(selectRustSourceParameterStructuralCarrier(direct, new Set([1])) === direct, true,
    "a native value carrier keeps its original direct representation and fields");
  const method = rustCallableTargetType([], value);
  const methods = rustStructuralObjectTargetType("index.ts", [
    { sourceName: "first", type: method, presence: "required", readonly: false, method: true },
    { sourceName: "second", type: method, presence: "required", readonly: false, method: true },
  ]);
  assert.equal(selectRustSourceParameterStructuralCarrier(methods, new Set()) === methods, true,
    "a no-write method formal retains its identical native contract");
  assert.equal(selectRustSourceParameterStructuralCarrier(methods, new Set([0])) === methods, true,
    "a demanded native method keeps the original contract when that method is already writable");
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

  test(`${label} demanded methods retain original member identity and an already-sufficient native ABI`, () => {
    const { context, walk } = analyzeRustOperations(`
type Reader = { first(): number; second(): number; };
export function read(owner: Reader): number { return owner.first() + owner.second(); }
export function replace(owner: Reader): void { const alias = owner; alias.second = () => 9; }
`, { surfaces });
    const { ast } = context;
    const declarations = context.sourceStorage.nodes.filter(node => ast.is.IsFunctionDeclaration(node) && ast.body(node) !== undefined);
    const read = declarations.find(node => ast.text(ast.name(node)) === "read");
    const replace = declarations.find(node => ast.text(ast.name(node)) === "replace");
    assert.equal(read !== undefined && replace !== undefined, true, "both genuine method-bearing implementation bodies exist");
    const readParameter = ast.parameters(read)[0];
    const writeParameter = ast.parameters(replace)[0];
    const readDemand = context.sourceStorage.formalMemberWriteDemand(read, readParameter);
    const writeDemand = context.sourceStorage.formalMemberWriteDemand(replace, writeParameter);
    assert.equal(readDemand.kind, "complete", "the reader has complete shared write-demand evidence");
    assert.equal(readDemand.members.length, 0, "a reader is not polluted by a sibling writer's demand");
    assert.equal(writeDemand.kind, "complete", "the qualified local alias has complete shared write-demand evidence");
    assert.equal(writeDemand.members.length, 1, "the alias demands exactly its original written method");
    const readSelection = walk.sourceCallableAbi.resolveParameterAbi(readParameter, rustResolutionContext(walk, readParameter), walk.operationOptions);
    const writeSelection = walk.sourceCallableAbi.resolveParameterAbi(writeParameter, rustResolutionContext(walk, writeParameter), walk.operationOptions);
    assert.equal(readSelection?.kind, "resolved", "the actual no-write method formal has an admitted native ABI");
    assert.equal(writeSelection?.kind, "resolved", "the actual demanded method formal has an admitted native ABI");
    const readShape = walk.sourceTypes.structuralObjectForCarrier(readSelection.abi.valueCarrier);
    const writeShape = walk.sourceTypes.structuralObjectForCarrier(writeSelection.abi.valueCarrier);
    const written = writeShape.fields.find(field => field.sourceName === "second");
    assert.equal(written?.method, true, "the demand targets the actual native method, not an unrelated data field");
    assert.equal(written.readonly, false, "the demanded native method remains writable");
    assert.equal(written.declarations.includes(writeDemand.members[0]), true, "the shared demand retains its exact original member declaration");
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
      "an already-sufficient writable method contract is not replaced by a narrower facet");
    assert.equal(context.records.sourceParameterAbi.get(readParameter) === readSelection.abi, true, "the reader retains its exact published ABI");
    assert.equal(context.records.sourceParameterAbi.get(writeParameter) === writeSelection.abi, true, "the writer retains its exact published ABI");
  });
}

test("native formal refusal retains the exact unknown and budget reasons and rejects same-spelled foreign members", () => {
  const { context, walk } = analyzeRustOperations(`
type Reader = { value(): number; };
type Other = { value(): number; };
export function read(owner: Reader): number { return owner.value(); }
`);
  const { ast } = context;
  const declaration = context.sourceStorage.nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.body(node) !== undefined);
  const parameter = ast.parameters(declaration)[0];
  const published = context.records.sourceParameterAbi.get(parameter);
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
