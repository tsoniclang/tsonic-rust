import { rustCallableProtocol, rustNativeCallableProtocol, substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { KindFunctionDeclaration, KindFunctionExpression, KindNewExpression } from "@tsonic/target-api/source";

import { appendRustDiagnostic } from "../program/walk.js";

import { recordBindingWrite } from "../ownership/source-writes.js";

import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";

import { rustProjectCallableTargetName } from "../names/source-member-name.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTypeFamilyNormalizer } from "../project-types/type-family-normalization.js";

import { sourceTypeCarrierForDeclaration } from "./inputs.js";

import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSelectedTargetSignature } from "../../target-model/records/operations/member-selections.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";

import { rustGenericCallableProtocol } from "../../target-model/types/carriers/generic-callables.js";
import { substituteRustValueConversion } from "../../target-model/conversions/substitution.js";
import { recordSelectedMethodSpecialization } from "./project-method-calls.js";
import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";

import { rustMemberAccessReceiver } from "../../target-model/syntax/expressions.js";

import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";

export function selectRustProjectSourceCallTarget(input: {
  readonly walk: RustFactWalk;
  readonly expression: Node;
  readonly callee: Node;
  readonly sourceFile: SourceFile;
  readonly expressionKind: string;
  readonly selectedDeclaration: Node;
  readonly selectedSignature: RustSelectedTargetSignature;
  readonly genericResultCarrier: TargetTypeRef;
  readonly substitutions: RustTargetGenericBindings;
  readonly targetTypeArguments: readonly TargetTypeRef[];
  readonly declarationKind: string;
  readonly normalizeTypeFamily: ReturnType<typeof rustTypeFamilyNormalizer>;
}) {
  const { walk, expression, callee, sourceFile, expressionKind, selectedDeclaration, selectedSignature,
    genericResultCarrier, substitutions, targetTypeArguments, declarationKind, normalizeTypeFamily } = input;
  const { ast } = walk.context;
  const selectedMember = selectedSignature.member;
  let target: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>["target"] | undefined;
  let operationKind: "method" | "constructor" = "method";
  const reference = walk.context.callableInvocationReferences.forTarget(callee, selectedDeclaration);
  const calleeReferenceDeclaration = reference.referenceDeclaration;
  const callableCalleeCarrier = expressionKind === KindNewExpression || reference.nativeFunction
    ? undefined
    : resolveExpressionCarrier(walk, callee, sourceFile, undefined);
  const optionalCall = walk.context.records.optionalChain.get(expression);
  const selectedCallableCarrier = optionalCall?.selectedGuardCarrier ?? callableCalleeCarrier;
  const selectedNativeCallable = rustNativeCallableProtocol(selectedCallableCarrier);
  const selectedGenericCallable = rustGenericCallableProtocol(selectedCallableCarrier,
    (selectedSignature.member.genericParameters ?? []).flatMap(parameter => parameter.kind === "type"
      ? [{ kind: "type-parameter" as const, identity: parameter.targetIdentity, name: parameter.sourceName }] : []));
  const indirectCallable = selectedCallableCarrier !== undefined &&
    (selectedNativeCallable !== undefined || selectedGenericCallable !== undefined ||
      rustCallableProtocol(selectedCallableCarrier) !== undefined) &&
    (!reference.directDeclaration ||
      ast.kindName(callee) === "KindArrowFunction" || ast.kindName(callee) === KindFunctionExpression);
  if (reference.directModule) {
    const name = calleeReferenceDeclaration === undefined ? undefined : walk.context.moduleCallables.nativeCallable(calleeReferenceDeclaration)?.name;
    const fileName = ast.getFileName(ast.getSourceFile(calleeReferenceDeclaration!));
    if (name === undefined || fileName.length === 0) {
      return undefined;
    }
    target = {
      form: "function",
      fileName,
      name,
      selectedTargetName: selectedMember.targetName,
    };
  } else if (selectedSignature.sourceUnionMethods !== undefined) {
    const union = selectedSignature.sourceUnionMethods;
    const receiver = rustMemberAccessReceiver(ast, callee);
    if (receiver === undefined) return undefined;
    const receiverCarrier = resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    if (!rustTargetTypeRefEquals(receiverCarrier, union.receiverCarrier)) return undefined;
    const variants = union.variants.map(variant => {
      const selfMode = walk.context.records.selfMode.get(variant.declaration);
      const owner = walk.context.projectTypes.definitionContainingDeclaration(variant.declaration);
      const polymorphic = owner !== undefined && walk.context.projectTypes.isPolymorphic(owner);
      const relationship = owner === undefined ? undefined : walk.context.projectTypes.relationship(variant.carrier, owner);
      if (polymorphic && relationship?.kind !== "related") return undefined;
      if (polymorphic && !recordSelectedMethodSpecialization(walk, expression, variant.declaration, targetTypeArguments)) return undefined;
      return selfMode === undefined ? undefined : {
        name: variant.name,
        carrier: variant.carrier,
        declaration: variant.declaration,
        targetName: variant.targetName,
        returnType: substituteRustTargetGenerics(variant.returnType, substitutions.types, substitutions.lifetimes, substitutions.consts, normalizeTypeFamily),
        ...(variant.resultConversion === undefined ? {} : { resultConversion: substituteRustValueConversion(
          variant.resultConversion, substitutions.types, substitutions.lifetimes, substitutions.consts,
        ) }),
        mutatesSelf: selfMode.mode === "mut-ref",
        ...(polymorphic && relationship?.kind === "related" ? { dispatchOwner: relationship.targetType } : {}),
      };
    });
    if (variants.some(variant => variant === undefined)) return undefined;
    if (variants.some(variant => variant!.mutatesSelf)) recordBindingWrite(walk, receiver, "referent");
    walk.context.generatedDeclarationUses.record(expression, union.variants.map(variant => variant.declaration));
    target = { form: "union-method", receiverCarrier: union.receiverCarrier, variants: variants as NonNullable<typeof variants[number]>[] };
  } else if (indirectCallable) {
    target = { form: "callable", carrier: selectedCallableCarrier };
  } else if (selectedMember.kind === "constructor") {
    const owner = walk.context.projectTypes.definitionForCarrier(genericResultCarrier);
    const classReceiver = expressionKind !== KindNewExpression || calleeReferenceDeclaration === owner?.declaration ? undefined : callee;
    if (classReceiver !== undefined) {
      const carrier = resolveExpressionCarrier(walk, classReceiver, sourceFile, undefined);
      const instance = rustClassConstructorInstance(carrier);
      if (owner === undefined || instance === undefined || walk.context.projectTypes.definitionForCarrier(instance) !== owner) return undefined;
    }
    target = {
      form: "constructor",
      name: selectedMember.targetName,
      typeCarrier: genericResultCarrier,
      ...(classReceiver === undefined ? {} : { classReceiver }),
    };
    operationKind = "constructor";
  } else if (declarationKind === "KindMethodDeclaration" ||
    declarationKind === "KindMethodSignature") {
    const methodName = rustProjectCallableTargetName(selectedDeclaration, walk.context);
    if (methodName === undefined) {
      return undefined;
    }
    if (ast.hasModifierKind(selectedDeclaration, "static")) {
      const moduleFunction = walk.context.projectTypes.memberSlotName(selectedDeclaration, "static");
      const classDeclaration = ast.parent(selectedDeclaration);
      const typeCarrier = classDeclaration === undefined
        ? undefined
        : sourceTypeCarrierForDeclaration(walk, classDeclaration);
      if (typeCarrier === undefined) {
        return undefined;
      }
      const receiver = rustMemberAccessReceiver(ast, callee);
      const direct = receiver !== undefined && walk.context.source.navigation.sourceReferenceFor(receiver)?.declaration === classDeclaration;
      const classReceiver = direct ? undefined : receiver;
      if (!direct) {
        const carrier = receiver === undefined ? undefined : resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
        const instance = rustClassConstructorInstance(carrier);
        if (instance === undefined || walk.context.projectTypes.definitionForCarrier(instance)?.declaration !== classDeclaration) return undefined;
      }
      target = moduleFunction === undefined
        ? { form: "static-method", name: methodName, typeCarrier, ...(classReceiver === undefined ? {} : { classReceiver }) }
        : { form: "function", name: moduleFunction,
            fileName: ast.getFileName(ast.getSourceFile(selectedDeclaration)), selectedTargetName: selectedMember.targetName,
            ...(classReceiver === undefined ? {} : { classReceiver }) };
    } else {
      const receiver = rustMemberAccessReceiver(ast, callee);
      if (receiver === undefined) {
        return undefined;
      }
      resolveExpressionCarrier(
        walk,
        receiver,
        sourceFile,
        undefined,
      );
      const rawReceiverCarrier = walk.context.records.runtimeCarrier.get(receiver)?.carrier;
      const selectedReceiverCarrier = selectedSignature.sourceSelectedReceiverCarrier;
      if (rawReceiverCarrier === undefined || selectedReceiverCarrier === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_RECEIVER_CARRIER_MISSING",
          "Selected project-source method call has no exact raw and checker-selected receiver carriers.",
          receiver,
          ["target.capability=rust.source-call.receiver-carrier"],
        );
        return undefined;
      }
      const receiverProjection = walk.context.records.flowReadProjections.resolve(walk.context.requiredRecords, receiver,
        rawReceiverCarrier,
        selectedReceiverCarrier,
        walk.context.projectTypes, walk.context.typeDefinitions,
      );
      if (receiverProjection.kind === "incompatible") {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_RECEIVER_PROJECTION_UNSUPPORTED",
          "The project-source method receiver cannot project from its exact runtime carrier to its checker-selected carrier.",
          receiver,
          ["target.capability=rust.source-call.receiver-projection"],
        );
        return undefined;
      }
      const selfMode = walk.context.records.selfMode.get(selectedDeclaration);
      if (selfMode === undefined) {
        return undefined;
      }
      const mutatesSelf = selfMode.mode === "mut-ref";
      const owner = walk.context.projectTypes.definitionContainingDeclaration(selectedDeclaration);
      const ownerRelationship = owner === undefined
        ? undefined
        : walk.context.projectTypes.relationship(selectedReceiverCarrier, owner);
      const ownerCarrier = ownerRelationship?.kind === "related"
        ? ownerRelationship.targetType
        : undefined;
      const polymorphic = owner !== undefined && walk.context.projectTypes.isPolymorphic(owner);
      if (polymorphic && ownerCarrier === undefined) {
        return undefined;
      }
      if (polymorphic && !recordSelectedMethodSpecialization(walk, expression, selectedDeclaration, targetTypeArguments)) return undefined;
      const receiverKind = ast.kindName(receiver);
      target = {
        form: "method",
        name: methodName,
        mutatesSelf,
        ...(!polymorphic
          ? {}
          : {
              dispatch: {
                selected: receiverKind === "KindSuperKeyword" ? "exact" : "virtual",
                ownerCarrier: ownerCarrier!,
              },
            }),
      };
      if (mutatesSelf) {
        recordBindingWrite(walk, receiver, "referent");
      }
    }
  } else if (declarationKind === KindFunctionDeclaration || reference.directLexical) {
    const name = reference.directLexical ? walk.context.names.nameForDeclaration(calleeReferenceDeclaration)
      : walk.context.names.functionNameForDeclaration(selectedDeclaration);
    const fileName = ast.getFileName(ast.getSourceFile(selectedDeclaration));
    if (name === undefined || fileName.length === 0) {
      return undefined;
    }
    target = {
      form: "function",
      fileName,
      name,
      selectedTargetName: selectedMember.targetName,
    };
  } else if (declarationKind === "KindFunctionType" ||
    declarationKind === "KindCallSignature" ||
    declarationKind === "KindArrowFunction" ||
    declarationKind === KindFunctionExpression) {
    const calleeCarrier = selectedCallableCarrier;
    if (calleeCarrier === undefined ||
      (selectedGenericCallable === undefined && rustNativeCallableProtocol(calleeCarrier) === undefined &&
        rustCallableProtocol(calleeCarrier) === undefined)) {
      return undefined;
    }
    target = { form: "callable", carrier: calleeCarrier };
  }
  if (target === undefined) {
    return undefined;
  }
  const callable = target.form !== "callable" ? undefined
    : selectedGenericCallable ?? selectedNativeCallable ?? rustCallableProtocol(target.carrier);
  return Object.freeze({ target, operationKind, directLexical: reference.directLexical, optionalCall, callable });
}
