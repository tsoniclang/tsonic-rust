import { resolve } from "node:path";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { fixtureCratesRoot } from "./paths.mjs";

const moduleSpecifier = "@acme/attributes";
const identifier = name => `${moduleSpecifier}::${name}`;
const integer = { kind: "source-primitive", name: "int32" };
const fields = [
  { id: identifier("Shape.domain"), name: "domain", kind: "property", type: integer },
  { id: identifier("Shape.block"), name: "block", kind: "property", type: { kind: "tuple", elementTypes: [integer, integer, integer] } },
];

export function attributeDefinition() {
  const functions = [
    ["offset", [{ name: "amount", type: integer }]],
    ["moduleContract", []], ["entry", []], ["deriveProbe", []],
    ["launchShape", [{ name: "shape", type: { kind: "provider-ref", moduleSpecifier, exportName: "Shape" } }]],
  ];
  const row = (name, path, placements, arguments_ = [], extra = {}) => ({
    exportId: identifier(name), signatureId: identifier(`${name}()`), kind: "attribute", path, placements, arguments: arguments_, ...extra,
  });
  const parent = { exportId: identifier("moduleContract"), signatureId: identifier("moduleContract()") };
  return {
    id: "acme-attributes", displayName: "Native attribute contract", version: "1.0.0",
    modules: [{ moduleSpecifier, providerModuleId: "acme.attributes", exports: [
      ...functions.map(([name, parameters]) => ({ id: identifier(name), name, kind: "function",
        signatures: [{ id: identifier(`${name}()`), parameters, returnType: { kind: "void" } }] })),
      { id: identifier("Shape"), name: "Shape", kind: "interface", members: fields },
    ] }],
    attributes: [
      row("offset", "acme_attributes::offset", ["function"], [{ kind: "integer" }]),
      row("moduleContract", "acme_attributes::module_contract", ["module"]),
      row("entry", "entry", ["function"], [], { requiredParent: parent }),
      row("deriveProbe", "acme_attributes::Probe", ["struct", "enum"], [], { kind: "derive" }),
      row("launchShape", "launch_shape", ["function"], [{ kind: "record", exportId: identifier("Shape"), fields: [
        { memberId: identifier("Shape.domain"), name: "domain", optional: false, schema: { kind: "integer" } },
        { memberId: identifier("Shape.block"), name: "block", optional: false, schema: { kind: "tuple", elements: [{ kind: "integer" }, { kind: "integer" }, { kind: "integer" }] } },
      ] }], { requiredParent: parent }),
    ],
    operations: [],
    crates: [{ crateName: "acme_attributes", cargoPath: resolve(fixtureCratesRoot, "acme_attributes") }],
  };
}

export function attributePackage() { return createRustProviderPackage(attributeDefinition()); }
