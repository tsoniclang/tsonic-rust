import {
  createRustProviderPackage,
  emptyRustGenerics,
  rustCloneTrait,
  rustCopyTrait,
  rustProviderPathTargetType,
} from "../../../dist/public/provider.js";
import { fixtureCratesRoot } from "./paths.mjs";
import { int32Carrier, stringCarrier, unitCarrier } from "./provider-core.mjs";
import { relative, resolve } from "node:path";

export const vectorCarrier = rustProviderPathTargetType({
  owner: { packageId: "acme-vectors", packageVersion: "1.0.0" },
  itemId: "acme.vectors.Vector",
  displayPath: "acme_vectors::Vector",
  traitImplementations: [
    { trait: rustCloneTrait, requirements: [] },
    { trait: rustCopyTrait, requirements: [] },
  ],
});

export function acmeVectorsPackage() {
  return createRustProviderPackage({
    id: "acme-vectors",
    displayName: "Acme vectors",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/vectors",
      providerModuleId: "acme.vectors",
      exports: [
        {
          id: "@acme/vectors::magnitude",
          name: "magnitude",
          kind: "function",
          signatures: [{
            id: "@acme/vectors::magnitude(v)",
            name: "magnitude",
            parameters: [{ name: "v", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } }],
            returnType: { kind: "source-primitive", name: "int32" },
          }],
        },
        {
          id: "@acme/vectors::consume",
          name: "consume",
          kind: "function",
          signatures: [{
            id: "@acme/vectors::consume(v)",
            name: "consume",
            parameters: [{ name: "v", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } }],
            returnType: { kind: "source-primitive", name: "int32" },
          }],
        },
        {
          id: "@acme/vectors::scale",
          name: "scale",
          kind: "function",
          signatures: [{
            id: "@acme/vectors::scale(v,factor)",
            name: "scale",
            parameters: [
              { name: "v", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } },
              { name: "factor", type: { kind: "source-primitive", name: "int32" } },
            ],
            returnType: { kind: "void" },
          }],
        },
        {
          id: "@acme/vectors::mutateBoth",
          name: "mutateBoth",
          kind: "function",
          signatures: [{
            id: "@acme/vectors::mutateBoth(left,right)",
            name: "mutateBoth",
            parameters: [
              { name: "left", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } },
              { name: "right", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } },
            ],
            returnType: { kind: "void" },
          }],
        },
        {
          id: "@acme/vectors::Vector",
          name: "Vector",
          kind: "class",
          members: [
            {
              id: "@acme/vectors::Vector.constructor",
              name: "constructor",
              kind: "constructor",
              signatures: [{
                id: "@acme/vectors::Vector.constructor(x,y)",
                parameters: [
                  { name: "x", type: { kind: "source-primitive", name: "int32" } },
                  { name: "y", type: { kind: "source-primitive", name: "int32" } },
                ],
              }],
            },
            { id: "@acme/vectors::Vector.x", name: "x", kind: "property", readonly: true, type: { kind: "source-primitive", name: "int32" } },
            { id: "@acme/vectors::Vector.y", name: "y", kind: "property", readonly: true, type: { kind: "source-primitive", name: "int32" } },
            {
              id: "@acme/vectors::Vector.add",
              name: "add",
              kind: "method",
              static: true,
              signatures: [{
                id: "@acme/vectors::Vector.add(a,b)",
                parameters: [
                  { name: "a", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } },
                  { name: "b", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } },
                ],
                returnType: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" },
              }],
            },
          ],
        },
      ],
    }],
    types: [{
      exportId: "@acme/vectors::Vector",
      targetDeclarationKind: "struct",
      sourceGenericBindings: [],
      targetGenerics: emptyRustGenerics,
      targetCarrier: vectorCarrier,
    }],
    operations: [
      {
        exportId: "@acme/vectors::Vector",
        memberId: "@acme/vectors::Vector.constructor",
        operationKind: "constructor",
        target: { form: "call", path: "acme_vectors::Vector::new" },
        resultCarrier: vectorCarrier,
        parameterCarriers: [int32Carrier, int32Carrier],
      },
      {
        exportId: "@acme/vectors::Vector",
        memberId: "@acme/vectors::Vector.x",
        operationKind: "property",
        target: { form: "field", name: "x" },
        resultCarrier: int32Carrier,
      },
      {
        exportId: "@acme/vectors::Vector",
        memberId: "@acme/vectors::Vector.y",
        operationKind: "property",
        target: { form: "field", name: "y" },
        resultCarrier: int32Carrier,
      },
      {
        exportId: "@acme/vectors::magnitude",
        operationKind: "method",
        target: { form: "call", path: "acme_vectors::magnitude", argModes: ["ref"] },
        resultCarrier: int32Carrier,
        parameterCarriers: [vectorCarrier],
      },
      {
        exportId: "@acme/vectors::scale",
        operationKind: "method",
        target: { form: "call", path: "acme_vectors::scale", argModes: ["mut-ref", "value"] },
        resultCarrier: unitCarrier,
        parameterCarriers: [vectorCarrier, int32Carrier],
      },
      {
        exportId: "@acme/vectors::mutateBoth",
        operationKind: "method",
        target: { form: "call", path: "acme_vectors::mutate_both", argModes: ["mut-ref", "mut-ref"] },
        resultCarrier: unitCarrier,
        parameterCarriers: [vectorCarrier, vectorCarrier],
      },
      {
        exportId: "@acme/vectors::consume",
        operationKind: "method",
        target: { form: "call", path: "acme_vectors::consume", argModes: ["value"] },
        resultCarrier: int32Carrier,
        parameterCarriers: [vectorCarrier],
      },
      {
        // Source call Vector.add(a, b) lowers to the native `+` operator
        // backed by the crate's std::ops::Add implementation.
        exportId: "@acme/vectors::Vector",
        memberId: "@acme/vectors::Vector.add",
        operationKind: "method",
        target: { form: "binary-operator", operator: "+", trait: "std::ops::Add" },
        resultCarrier: vectorCarrier,
        parameterCarriers: [vectorCarrier, vectorCarrier],
      },
    ],
    crates: [{ crateName: "acme_vectors", cargoPath: resolve(fixtureCratesRoot, "acme_vectors") }],
  });
}

export const dbCarrier = rustProviderPathTargetType({
  owner: { packageId: "acme-db", packageVersion: "1.0.0" },
  itemId: "acme.db.Db",
  displayPath: "acme_db::Db",
});

export function acmeDbPackage() {
  return createRustProviderPackage({
    id: "acme-db",
    displayName: "Acme db",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/db",
      providerModuleId: "acme.db",
      exports: [
        {
          id: "@acme/db::connect",
          name: "connect",
          kind: "function",
          signatures: [{
            id: "@acme/db::connect(path)",
            name: "connect",
            parameters: [{ name: "path", type: { kind: "string" } }],
            returnType: { kind: "provider-ref", moduleSpecifier: "@acme/db", exportName: "Db" },
          }],
        },
        {
          id: "@acme/db::Db",
          name: "Db",
          kind: "class",
          members: [
            {
              id: "@acme/db::Db.execute",
              name: "execute",
              kind: "method",
              signatures: [{
                id: "@acme/db::Db.execute(sql)",
                parameters: [{ name: "sql", type: { kind: "string" } }],
                returnType: { kind: "source-primitive", name: "int32" },
              }],
            },
          ],
        },
      ],
    }],
    types: [{
      exportId: "@acme/db::Db",
      targetDeclarationKind: "struct",
      sourceGenericBindings: [],
      targetGenerics: emptyRustGenerics,
      targetCarrier: dbCarrier,
    }],
    operations: [
      {
        exportId: "@acme/db::connect",
        operationKind: "method",
        target: { form: "call", path: "acme_db::connect" },
        resultCarrier: dbCarrier,
        parameterCarriers: [stringCarrier],
        isAsync: true,
      },
      {
        exportId: "@acme/db::Db",
        memberId: "@acme/db::Db.execute",
        operationKind: "method",
        target: { form: "receiver-method", name: "execute", mutatesReceiver: true },
        resultCarrier: int32Carrier,
        parameterCarriers: [stringCarrier],
        isAsync: true,
      },
    ],
    crates: [{ crateName: "acme_db", cargoPath: resolve(fixtureCratesRoot, "acme_db") }],
  });
}

// Installed-capability fixture: the real @tsonic/rust-nodejs plugin imported
// from package-declared artifacts. Cargo dependencies come from runtime
// contributions, not relative npm peer layout.
