import type {
  ProviderExportDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
} from "@tsonic/tsts";
import {
  rustSourceOperationExportIds,
  rustSourceOperationSignatureIds,
  rustSourceTypeExportIds,
  rustTypesModule,
} from "../identity.js";

const typeParameter = (name: string): ProviderTypeExpression => ({
  kind: "type-parameter",
  name,
});

const rustType = (
  exportName: string,
  typeArguments: readonly ProviderTypeExpression[],
): ProviderTypeExpression => ({
  kind: "provider-ref",
  moduleSpecifier: rustTypesModule,
  exportName,
  typeArguments,
});

export function rustReferenceOperationDeclarations(): readonly ProviderExportDeclaration[] {
  const value = typeParameter("T");
  const lifetime = typeParameter("L");
  const life = rustType(rustSourceTypeExportIds.life, []);
  const shared = rustType(rustSourceTypeExportIds.sharedReference, [value, lifetime]);
  const mutable = rustType(rustSourceTypeExportIds.mutableReference, [value, lifetime]);
  const referenceTypeParameters = [
    Object.freeze({ name: "T" }),
    Object.freeze({ name: "L", constraints: Object.freeze([life]), defaultType: life }),
  ];
  return [
    unary(
      rustSourceOperationExportIds.sharedReference,
      rustSourceOperationSignatureIds.sharedReference,
      value,
      shared,
      referenceTypeParameters,
    ),
    unary(
      rustSourceOperationExportIds.mutableReference,
      rustSourceOperationSignatureIds.mutableReference,
      value,
      mutable,
      referenceTypeParameters,
    ),
    functionDeclaration(rustSourceOperationExportIds.load, [
      signature(
        rustSourceOperationSignatureIds.loadShared,
        [{ name: "reference", type: shared }],
        value,
        referenceTypeParameters,
      ),
      signature(
        rustSourceOperationSignatureIds.loadMutable,
        [{ name: "reference", type: mutable }],
        value,
        referenceTypeParameters,
      ),
    ]),
    functionDeclaration(rustSourceOperationExportIds.store, [
      signature(
        rustSourceOperationSignatureIds.store,
        [
          { name: "reference", type: mutable },
          { name: "value", type: value },
        ],
        { kind: "void" },
        referenceTypeParameters,
      ),
    ]),
  ];
}

function unary(
  name: string,
  id: string,
  input: ProviderTypeExpression,
  output: ProviderTypeExpression,
  typeParameters: readonly import("@tsonic/tsts").ProviderTypeParameterDeclaration[] = [
    Object.freeze({ name: "T" }),
  ],
): ProviderExportDeclaration {
  return functionDeclaration(name, [signature(
    id,
    [{ name: "value", type: input }],
    output,
    typeParameters,
  )]);
}

function signature(
  id: string,
  parameters: readonly ProviderParameterDeclaration[],
  returnType: ProviderTypeExpression,
  typeParameters: readonly import("@tsonic/tsts").ProviderTypeParameterDeclaration[] = [
    Object.freeze({ name: "T" }),
  ],
): ProviderSignatureDeclaration {
  return Object.freeze({
    id,
    typeParameters,
    parameters: parameters.map((parameter) => Object.freeze({ ...parameter })),
    returnType,
  });
}

function functionDeclaration(
  name: string,
  signatures: readonly ProviderSignatureDeclaration[],
): ProviderExportDeclaration {
  return Object.freeze({
    id: name,
    name,
    kind: "function",
    signatures: Object.freeze([...signatures]),
  });
}
