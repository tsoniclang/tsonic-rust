import { Node_Type } from "@tsonic/target-api/source";
import { rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";

import { selectRustUnionVariantByCheckedType } from "../expected-types/union-variants.js";

import { resolveTypeNodeCarrier } from "../source-evidence/types/source-carriers.js";
import { rustProjectInstanceContracts } from "../project-types/instance-contracts.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectSourceObjectLiteralAccessors } from "@tsonic/target-api/source";

import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";
import { projectRecordMemberImplementation } from "./record-member-contracts.js";

export function selectRustRecordLiteralLayout(
  walk: RustFactWalk, expression: Node, selectedExpected: TargetTypeRef,
  accessorSelection: ReturnType<typeof selectSourceObjectLiteralAccessors>,
) {
  const { ast } = walk.context;
  const sourceValue = rustSourceTypeCarrierValue(selectedExpected);
  const unionValue = rustSourceUnionCarrierValue(selectedExpected);
  const structuralExpected = rustStructuralObjectCarrierValue(selectedExpected);
  let resultCarrier: TargetTypeRef;
  let storage: "project-object" | "structural-object";
  let selectedFields: readonly {
    readonly implementationDeclaration?: Node;
    readonly contractDeclarations: readonly Node[];
    readonly sourceName: string;
    readonly storageIndex: number;
    readonly carrier: TargetTypeRef;
    readonly presence: "required" | "optional";
    readonly readonly: boolean;
    readonly accessor?: {
      readonly getter: true;
      readonly setter: boolean;
    };
    readonly method?: true;
  }[];
  let selectedMethodDeclarations: readonly Node[] = [];
  if (sourceValue?.shape === "object") {
    const definition = walk.context.projectTypes.definitionForCarrier(selectedExpected);
    const contracts = definition === undefined
      ? undefined
      : rustProjectInstanceContracts(
          walk.context.projectTypes,
          definition,
          selectedExpected,
        );
    if (definition?.kind !== "interface" || contracts === undefined) {
      return undefined;
    }
    const contractFields = contracts.flatMap((contract) => {
      const layout = walk.context.projectTypes.objectLayoutForDefinition(contract.definition);
      if (layout?.kind !== "interface") {
        return [undefined];
      }
      return layout.fields.map((field) => {
        const implementationDeclaration = projectRecordMemberImplementation(
          walk,
          definition,
          field.declaration,
        );
        const declared = walk.context.records.runtimeCarrier.get(field.declaration)?.carrier ??
          resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, field.declaration));
        const carrier = declared === undefined
          ? undefined
          : walk.context.projectTypes.instantiateMemberCarrier(
              field.declaration,
              selectedExpected,
              declared,
            );
        return carrier === undefined || implementationDeclaration === undefined
          ? undefined
          : {
              contractDeclaration: field.declaration,
              implementationDeclaration,
              sourceName: field.sourceName,
              carrier,
              presence: field.presence,
              readonly: ast.hasModifierKind(field.declaration, "readonly"),
            };
      });
    });
    if (contractFields.some((field) => field === undefined)) {
      return undefined;
    }
    const projectFields: {
      readonly implementationDeclaration: Node;
      readonly contractDeclarations: Node[];
      readonly sourceName: string;
      readonly storageIndex: number;
      readonly carrier: TargetTypeRef;
      readonly presence: "required" | "optional";
      readonly readonly: boolean;
    }[] = [];
    for (const field of contractFields as readonly {
      readonly contractDeclaration: Node;
      readonly implementationDeclaration: Node;
      readonly sourceName: string;
      readonly carrier: TargetTypeRef;
      readonly presence: "required" | "optional";
      readonly readonly: boolean;
    }[]) {
      const existing = projectFields.find((candidate) =>
        candidate.implementationDeclaration === field.implementationDeclaration);
      if (existing !== undefined) {
        if (!rustTargetTypeRefEquals(existing.carrier, field.carrier) || existing.presence !== field.presence) {
          return undefined;
        }
        existing.contractDeclarations.push(field.contractDeclaration);
        continue;
      }
      projectFields.push({
        implementationDeclaration: field.implementationDeclaration,
        contractDeclarations: [field.contractDeclaration],
        sourceName: field.sourceName,
        storageIndex: projectFields.length,
        carrier: field.carrier,
        presence: field.presence,
        readonly: field.readonly,
      });
    }
    resultCarrier = selectedExpected;
    storage = "project-object";
    selectedMethodDeclarations = contracts.flatMap((contract) =>
      ast.members(contract.definition.declaration).filter((member): member is Node =>
        member !== undefined && ast.kindName(member) === "KindMethodSignature"));
    selectedFields = projectFields as readonly {
      readonly implementationDeclaration: Node;
      readonly contractDeclarations: readonly Node[];
      readonly sourceName: string;
      readonly storageIndex: number;
      readonly carrier: TargetTypeRef;
      readonly presence: "required" | "optional";
      readonly readonly: boolean;
      readonly accessor?: {
        readonly getter: true;
        readonly setter: boolean;
      };
    }[];
  } else {
    let structuralCarrier = structuralExpected === undefined ? undefined : selectedExpected;
    let structuralValue = structuralExpected;
    if (unionValue !== undefined) {
      const sourceUnion = walk.sourceTypes.sourceUnionForCarrier(selectedExpected);
      const selectedVariant = sourceUnion === undefined
        ? undefined
        : selectRustUnionVariantByCheckedType(walk, expression, sourceUnion);
      if (selectedVariant === undefined) {
        return undefined;
      }
      structuralCarrier = selectedVariant.carrier;
      structuralValue = rustStructuralObjectCarrierValue(structuralCarrier);
    }
    if (structuralCarrier === undefined || structuralValue === undefined) {
      return undefined;
    }
    resultCarrier = structuralCarrier;
    storage = "structural-object";
    const structuralShape = walk.sourceTypes.structuralObjectForCarrier(structuralCarrier);
    if (structuralShape === undefined ||
      structuralShape.fields.length !== structuralValue.fields.length) {
      return undefined;
    }
    const selectedAccessorMembers = accessorSelection.kind === "resolved"
      ? accessorSelection.members
      : [];
    const structuralFields = structuralValue.fields.map((field, storageIndex) => {
      const sourceField = structuralShape.fields[storageIndex];
      const matchingAccessors = selectedAccessorMembers.filter((accessor) =>
        accessor.sourceName === field.sourceName
      );
      const accessor = matchingAccessors[0];
      if (sourceField === undefined || sourceField.sourceName !== field.sourceName ||
        sourceField.storageIndex !== storageIndex ||
        !rustTargetTypeRefEquals(sourceField.resultCarrier, field.type) ||
        sourceField.presence !== field.presence || sourceField.readonly !== field.readonly ||
        sourceField.accessor?.setter !== field.accessor?.setter ||
        sourceField.method !== field.method || matchingAccessors.length > 1 ||
        (accessor !== undefined && (
          field.method === true || accessor.getter === undefined ||
          accessor.sourceSelectedDeclarations.length === 0 ||
          accessor.sourceSelectedDeclarations.some((declaration) =>
            !sourceField.declarations.includes(declaration)) ||
          !field.readonly && accessor.setter === undefined
        ))) {
        return undefined;
      }
      return {
        contractDeclarations: sourceField.declarations,
        sourceName: field.sourceName,
        storageIndex,
        carrier: field.type,
        presence: field.presence,
        readonly: field.readonly,
        ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
        ...(field.method === true ? { method: true as const } : {}),
      };
    });
    if (structuralFields.some((field) => field === undefined)) {
      return undefined;
    }
    selectedFields = structuralFields as typeof selectedFields;
  }

  return { sourceValue, resultCarrier, storage, selectedFields, selectedMethodDeclarations };
}
