import { rustRecordFinalFieldContributions, rustRecordSpreadRetainsField, rustRecordSpreadReadIsObservable } from "../objects/record-contributions.js";
import { rustObjectReferenceViewKey } from "../../../analysis/facts/object-reference-views.js";
import { rustPropertyProjectionFactKey } from "../../../analysis/facts/property-projections.js";
import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import {
  rustFlowReadProjectionFactKey,
  rustContextualValueConversionFactKey,
  rustBindingProjectionFactKey,
  rustProjectDowncastFactKey,
  rustProjectUpcastFactKey,
  rustTargetOperationFactKey,
} from "../../../analysis/facts/keys.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/operations/facts.js";
import { rustClassValueFactKey } from "../../../analysis/facts/class-values.js";
import { rustProjectCallableAdaptersKey } from "../../../analysis/facts/project-callable-adapters.js";
import type { RustCallableValueAdapter } from "../../../analysis/facts/callable-adapters.js";
import type { RustContextualValueConversion } from "../../../target-model/conversions/contextual.js";
import { rustMemoryBindingPlanKey } from "../../../target-model/operations/memory-bindings.js";
import {
  isRustFinalizedArrayInput,
  isRustFinalizedSliceInput,
  isRustFinalizedSourceInput,
  isRustFinalizedTaggedArrayInput,
} from "../../../analysis/facts/finalized-operation-abi.js";
import type {
  RustFinalizedTargetInput,
  RustFinalizedValueConversion,
} from "../../../analysis/facts/finalized-operation-abi.js";
import { rustProjectObjectLayout } from "../../../analysis/project-types/object-layout.js";
import {
  rustValueConversionContract,
} from "../../../target-model/conversions/contracts.js";
import type { RustValueConversion } from "../../../target-model/operations/model.js";
import type { RustCallableConversion } from "../../../target-model/conversions/callable.js";
import type { RustClosedTypeTestPlan } from "../../../target-model/operations/type-tests.js";
import { rustClosedTypeTestConstant } from "../../../target-model/operations/type-tests.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";
import { rustProjectRootThisCarrier } from "../objects/polymorphism/this-references.js";
import {
  isRustPreconstructionThisOperation,
  isRustArrayFieldContentAssignment,
  markBinaryProjectIdentityUsed,
  visitConversionContract,
} from "./generated-item-usage-helpers.js";

import type {
  RustGeneratedItemUsage,
  RustGeneratedItemUsageInput,
  RustGeneratedOperationAbi,
} from "./generated-item-usage-model.js";

import { createRustGeneratedItemUsageState } from "./generated-item-usage-state.js";

export function analyzeRustGeneratedItemUsage(input: RustGeneratedItemUsageInput): RustGeneratedItemUsage {
  const {
    usage,
    markProjectTypeUsed,
    markProjectTypeConstructed,
    markProjectTypeReified,
    markProjectConstructorInvoked,
    markProjectCarrierFieldUsed,
    markDowncastUsed,
    markProjectionUsed,
    markStructuralFieldRead,
    markStructuralFieldWritten,
    markVariantRead,
    markVariantConstructed,
    markStructuralShapeConstructed,
    markProjectIdentityUsed,
    markProjectWrapperCloneUsed,
    markProjectMemberUsed,
    markProjectUpcastUsed,
    markAuthoredFieldRead,
  } = createRustGeneratedItemUsageState(input);
  const declarationNames = new WeakSet<Node>();

  for (const declaration of input.declarations) {
    const name = input.ast.name(declaration);
    if (name !== undefined) declarationNames.add(name);
  }

  const visitProjectProjectionFacts = (node: Node): void => {
    let operand = node;
    let parent = input.ast.parent(operand);
    while (parent !== undefined && input.ast.is.IsParenthesizedExpression(parent) &&
      Node_Expression(input.ast, parent) === operand) {
      operand = parent;
      parent = input.ast.parent(operand);
    }
    if (parent !== undefined && input.ast.is.IsTypeOfExpression(parent) &&
      Node_Expression(input.ast, parent) === operand) return;
    const binding = input.facts.getFact(node, rustBindingProjectionFactKey);
    if (binding?.projection.kind === "object-rest") {
      markStructuralShapeConstructed(binding.bindingCarrier);
    }
    const upcast = input.facts.getFact(node, rustProjectUpcastFactKey);
    if (upcast !== undefined) markProjectUpcastUsed(upcast);
    const downcast = input.facts.getFact(node, rustProjectDowncastFactKey);
    if (downcast !== undefined) {
      markProjectCarrierFieldUsed(downcast.dispatchCarrier, "wrapper-identity");
      markProjectCarrierFieldUsed(downcast.dispatchCarrier, "wrapper-dispatch");
      markProjectTypeConstructed(downcast.targetCarrier);
      markProjectionUsed(downcast.dispatchCarrier, downcast.targetCarrier, downcast.projection);
    }
    const flow = input.facts.getFact(node, rustFlowReadProjectionFactKey);
    if (flow?.kind === "union-map") {
      for (const arm of flow.arms) {
        for (const step of arm.source) markVariantRead(step.union, step.variant.name);
        for (const step of arm.target) markVariantConstructed(step.union, step.variant.name);
      }
    }
    if (flow?.kind === "source-union") markVariantRead(flow.dispatchCarrier, flow.variant);
    if (flow?.kind === "project-downcast") {
      markProjectCarrierFieldUsed(flow.dispatchCarrier, "wrapper-identity");
      markProjectCarrierFieldUsed(flow.dispatchCarrier, "wrapper-dispatch");
      markProjectTypeConstructed(flow.selectedCarrier);
      markProjectionUsed(flow.dispatchCarrier, flow.selectedCarrier, flow.projection);
    }
  };

  const visitConversion = (conversion: RustValueConversion | RustCallableConversion | undefined): void => {
    if (conversion === undefined) return;
    if (conversion.kind === "callable-adapter") {
      for (const selected of [...conversion.parameters, conversion.result]) {
        if (selected.kind === "value") visitConversion(selected.conversion);
      }
      return;
    }
    const contract = rustValueConversionContract(conversion, input.typeDefinitions);
    if (contract === undefined) {
      throw new Error("A finalized Rust value conversion has no valid dead-code usage contract.");
    }
    visitConversionContract(contract, { structuralFieldRead: markStructuralFieldRead,
      variantRead: markVariantRead, variantConstructed: markVariantConstructed, closedObjectUsed: carrier => {
      const representation = input.objectRepresentations.representationFor(input.projectTypes.definitionForCarrier(carrier));
      if (representation?.kind === "open-hierarchy" || representation?.kind === "closed-hierarchy") {
        markProjectCarrierFieldUsed(carrier, "wrapper-dispatch");
      } else if (representation !== undefined && representation.kind !== "value") {
        markProjectCarrierFieldUsed(carrier, "wrapper-state");
      }
    } });
  };
  const visitFinalizedConversion = (conversion: RustFinalizedValueConversion): void => {
    if (conversion.kind === "semantic") visitConversion(conversion.conversion);
    else if (conversion.kind === "sequence") conversion.steps.forEach(visitFinalizedConversion);
  };
  const visitContextualConversion = (conversion: RustContextualValueConversion | undefined): void => {
    if (conversion === undefined) return;
    switch (conversion.kind) {
      case "empty-record":
        markStructuralShapeConstructed(conversion.target);
        return;
      case "project-union-map":
        for (const arm of conversion.arms) {
          markProjectTypeUsed(arm.carrier);
          for (const step of arm.source) markVariantRead(step.union, step.variant.name);
          for (const step of arm.target) markVariantConstructed(step.union, step.variant.name);
          if (arm.upcast !== null) markProjectUpcastUsed(arm.upcast);
        }
        return;
      case "provider-record-copy":
        for (const field of conversion.fields) visitConversion(field.conversion);
        return;
      case "native-trait-object-upcast":
      case "reference-reborrow":
      case "generic-callable-flow":
      case "integer-truncation":
      case "program-error":
        return;
      default:
        visitConversion(conversion);
    }
  };
  const visitCallableAdapter = (adapter: RustCallableValueAdapter): void => {
    switch (adapter.kind) {
      case "option-some":
      case "option-map":
        visitCallableAdapter(adapter.element);
        return;
      case "conversion":
        if (adapter.upcast !== undefined) markProjectUpcastUsed(adapter.upcast);
        visitContextualConversion(adapter.conversion);
        return;
      case "project-upcast":
        markProjectUpcastUsed(adapter);
        return;
      case "project-structural-view":
        markProjectCarrierFieldUsed(adapter.sourceCarrier, "wrapper-identity");
        markProjectCarrierFieldUsed(adapter.sourceCarrier, "wrapper-dispatch");
        markStructuralShapeConstructed(adapter.targetCarrier);
        return;
      case "identity":
      case "absent-completion":
      case "call-scoped-lifetime":
        return;
    }
  };
  const visitTargetInput = (targetInput: RustFinalizedTargetInput): void => {
    if (isRustFinalizedSourceInput(targetInput)) {
      visitFinalizedConversion(targetInput.conversion);
    } else if (isRustFinalizedSliceInput(targetInput) ||
      isRustFinalizedArrayInput(targetInput)) {
      targetInput.elements.forEach(visitTargetInput);
    } else if (isRustFinalizedTaggedArrayInput(targetInput)) {
      targetInput.elements.forEach((element) => visitTargetInput(element.input));
    }
  };
  const visitAbi = (abi: RustGeneratedOperationAbi): void => {
    if (abi.target.form === "arg-structural-method" &&
      abi.targetReceiver.kind === "input") {
      markStructuralFieldRead(
        abi.targetReceiver.input.parameterCarrier,
        abi.target.storageIndex,
      );
    }
    if (abi.targetReceiver.kind === "input") visitTargetInput(abi.targetReceiver.input);
    abi.targetArguments.forEach(visitTargetInput);
    visitFinalizedConversion(
      abi.result.kind === "sync" ? abi.result.conversion : abi.result.awaitedConversion,
    );
  };
  const visitFact = (node: Node, fact: RustTargetOperationFact, selectedReceiver?: TargetTypeRef): void => {
    switch (fact.kind) {
      case "operator-token":
      case "operator-call":
        visitConversion(fact.leftConversion);
        visitConversion(fact.rightConversion);
        if (fact.operator === "==" || fact.operator === "!=") {
          markBinaryProjectIdentityUsed(node, input, markProjectIdentityUsed);
        }
        return;
      case "provider-operation":
      case "runtime-set":
        visitAbi(fact.abi);
        return;
      case "union-property":
        fact.variants.forEach(variant => {
          if (variant.operation !== undefined) {
            markVariantRead(fact.unionCarrier, variant.name);
            visitAbi(variant.operation.abi);
          }
        });
        return;
      case "object-shape-projection":
        if (fact.projection === "values" || fact.projection === "entries") {
          for (const field of fact.fields) {
            markStructuralFieldRead(fact.sourceValueCarrier, field.storageIndex);
            visitConversion(field.conversion);
          }
        } else if (fact.projection === "assign") {
          for (const field of fact.assignmentFields ?? []) {
            if (fact.assignmentSourceCarrier !== undefined) {
              markStructuralFieldRead(
                fact.assignmentSourceCarrier,
                field.sourceStorageIndex,
              );
            }
            visitConversion(field.conversion);
          }
        }
        return;
      case "source-field":
        if (isRustPreconstructionThisOperation(input.ast, node)) return;
        if (fact.accessMode !== "write" && fact.declaration !== undefined) {
          markAuthoredFieldRead(fact.declaration);
        }
        if (fact.dispatch !== undefined) {
          markProjectCarrierFieldUsed(fact.receiverCarrier, "wrapper-dispatch");
          let enclosing = input.ast.parent(node);
          while (enclosing !== undefined && !input.ast.is.IsArrowFunction(enclosing) && !input.ast.is.IsFunctionDeclaration(enclosing) &&
            !input.ast.is.IsFunctionExpression(enclosing) && !input.ast.is.IsMethodDeclaration(enclosing)) enclosing = input.ast.parent(enclosing);
          const captured = enclosing !== undefined && input.objectRepresentations.receiverCaptures.capturesFor(enclosing)
            .some(capture => capture.references.includes(node));
          if (captured) markProjectMemberUsed(fact.receiverCarrier, fact.declaration, "capture");
          else if (fact.resultCarrier.kind === "array" && fact.valueSemantics.kind === "stored" &&
              isRustArrayFieldContentAssignment(node, input.ast, input.facts)) {
            markProjectMemberUsed(fact.receiverCarrier, fact.declaration, "content");
          } else if (fact.accessMode !== "write") {
            markProjectMemberUsed(fact.receiverCarrier, fact.declaration, "read");
          }
          if (!captured && fact.accessMode !== "read") {
            markProjectMemberUsed(fact.receiverCarrier, fact.declaration, "write");
          }
        } else if (fact.storage === "project-object") {
          markProjectCarrierFieldUsed(fact.receiverCarrier, "wrapper-state");
        }
        if (fact.accessMode !== "write") {
          markStructuralFieldRead(fact.receiverCarrier, fact.storageIndex);
        }
        if (fact.accessMode !== "read") {
          markStructuralFieldWritten(fact.receiverCarrier, fact.storageIndex);
        }
        return;
      case "source-union-field":
        for (const variant of fact.variants) {
          if (variant.field === undefined) continue;
          markVariantRead(fact.unionCarrier, variant.name);
          if (fact.accessMode !== "write" && variant.field.declaration !== undefined) markAuthoredFieldRead(variant.field.declaration);
          if (variant.field.dispatch !== undefined) {
            markProjectCarrierFieldUsed(variant.carrier, "wrapper-dispatch");
            if (fact.accessMode !== "write") markProjectMemberUsed(variant.carrier, variant.field.declaration, "read");
            if (fact.accessMode !== "read") markProjectMemberUsed(variant.carrier, variant.field.declaration, "write");
          } else if (variant.field.storage === "project-object") {
            markProjectCarrierFieldUsed(variant.carrier, "wrapper-state");
          }
          if (fact.accessMode !== "write") {
            markStructuralFieldRead(variant.carrier, variant.field.storageIndex);
          }
          if (fact.accessMode !== "read") {
            markStructuralFieldWritten(variant.carrier, variant.field.storageIndex);
          }
        }
        return;
      case "source-call":
        if (isRustPreconstructionThisOperation(input.ast, node)) return;
        {
          const declaration = input.facts.getSelectedTargetCall(node)?.sourceDeclaration;
          if (declaration === undefined || !input.sourceCallableSpecializations.requiresSpecialization(declaration)) {
            for (const argument of fact.targetGenericArguments ?? []) {
              if (argument.kind === "type") markProjectTypeReified(argument.type);
            }
          }
        }
        if (fact.target.form === "constructor") {
          markProjectConstructorInvoked(fact.target.typeCarrier);
        } else if (fact.target.form === "constructor-value") {
          markProjectTypeConstructed(fact.resultCarrier);
          markStructuralShapeConstructed(fact.resultCarrier);
        } else if (fact.target.form === "union-method") {
          for (const method of fact.target.variants) {
            markVariantRead(fact.target.receiverCarrier, method.name);
            if (method.dispatchOwner !== undefined) {
              markProjectCarrierFieldUsed(method.carrier, "wrapper-dispatch");
            }
            markProjectMemberUsed(method.carrier, method.declaration,
              method.dispatchOwner === undefined ? "method-exact" : "method-virtual");
          }
        } else if (fact.target.form === "method" && fact.target.dispatch !== undefined) {
          const selected = input.facts.getSelectedTargetCall(node);
          const receiverCarrier = selected?.sourceSelectedReceiverCarrier ??
            fact.target.dispatch.ownerCarrier;
          if (fact.target.dispatch.selected === "virtual") {
            markProjectCarrierFieldUsed(receiverCarrier, "wrapper-dispatch");
          }
          markProjectMemberUsed(
            receiverCarrier,
            selected?.sourceDeclaration,
            fact.target.dispatch.selected === "virtual" ? "method-virtual" : "method-exact",
          );
        }
        if (fact.target.form === "structural-method") {
          markStructuralFieldRead(fact.target.receiverCarrier, fact.target.storageIndex);
        }
        return;
      case "source-enum-member":
        markVariantConstructed(fact.resultCarrier, fact.name);
        return;
      case "record-literal": {
        if (fact.storage === "project-object") {
          markProjectTypeConstructed(fact.resultCarrier);
        } else {
          markStructuralShapeConstructed(fact.resultCarrier);
        }
        const final = rustRecordFinalFieldContributions(fact);
        for (const [index, contribution] of fact.contributions.entries()) {
          if (contribution.kind !== "spread") continue;
          for (const field of contribution.fields) {
            if (rustRecordSpreadRetainsField(contribution, field, index, final) ||
              rustRecordSpreadReadIsObservable(contribution, field, input.structuralShapes))
              markStructuralFieldRead(contribution.sourceValueCarrier, field.sourceStorageIndex);
          }
        }
        return;
      }
      case "record-index-literal":
        markProjectTypeConstructed(fact.resultCarrier);
        return;
      case "source-conversion":
        visitConversion(fact.conversion);
        return;
      case "project-type-test":
        if (fact.lowering.kind === "dispatch") {
          markDowncastUsed(fact.dispatchCarrier, fact.targetCarrier);
          markProjectCarrierFieldUsed(fact.dispatchCarrier, "wrapper-dispatch");
        }
        return;
      case "closed-type-test": {
        const visit = (test: RustClosedTypeTestPlan, carrier: TargetTypeRef): void => {
          if (test.kind === "project" && test.plan.lowering.kind === "dispatch") {
            markDowncastUsed(test.plan.dispatchCarrier, test.plan.targetCarrier);
            markProjectCarrierFieldUsed(test.plan.dispatchCarrier, "wrapper-dispatch");
          } else if (test.kind === "option") visit(test.test, test.element);
          else if (test.kind === "union") {
            for (const arm of test.arms) {
              if (rustClosedTypeTestConstant(arm.test) !== undefined) continue;
              markVariantRead(carrier, arm.variant.name);
              visit(arm.test, arm.carrier);
            }
          }
        };
        visit(fact.test, fact.sourceCarrier);
        return;
      }
      case "source-method-property":
        if (isRustPreconstructionThisOperation(input.ast, node)) return;
        markProjectCarrierFieldUsed(fact.receiverCarrier, "wrapper-dispatch");
        if (fact.accessMode !== "write") {
          markProjectMemberUsed(fact.receiverCarrier, fact.declaration, "method-virtual");
        }
        if (fact.accessMode !== "read") {
          markProjectMemberUsed(fact.receiverCarrier, fact.declaration, "write");
        }
        return;
      case "source-accessor":
        if (isRustPreconstructionThisOperation(input.ast, node)) return;
        if (fact.dispatch !== undefined) {
          markProjectCarrierFieldUsed(fact.dispatch.ownerCarrier, "wrapper-dispatch");
          if (fact.accessMode !== "write") {
            markProjectMemberUsed(fact.dispatch.ownerCarrier, fact.read?.declaration, "read");
          }
          if (fact.accessMode !== "read") {
            markProjectMemberUsed(fact.dispatch.ownerCarrier, fact.write?.declaration, "write");
          }
        } else {
          const expression = Node_Expression(input.ast, node);
          const receiverCarrier = selectedReceiver ?? (fact.receiver.kind === "static" ? fact.receiver.typeCarrier :
            expression === undefined ? undefined : input.facts.getRuntimeCarrierFact(expression)?.carrier);
          if (receiverCarrier !== undefined) {
            if (fact.accessMode !== "write") markProjectMemberUsed(receiverCarrier, fact.read?.declaration, "read");
            if (fact.accessMode !== "read") markProjectMemberUsed(receiverCarrier, fact.write?.declaration, "write");
          }
        }
        return;
      case "default-value":
        markProjectTypeConstructed(fact.resultCarrier);
        markProjectConstructorInvoked(fact.resultCarrier);
        markStructuralShapeConstructed(fact.resultCarrier);
        return;
      case "source-index-signature":
        markProjectCarrierFieldUsed(fact.receiverCarrier, "wrapper-state");
        markProjectCarrierFieldUsed(fact.receiverCarrier, "index-storage");
        return;
      case "iteration":
        if (fact.iterationKind === "for-in" && fact.lowering.kind === "static-keys") {
          markProjectWrapperCloneUsed(fact.iterableCarrier);
        }
        return;
      case "switch":
        for (const clause of fact.clauses) {
          if (clause.comparison?.kind !== "native") continue;
          visitConversion(clause.comparison.operation.leftConversion);
          visitConversion(clause.comparison.operation.rightConversion);
        }
        return;
      case "array-literal":
        markProjectTypeReified(fact.elementCarrier);
        for (const contribution of fact.contributions) {
          if (contribution.kind === "spread") for (const input of contribution.input.inputs) {
            if (input.kind === "sequence") visitConversion(input.conversion);
          }
        }
        return;
      case "string-concat":
      case "sequence":
      case "conditional":
      case "template-string":
      case "typeof":
      case "void-expression":
      case "identity-expression":
      case "non-null-expression":
      case "option-check":
      case "option-equality":
      case "option-value-equality":
      case "constant-equality":
      case "program-error-type-test":
      case "builtin-error-property":
      case "source-static-field":
      case "provider-record-literal":
      case "fixed-array-literal":
      case "fixed-index":
      case "tuple-literal":
      case "tuple-index":
      case "await-op":
      case "closure":
      case "throw-op":
      case "regexp-create":
      case "option-none":
      case "option-wrap":
      case "option-coalesce":
      case "nullish-identity":
      case "reference-operation":
      case "typed-location":
      case "native-pointer":
      case "flow-marker":
        return;
    }
  };

  for (const sourceFile of input.sourceFiles) {
    const pending: { readonly node: Node; readonly insideTypeAlias: boolean }[] = [{
      node: sourceFile,
      insideTypeAlias: false,
    }];
    while (pending.length > 0) {
      const entry = pending.pop()!;
      const node = entry.node;
      const insideTypeAlias = entry.insideTypeAlias ||
        input.ast.kindName(node) === "KindTypeAliasDeclaration";
      if (!insideTypeAlias && !declarationNames.has(node) &&
        input.projectTypes.definitionForDeclaration(node) === undefined) {
        markProjectTypeUsed(input.facts.getRuntimeCarrierFact(node)?.carrier);
      }
      const fact = input.facts.getFact(node, rustTargetOperationFactKey);
      const propertyProjection = input.facts.getFact(node, rustPropertyProjectionFactKey);
      for (const projection of propertyProjection?.cases ?? []) {
        for (const read of projection.reads) {
          visitFact(node, { ...read, operationId: "selected-property-projection", accessMode: "read" }, projection.source);
        }
      }
      const classValue = input.facts.getFact(node, rustClassValueFactKey);
      if (classValue !== undefined) {
        markStructuralShapeConstructed(classValue.carrier);
        const view = input.classValues.viewFor(classValue.declaration, classValue.sourceCarrier, classValue.carrier);
        if (view?.construction !== undefined) markProjectConstructorInvoked(view.construction.ownerCarrier);
        for (const callable of [view?.construction, ...(view?.fields.map(field => field.callable) ?? [])]) {
          if (callable === undefined) continue;
          markProjectTypeReified(callable.carrier);
          visitCallableAdapter(callable.resultAdapter);
        }
      }
      const memoryBinding = input.facts.getFact(node, rustMemoryBindingPlanKey);
      if (memoryBinding?.kind === "record") markStructuralShapeConstructed(memoryBinding.carrier);
      visitProjectProjectionFacts(node);
      const objectView = input.facts.getFact(node, rustObjectReferenceViewKey);
      if (objectView !== undefined) {
        markStructuralShapeConstructed(objectView.targetCarrier);
        markProjectIdentityUsed(objectView.sourceCarrier);
        for (const field of objectView.kind === "structural" ? objectView.fields : []) visitFact(node, { ...field.source, operationId: "object-reference-view",
          accessMode: field.writable ? "read-write" : "read" });
      }
      visitContextualConversion(input.facts.getFact(node, rustContextualValueConversionFactKey)?.conversion);
      if (fact !== undefined) visitFact(node, fact);
      input.ast.forEachChild(node, (child) => {
        if (child !== undefined) pending.push({ node: child, insideTypeAlias });
      });
    }
  }

  for (const declaration of input.declarations) {
    const carrier = rustProjectRootThisCarrier(declaration, input.ast, input.facts, input.projectTypes);
    if (carrier !== undefined) markProjectTypeConstructed(carrier);
  }

  for (const implementation of input.typeFamilies.implementations) {
    const field = implementation.field;
    if (field === undefined) continue;
    const definition = input.projectTypes.definitionForCarrier(implementation.owner);
    const declaration = definition === undefined ? undefined
      : rustProjectObjectLayout(definition.declaration, input.ast)?.fields.find(candidate =>
        candidate.storageIndex + (input.projectTypes.externalBaseForDefinition(definition)?.fields.length ?? 0) === field.storageIndex)?.declaration;
    const subject = definition?.declaration ?? input.sourceFiles[0];
    if (subject === undefined) throw new Error("An emitted indexed field has no owning source file.");
    const dispatched = definition !== undefined && declaration !== undefined && input.projectTypes.isPolymorphic(definition);
    const read = dispatched ? input.projectTypes.memberSlotName(declaration, "read") : undefined;
    const write = dispatched ? input.projectTypes.memberSlotName(declaration, "write") : undefined;
    if (dispatched && (read === undefined || write === undefined)) {
      throw new Error("An emitted indexed field lost its exact native dispatch slots.");
    }
    visitFact(subject, {
      kind: "source-field", operationId: "indexed-field-implementation", declaration,
      receiverCarrier: implementation.owner, storage: field.storage, storageIndex: field.storageIndex,
      resultCarrier: implementation.output, valueSemantics: { kind: "stored" },
      accessMode: field.sharedWrite ? "read-write" : "read",
      ...(read === undefined || write === undefined ? {}
        : { dispatch: { read, write, ownerCarrier: implementation.owner } }),
    });
  }

  for (const definition of input.projectTypes.definitions) {
    for (const adapter of input.facts.getFact(definition.declaration, rustProjectCallableAdaptersKey) ?? []) {
      visitCallableAdapter(adapter.resultAdapter);
      for (const parameter of adapter.parameterAdapters) {
        if (parameter.kind === "rest") {
          for (const segment of parameter.segments) visitCallableAdapter(segment.adapter);
        } else if (parameter.kind !== "omitted") visitCallableAdapter(parameter.adapter);
      }
    }
  }

  for (const view of input.classValues.instanceViews) {
    const fields = rustStructuralObjectCarrierValue(view.targetCarrier)?.fields;
    for (const member of view.fields) {
      if (member.callable !== undefined) {
        markProjectMemberUsed(member.callable.ownerCarrier, member.callable.declaration, "method-exact");
      }
      if (member.field !== undefined) {
        const writable = fields?.[member.storageIndex]?.readonly === false;
        visitFact(member.declaration, { ...member.field, operationId: "project-structural-view",
          accessMode: writable ? "read-write" : "read" });
      }
      if (member.accessor !== undefined) {
        visitFact(member.declaration, { ...member.accessor, operationId: "project-structural-accessor-view",
          accessMode: member.accessor.write === undefined ? "read" : "read-write" });
      }
    }
  }

  return usage;
}
