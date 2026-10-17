import assert from "node:assert/strict";
import { test } from "node:test";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { rustSourceUnionTargetType, rustJsValueTargetType } from "../../../dist/target-model/types/index.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";
import { rustTypeGenericArguments } from "../../../dist/target-model/types/generic-arguments.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { checkRustSession, createRustSession } from "../../helpers/rust-session.mjs";

const int32Carrier = { kind: "source-primitive", name: "int32" };
const float64Carrier = { kind: "source-primitive", name: "float64" };
const receiverCarrier = {
  kind: "target-specific",
  target: "rust",
  name: "structural-object",
  value: {
    ownerFileName: "/src/index.ts",
    representation: "reference",
    bases: [],
    fields: [{
      sourceName: "value",
      type: int32Carrier,
      presence: "required",
      readonly: false,
    }],
  },
};

function structuralShape(sourceType, declaration, symbol, resultCarrier = int32Carrier) {
  return {
    sourceType,
    carrier: receiverCarrier,
    storage: "structural-object",
    fields: [{
      declarations: [declaration],
      symbols: [symbol],
      sourceName: "value",
      sourceType: {},
      storageIndex: 0,
      resultCarrier,
      presence: "required",
    }],
  };
}

test("equivalent compiler type wrappers share one exact structural field projection", () => {
  const registry = createRustSourceTypeRegistry();
  const declaration = {};
  const firstSymbol = {};
  const secondSymbol = {};
  assert.equal(registry.registerStructuralObject(
    structuralShape({}, declaration, firstSymbol),
  ), true);
  assert.equal(registry.registerStructuralObject(
    structuralShape({}, declaration, secondSymbol),
  ), true);

  const projection = registry.structuralFieldProjectionForDeclaration(
    declaration,
    receiverCarrier,
  );
  assert.equal(projection?.field.storageIndex, 0);
  assert.deepEqual(registry.declarationsForSelectedSymbol(firstSymbol), [declaration]);
  assert.deepEqual(registry.declarationsForSelectedSymbol(secondSymbol), [declaration]);
});

test("conflicting structural projections for one declaration fail closed", () => {
  const registry = createRustSourceTypeRegistry();
  const declaration = {};
  assert.equal(registry.registerStructuralObject(
    structuralShape({}, declaration, {}),
  ), true);
  assert.equal(registry.registerStructuralObject(
    structuralShape({}, declaration, {}, float64Carrier),
  ), false);

  assert.deepEqual(
    registry.structuralFieldProjectionForDeclaration(declaration, receiverCarrier)?.field.resultCarrier,
    int32Carrier,
  );
});

test("collapsed semantic unions index their exact authored arm without losing closed carrier identity", () => {
  for (const collapsed of [false, true]) {
    const registry = createRustSourceTypeRegistry();
    const broad = {};
    const nominal = {};
    const overall = collapsed ? broad : {};
    const broadCarrier = rustJsValueTargetType();
    const carrier = rustSourceUnionTargetType("/src/index.ts", "Union2",
      [], "generated", { kind: "physical", types: [broadCarrier, int32Carrier] });
    const union = { sourceType: overall, carrier, selectedProperties: [], variants: [
      { name: "Variant0", carrier: broadCarrier, sourceTypes: [broad] },
      { name: "Variant1", carrier: int32Carrier, sourceTypes: [nominal] },
    ] };
    assert.equal(registry.registerSourceUnion(union), true);
    assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [overall]), collapsed ? [0] : [0, 1]);
    assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [broad]), [0]);
    assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [nominal]), [1]);
    assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [broad, nominal]), [0, 1]);
    const stored = registry.sourceUnionForCarrier(carrier);
    assert.ok(stored);
    assert.equal(Object.isFrozen(stored), true);
    assert.equal(Object.isFrozen(stored.variants), true);
    assert.equal(registry.registerSourceUnion({ ...union, variants: [
      union.variants[0], { ...union.variants[1], sourceTypes: [broad] },
    ] }), false);
    assert.equal(registry.sourceUnionForCarrier(carrier), stored);
    assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [nominal]), [1]);
  }
  const registry = createRustSourceTypeRegistry();
  const broadCarrier = rustJsValueTargetType();
  const carrier = rustSourceUnionTargetType("/src/index.ts", "Union2",
    [], "generated", { kind: "physical", types: [broadCarrier, int32Carrier] });
  const shared = {};
  assert.equal(registry.registerSourceUnion({ sourceType: shared, carrier, selectedProperties: [], variants: [
    { name: "Variant0", carrier: broadCarrier, sourceTypes: [shared] },
    { name: "Variant1", carrier: int32Carrier, sourceTypes: [shared] },
  ] }), false);
  assert.equal(registry.sourceUnionForCarrier(carrier), undefined);
});

function checkedDeclarations(files) {
  const source = createTargetSourceProgram(checkRustSession(createRustSession({ surfaces: [], files })));
  const ast = source.ast;
  const nodes = new Map();
  const sourceFiles = Object.keys(files).map(name => source.sourceFiles.find(file =>
    ast.getFileName(file) === `/src/${name}`));
  for (const file of sourceFiles) {
    assert.equal(file !== undefined, true, "the exact checked registry source exists");
    const pending = [file];
    while (pending.length !== 0) {
      const node = pending.pop();
      if (ast.is.IsClassDeclaration(node) || ast.is.IsClassExpression(node) || ast.is.IsInterfaceDeclaration(node) ||
        ast.is.IsEnumDeclaration(node) || ast.is.IsTypeAliasDeclaration(node)) {
        const name = ast.name(node);
        if (name !== undefined) nodes.set(`${ast.getFileName(file)}:${ast.text(name)}`, node);
      }
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
  }
  const declaration = (name, file = "index.ts") => {
    const node = nodes.get(`/src/${file}:${name}`);
    assert.equal(node !== undefined, true, `${file}:${name}: actual checked declaration`);
    return node;
  };
  return { ast, sourceFiles, declaration };
}

test("only admitted native nominal declarations reserve a carrier and lookup never synthesizes erased aliases", () => {
  const current = checkedDeclarations({ "index.ts": `
    export class Active { value = 1; }
    export interface Holder { value: number; }
    export enum Choice { First, Second }
    export type Color = "red" | "blue";
    export type Scalar = number;
    export type Structure = { value: number };
    function unused() { class Erased {} const expression = class Hidden {}; }
  ` });
  const registry = createRustSourceTypeRegistry();
  const erased = new Set([current.declaration("Erased"), current.declaration("Hidden")]);
  assert.equal(registry.carrierForDeclaration.length, 1, "the retired AST-computing query signature is absent");
  for (const file of current.sourceFiles) registry.registerSourceFile(file, current.ast, node => !erased.has(node));
  for (const name of ["Active", "Holder", "Choice", "Color"]) {
    const declaration = current.declaration(name);
    const selected = registry.carrierForDeclaration(declaration);
    assert.equal(selected !== undefined, true, `${name}: admitted nominal reservation`);
    assert.equal(registry.declarationForCarrier(selected) === declaration, true, `${name}: exact reverse identity`);
    assert.equal(registry.carrierForDeclaration(declaration) === selected, true, `${name}: repeated lookup is data only`);
  }
  for (const name of ["Erased", "Hidden", "Scalar", "Structure"])
    assert.equal(registry.carrierForDeclaration(current.declaration(name)) === undefined, true,
      `${name}: a printable source name is not native admission`);
  let reads = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { reads += 1; throw new Error("not owned"); } });
  assert.equal(registry.carrierForDeclaration(foreign) === undefined, true, "foreign declaration is absent");
  assert.equal(reads, 0, "the pure reader inspects no source properties");
});

test("one admitted nominal reservation transitions to one exact structural alias without losing pending instances", () => {
  const current = checkedDeclarations({ "index.ts": "export interface Holder { value: number; }" });
  const declaration = current.declaration("Holder");
  const registry = createRustSourceTypeRegistry();
  registry.registerSourceFile(current.sourceFiles[0], current.ast, () => true);
  const nominal = registry.carrierForDeclaration(declaration);
  const first = { ...structuralShape({}, {}, {}), sourceAlias: declaration };
  assert.equal(registry.registerStructuralObject(first), true, "a nominal reservation is not a finalized structural template");
  assert.equal(registry.registerRepresentationAlias(declaration, receiverCarrier), true, "the actual representation replaces the reservation");
  assert.equal(registry.carrierForDeclaration(declaration) === receiverCarrier, true, "one selected representation is published");
  assert.equal(registry.declarationForCarrier(nominal) === undefined, true, "superseded nominal identity is not left printable");
  const second = { ...structuralShape({}, {}, {}), sourceAlias: declaration };
  assert.equal(registry.registerStructuralObject(second), true, "subsequent checked wrappers share the selected template");
  assert.equal(registry.registerRepresentationAlias(declaration, receiverCarrier), true, "an identical finalized alias is stable");
  assert.equal(registry.registerRepresentationAlias(declaration, int32Carrier), false, "a second selected representation is refused");
  assert.equal(registry.carrierForDeclaration(declaration) === receiverCarrier, true, "failed replacement preserves exact prior identity");
  assert.equal(registry.structuralObjects().length, 2, "both admitted checked source wrappers remain registered");
});

test("native base aliases preserve their real declaration and failed reverse conflicts write nothing", () => {
  const current = checkedDeclarations({
    "index.ts": "export class Value {} export interface Facade {} export type Union = number | string;",
    "other.ts": "export class Value {} export type Other = number | string;",
  });
  const registry = createRustSourceTypeRegistry();
  for (const file of current.sourceFiles) registry.registerSourceFile(file, current.ast, () => true);
  const first = current.declaration("Value");
  const second = current.declaration("Value", "other.ts");
  const firstCarrier = registry.carrierForDeclaration(first);
  const secondCarrier = registry.carrierForDeclaration(second);
  assert.equal(rustTargetTypeRefEquals(firstCarrier, secondCarrier), false, "native identity includes the actual source file");
  const facade = current.declaration("Facade");
  assert.equal(registry.registerRepresentationAlias(facade, firstCarrier), true, "an explicit facade selects its actual native base");
  assert.equal(registry.declarationForCarrier(firstCarrier) === first, true, "alias publication never steals the native owner's reverse key");
  const union = current.declaration("Union");
  assert.equal(registry.registerDeclarationCarrier(union, firstCarrier), false, "a second declaration cannot take the native reverse identity");
  assert.equal(registry.carrierForDeclaration(union) === undefined, true, "failed registration leaves no selected entry");
  assert.equal(registry.declarationForCarrier(firstCarrier) === first, true, "failed registration leaves reverse identity untouched");
  const reserved = rustSourceUnionTargetType("/src/index.ts", "Union");
  assert.equal(registry.reserveSourceUnion(union, reserved), true, "one forward union reservation is admitted");
  const other = current.declaration("Other", "other.ts");
  assert.equal(registry.reserveSourceUnion(other, reserved), false, "a conflicting forward reservation is rejected before mutation");
  assert.equal(registry.carrierForDeclaration(other) === undefined, true, "failed forward reservation leaves no partial entry");
  assert.equal(registry.pendingSourceUnions().length, 1, "only the original real reservation is pending");
  assert.equal(registry.pendingSourceUnions()[0] === union, true, "the exact original union remains pending");
  assert.equal(registry.declarationForCarrier(reserved) === union, true, "forward and finalized queries have one owner");
});

test("nullable generic authored union completion preserves its first template and rejects conflicting definitions atomically", () => {
  const current = checkedDeclarations({ "index.ts": "export type Packet<Value> = Value | string;" });
  const declaration = current.declaration("Packet");
  const registry = createRustSourceTypeRegistry();
  const parameter = { kind: "type-parameter", name: "Value", identity: "registry:Packet:Value" };
  const template = rustSourceUnionTargetType("/src/index.ts", "Packet", rustTypeGenericArguments([parameter]));
  const nullable = rustSourceOptionalTargetType(template);
  assert.equal(registry.reserveSourceUnion(declaration, nullable), true, "the actual absence wrapper is reserved once");
  const left = {};
  const right = {};
  const sourceType = {};
  const selected = { declaration, sourceType, carrier: template, selectedProperties: [], variants: [
    { name: "Variant0", carrier: parameter, sourceTypes: [left] },
    { name: "Variant1", carrier: float64Carrier, sourceTypes: [right] },
  ] };
  assert.equal(registry.registerSourceUnion(selected), true, "the template completes its existing reservation");
  const stored = registry.sourceUnionForCarrier(template);
  const instance = rustSourceUnionTargetType("/src/index.ts", "Packet", rustTypeGenericArguments([int32Carrier]));
  assert.equal(registry.registerSourceUnion({ ...selected, carrier: instance, sourceType: {}, variants: [
    { name: "Variant0", carrier: int32Carrier, sourceTypes: [{}] },
    { name: "Variant1", carrier: float64Carrier, sourceTypes: [{}] },
  ] }), true, "a concrete generic application has its exact payloads");
  assert.equal(registry.carrierForDeclaration(declaration) === nullable, true, "a concrete application cannot replace the nullable declaration template");
  assert.equal(registry.sourceUnionForCarrier(template) === stored, true, "the first authored definition remains canonical");
  assert.equal(registry.pendingSourceUnions().length, 0, "the forward template is completed");
  assert.equal(registry.registerSourceUnion({ ...selected, variants: [
    selected.variants[0], { ...selected.variants[1], carrier: int32Carrier },
  ] }), false, "a contradictory definition cannot alter the admitted type definition");
  assert.equal(registry.sourceUnionForCarrier(template) === stored, true, "failed union write leaves prior definition untouched");
  assert.equal(registry.carrierForDeclaration(declaration) === nullable, true, "failed union write preserves the same selected declaration entry");
});

test("merged interfaces and native classes reserve one real class identity in either source order", () => {
  for (const interfaceFirst of [false, true]) {
    const declarations = ["export interface Combined { value: number; }", "export class Combined { value = 1; }"];
    const current = checkedDeclarations({ "index.ts": (interfaceFirst ? declarations : declarations.toReversed()).join("\n") });
    const registry = createRustSourceTypeRegistry();
    const file = current.sourceFiles[0];
    const members = current.ast.statements(file).filter(node => node !== undefined);
    const declaration = members.find(current.ast.is.IsClassDeclaration);
    const merged = members.find(current.ast.is.IsInterfaceDeclaration);
    assert.equal(declaration !== undefined && merged !== undefined, true, "the checked merge retains both actual declarations");
    registry.registerSourceFile(file, current.ast, () => true);
    const carrier = registry.carrierForDeclaration(declaration);
    assert.equal(carrier !== undefined, true, "the actual native class is admitted in either source order");
    assert.equal(rustTargetTypeRefEquals(registry.carrierForDeclaration(merged), carrier), true,
      "the interface reservation names the same real native representation");
    assert.equal(registry.registerRepresentationAlias(merged, carrier), true, "the merged facade completes through the same alias owner");
    assert.equal(registry.declarationForCarrier(carrier) === declaration, true,
      "the facade cannot displace the class's actual constructor and fields");
  }
});
