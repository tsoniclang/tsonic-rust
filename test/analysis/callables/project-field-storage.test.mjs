import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { prepareRustProjectCallableFieldStorage } from "../../../dist/analysis/callables/project-field-storage.js";
import { rustGenericCallableTargetType, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustFrameCallableTargetType } from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rustCallableInputTargetType, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { receiverFieldCaptureEdges } from "../../../../tsonic/test/fixtures/receiver-field-capture-edges.mjs";

const bool = { kind: "source-primitive", name: "bool" };
const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
const origin = { fileName: "/source.ts", declarationIdentity: "/source.ts:1" };
const generic = rustGenericCallableTargetType([parameter], [parameter], parameter, origin);
const frame = rustFrameCallableTargetType([bool], bool, { kind: "lexical", origin });
const ordinary = rustCallableTargetType([bool], bool);

for (const [label, carrier, required] of [
  ["ordinary callable", ordinary, true],
  ["generic callable", generic, true],
  ["frame callable", frame, true],
  ["formal callable input", rustCallableInputTargetType([bool], bool), true],
  ["nested generic storage", { kind: "tuple", elements: [bool, generic] }, true],
  ["plain native field", bool, false],
  ["fixed function pointer signature", { kind: "function-pointer", args: [generic], result: generic }, false],
  ["native closure signature", { kind: "closure", args: [generic], result: generic, callTrait: "Fn" }, false],
]) test(`project field ${label} has exactly its actual physical storage obligation`, () => {
  assert.equal(carrier !== undefined, true, `${label}: the canonical carrier constructor accepts its actual contract`);
  const declaration = Object.freeze({ label });
  const definition = Object.freeze({ genericParameters: [] });
  const subject = Object.freeze({ node: declaration, kind: "member", projection: [] });
  let selections = 0;
  const construction = prepareRustProjectCallableFieldStorage({
    ast: {}, records: createRustRecordFixture({ runtimeCarrier: { get: node => node === declaration ? { carrier } : undefined } }),
    projectTypes: { definitions: [definition], objectLayoutForDefinition: () => ({ fields: [{ declaration }] }) },
    storage: { subject(node, kind) {
      assert.equal(node === declaration && kind === "member", true, `${label}: selection uses its actual original member`);
      return { kind: "resolved", subject };
    }, failureReason: () => undefined },
  }, (selected, logical) => {
    selections++;
    assert.equal(selected === subject && logical === carrier, true, `${label}: the native owner receives the complete unchanged field input`);
    return { kind: "unresolved", reason: "fixture has no admitted physical constructor" };
  });
  const sealed = construction.seal();
  assert.equal(selections, required ? 1 : 0, `${label}: native signatures are not traversed as stored payloads`);
  assert.equal(sealed.kind, required ? "rejected" : "resolved", `${label}: missing required physical storage is never silently omitted`);
  if (required) {
    assert.equal(sealed.diagnostics.length, 1, `${label}: the one field has one owning refusal`);
    assert.equal(sealed.diagnostics[0].sourceNode === declaration, true, `${label}: refusal keeps the original field identity`);
    assert.equal(sealed.diagnostics[0].message, "fixture has no admitted physical constructor", `${label}: the native owner's exact refusal survives`);
  } else assert.equal(sealed.value.get(declaration), undefined, `${label}: plain native storage has no invented callable body`);
});

for (const surfaces of [[], ["js"]]) test(`checked generic receiver fields publish physical storage in ${surfaces[0] ?? "native"}`, () => {
  const example = receiverFieldCaptureEdges.find(value => value.name === "generic-callable-aliases");
  assert.equal(example !== undefined, true, "the original alias/replacement native program remains the control");
  const { program } = analyzeRust({ surfaces, files: { "index.ts": example.source } });
  const { ast } = program.source;
  const fields = [];
  const visit = node => {
    if (ast.is.IsPropertyDeclaration(node) && ast.text(ast.name(node)) === "choose") fields.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(fields.length, 1, "the source has one actual generic field slot");
  const declaration = fields[0];
  const logical = program.records.runtimeCarrier.get(declaration)?.carrier;
  assert.equal(rustGenericCallableValue(logical) !== undefined, true, "the original checked logical field is quantified");
  const physical = program.callableValues.projectFieldStorage.get(declaration);
  assert.equal(rustGenericCallableValue(physical)?.physical !== undefined, true, "the native field has its completed physical family");
  assert.equal(program.callableValues.projectFieldStorage.get(declaration) === physical, true,
    "the published reader retains the single original native storage selection");
  assert.equal(Object.isFrozen(physical), true, "the final native storage is immutable");
});
