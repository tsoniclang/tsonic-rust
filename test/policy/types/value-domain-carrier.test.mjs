import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram, Node_Initializer } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { rustValueDomainHasTargetType } from "../../../dist/analysis/objects/value-domain-carriers.js";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { rustEmptyObjectTargetType, rustJsValueTargetType, rustOptionTargetType, rustStructuralObjectTargetType,
  rustSourceTypeCarrier } from "../../../dist/target-model/types/index.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";

function fixture() {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src",
    compilerOptions: { strict: true, target: "es2022", module: "esnext", moduleResolution: "bundler" },
    files: {
      "/src/owner.ts": `
        export class Holder<Value> {
          constructor(public value: Value, public other: Value, public optional?: Value) {}
        }
        export class Stranger<Value> { constructor(public value: Value) {} }
      `,
      "/src/index.ts": `
        import { Holder } from "./owner.js";
        const first = new Holder<object>({}, {});
        const records: Holder<object>[] = [first];
        const pair: [Holder<object>] = [first];
        const selected: object = first.value;
        const optional: object | undefined = first.optional;
      `,
    },
  }).checkSource();
  assert.equal(checked.diagnostics.length, 0, "checked cross-file generic source");
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/src/index.ts");
  const nodes = new Map();
  const visit = node => {
    if (source.ast.is.IsVariableDeclaration(node)) nodes.set(source.ast.text(source.ast.name(node)), node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(file);
  const storage = createSourceStorageQuery(source, source.navigation.sourceFiles);
  const first = storage.subject(nodes.get("first"));
  assert.equal(first.kind, "resolved");
  const firstType = storage.typeFor(first.subject);
  assert.equal(firstType.kind, "resolved");
  const queries = source.semantics.forFile(file);
  const relationship = queries.types.structuralMembers(firstType.type, firstType.type);
  assert.equal(relationship.kind, "available");
  const members = new Map(relationship.members.map(pair => [pair.source.property.name, pair.source]));
  return { source, file, storage, nodes, queries, members, firstType: firstType.type };
}

function domain(input, carrier, projection, root = "first", selected = "selected") {
  const node = input.nodes.get(root);
  const origin = input.storage.subject(node, "value", projection);
  assert.equal(origin.kind, "resolved", "exact projection is interned by shared storage");
  const typed = input.storage.typeFor(origin.subject);
  assert.equal(typed.kind, "resolved", "exact projection has checked selected field type");
  const expression = Node_Initializer(input.source.ast, input.nodes.get(selected));
  const host = {
    sourceStorage: { ...input.storage,
      closedOriginsFor: () => ({ kind: "complete", origins: [{ subject: origin.subject, type: typed.type, sourceFile: typed.sourceFile }] }),
    },
    semantics: file => input.source.semantics.forFile(file),
    types: { resolveNode(selectedNode, file) {
      assert.equal(selectedNode === node && file === input.file, true, "retain original physical owner, never resolve field source type");
      return carrier;
    } },
  };
  return { host, expression, origin: origin.subject };
}

const member = input => ({ kind: "member", declaration: input.members.get("value").declarations[0] });

function structural(input, selected, field = "value", options = {}) {
  const evidence = input.members.get(field);
  const fields = [{ sourceName: field, type: selected, readonly: false,
    presence: field === "optional" ? "optional" : "required" }];
  const carrier = rustStructuralObjectTargetType("/src/owner.ts", fields);
  const registry = createRustSourceTypeRegistry();
  assert.equal(registry.registerStructuralObject({ sourceType: input.firstType, carrier, storage: "structural-object",
    fields: [{ ...evidence, ...options, sourceName: field, sourceType: evidence.property.type,
      symbols: [evidence.property.symbol], declarations: options.declarations ?? evidence.declarations,
      storageIndex: 0, resultCarrier: selected, readonly: false, presence: fields[0].presence }],
  }, { kind: "root" }), true, "exact physical shape is registered");
  return { carrier, registry };
}

test("member origins use exact physical declarations, not equal source types or field names", () => {
  const input = fixture();
  const exact = rustEmptyObjectTargetType();
  for (const actual of [exact, rustJsValueTargetType()]) {
    const shape = structural(input, actual);
    const selected = domain(input, shape.carrier, [member(input)]);
    Object.assign(selected.host, { sourceTypes: shape.registry,
      projectFieldProjection: () => { assert.fail("registered physical fields do not use source-only substitution"); } });
    assert.equal(rustValueDomainHasTargetType(selected.host, selected.expression, exact), actual === exact);
  }
  const shape = structural(input, exact, "value", { declarations: [input.members.get("other").declarations[0]], symbols: [] });
  const selected = domain(input, shape.carrier, [member(input)]);
  Object.assign(selected.host, { sourceTypes: shape.registry, projectFieldProjection: () => undefined });
  assert.equal(rustValueDomainHasTargetType(selected.host, selected.expression, exact), false, "same spelling cannot replace declaration identity");
});

test("member projection composes with exact array and tuple physical owners", () => {
  const input = fixture();
  const exact = rustEmptyObjectTargetType();
  const shape = structural(input, exact);
  for (const [root, carrier, prefix] of [
    ["records", { kind: "array", element: shape.carrier }, { kind: "array-element" }],
    ["pair", { kind: "tuple", elements: [shape.carrier] }, { kind: "tuple-element", index: 0 }],
  ]) {
    const selected = domain(input, carrier, [prefix, member(input)], root);
    Object.assign(selected.host, { sourceTypes: shape.registry, projectFieldProjection: () => undefined });
    assert.equal(rustValueDomainHasTargetType(selected.host, selected.expression, exact), true, root);
  }
});

test("optional physical fields retain their native absence carrier", () => {
  const input = fixture();
  const exact = rustEmptyObjectTargetType();
  const absent = rustOptionTargetType(exact);
  const shape = structural(input, absent, "optional");
  const projection = [{ kind: "member", declaration: input.members.get("optional").declarations[0] }];
  const selected = domain(input, shape.carrier, projection, "first", "optional");
  Object.assign(selected.host, { sourceTypes: shape.registry, projectFieldProjection: () => undefined });
  assert.equal(rustValueDomainHasTargetType(selected.host, selected.expression, exact), false, "no erasure of optional field storage");
  assert.equal(rustValueDomainHasTargetType(selected.host, selected.expression, absent), true);
});

test("nominal generic fields use the physical instantiation and exact checked property", () => {
  const input = fixture();
  const parameter = { kind: "type-parameter", name: "Value", identity: "/src/owner.ts:Holder:Value" };
  const exact = rustEmptyObjectTargetType();
  for (const [root, prefix] of [["first", []], ["records", [{ kind: "array-element" }]], ["pair", [{ kind: "tuple-element", index: 0 }]]]) {
    for (const physical of [exact, rustJsValueTargetType()]) {
      const owner = rustSourceTypeCarrier("/src/owner.ts", "Holder", [{ kind: "type", type: physical }]);
      const carrier = root === "records" ? { kind: "array", element: owner }
        : root === "pair" ? { kind: "tuple", elements: [owner] } : owner;
      const selected = domain(input, carrier, [...prefix, member(input)], root);
      let calls = 0;
      Object.assign(selected.host, { sourceTypes: createRustSourceTypeRegistry(),
        projectFieldProjection(property, actualOwner, ownerType) {
          calls += 1;
          assert.equal(property.symbol === input.members.get("value").property.symbol, true, "selected property symbol, not text");
          assert.equal(property.type === input.members.get("value").property.type, true, "instantiated checked field type");
          assert.equal(ownerType === input.firstType && actualOwner === owner, true, "exact prefix owner type and physical generic instance");
          return { output: substituteRustTargetTypeParameters(parameter, new Map([[parameter.identity, physical]])), field: {} };
        } });
      assert.equal(rustValueDomainHasTargetType(selected.host, selected.expression, exact), physical === exact);
      assert.equal(calls, 1, "one nominal projection, not a second type resolver");
    }
  }
});

test("member proofs fail closed for unavailable, accessor and exhausted evidence", () => {
  const input = fixture();
  const exact = rustEmptyObjectTargetType();
  for (const control of ["missing", "accessor", "method", "budget", "open", "prefix"]) {
    const shape = structural(input, exact, "value", control === "accessor"
      ? { accessor: { getter: true, setter: false } } : control === "method" ? { method: true } : {});
    const selected = domain(input, shape.carrier, [member(input)]);
    Object.assign(selected.host, { sourceTypes: shape.registry, projectFieldProjection: () => undefined });
    if (control === "missing" || control === "prefix") selected.host.sourceTypes = createRustSourceTypeRegistry();
    if (control === "prefix") selected.host.sourceStorage.typeFor = () => ({ kind: "unresolved", reason: "missing prefix" });
    if (control === "budget") selected.host.sourceStorage.failureReason = () => "bounded failure";
    if (control === "open") selected.host.sourceStorage.closedOriginsFor = () => ({ kind: "open", origins: [] });
    assert.equal(rustValueDomainHasTargetType(selected.host, selected.expression, exact), false, control);
  }
});
