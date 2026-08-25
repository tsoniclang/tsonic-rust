import type {
  ProviderExportDeclaration,
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
} from "@tsonic/tsts";
import {
  rustSourceTypeExportIds,
  rustTypesModule,
} from "../identity.js";

const typeParameter = (name: string): ProviderTypeExpression => ({
  kind: "type-parameter",
  name,
});

const rustType = (
  exportName: string,
  typeArguments: readonly ProviderTypeExpression[] = [],
): ProviderTypeExpression => ({
  kind: "provider-ref",
  moduleSpecifier: rustTypesModule,
  exportName,
  ...(typeArguments.length === 0 ? {} : { typeArguments }),
});

const life = rustType(rustSourceTypeExportIds.life);

export function rustSemanticTypeDeclarations(): readonly ProviderExportDeclaration[] {
  const value = typeParameter("T");
  return [
    alias(rustSourceTypeExportIds.life, { kind: "unknown" }),
    alias(rustSourceTypeExportIds.staticLifetime, life),
    genericAlias(rustSourceTypeExportIds.owned, [{ name: "T" }], value),
    genericAlias(
      rustSourceTypeExportIds.sharedReference,
      [
        { name: "T" },
        { name: "L", constraints: [life], defaultType: life },
      ],
      value,
    ),
    genericAlias(
      rustSourceTypeExportIds.mutableReference,
      [
        { name: "T" },
        { name: "L", constraints: [life], defaultType: life },
      ],
      value,
    ),
    genericAlias(
      rustSourceTypeExportIds.outlives,
      [{ name: "L", constraints: [life] }],
      { kind: "unknown" },
    ),
    genericAlias(
      rustSourceTypeExportIds.validFor,
      [{ name: "L", constraints: [life] }],
      { kind: "unknown" },
    ),
    genericAlias(
      rustSourceTypeExportIds.constParameter,
      [{ name: "T" }],
      value,
    ),
    genericAlias(
      rustSourceTypeExportIds.dynamicTrait,
      [
        { name: "T" },
        {
          name: "L",
          constraints: [life],
          defaultType: rustType(rustSourceTypeExportIds.staticLifetime),
        },
      ],
      value,
    ),
    genericAlias(
      rustSourceTypeExportIds.captureSet,
      [{ name: "T", constraints: [{ kind: "array", elementType: { kind: "unknown" } }] }],
      value,
    ),
    genericAlias(
      rustSourceTypeExportIds.opaqueType,
      [
        { name: "T" },
        {
          name: "C",
          constraints: [{ kind: "array", elementType: { kind: "unknown" } }],
          defaultType: { kind: "tuple", elementTypes: [] },
        },
      ],
      value,
    ),
    alias(rustSourceTypeExportIds.maybeSized, { kind: "unknown" }),
    genericAlias(
      rustSourceTypeExportIds.functionPointer,
      [
        {
          name: "Args",
          constraints: [{ kind: "array", elementType: { kind: "unknown" } }],
        },
        { name: "Result" },
        {
          name: "Abi",
          constraints: [{ kind: "string" }],
          defaultType: { kind: "literal", value: "Rust" },
        },
        {
          name: "Unsafe",
          constraints: [{ kind: "boolean" }],
          defaultType: { kind: "literal", value: false },
        },
        {
          name: "Variadic",
          constraints: [{ kind: "boolean" }],
          defaultType: { kind: "literal", value: false },
        },
      ],
      {
        kind: "provider-ref",
        moduleSpecifier: "@tsonic/core/types.js",
        exportName: "FunctionPointer",
        typeArguments: [typeParameter("Args"), typeParameter("Result")],
      },
    ),
    alias(rustSourceTypeExportIds.rustChar, { kind: "string" }),
  ];
}

function alias(
  name: string,
  type: ProviderTypeExpression,
): ProviderExportDeclaration {
  return Object.freeze({ id: name, name, kind: "type", type });
}

function genericAlias(
  name: string,
  typeParameters: readonly ProviderTypeParameterDeclaration[],
  type: ProviderTypeExpression,
): ProviderExportDeclaration {
  return Object.freeze({
    id: name,
    name,
    kind: "type",
    typeParameters: typeParameters.map((parameter) => Object.freeze({
      ...parameter,
      ...(parameter.constraints === undefined
        ? {}
        : { constraints: [...parameter.constraints] }),
    })),
    type,
  });
}
