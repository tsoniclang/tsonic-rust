import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetPlanningSourceNavigation } from "@tsonic/target-api/analysis";
import {
  rustFlowReadProjectionFactKey,
  rustBindingProjectionFactKey,
  rustProjectDowncastFactKey,
  rustProjectUpcastFactKey,
  rustTargetOperationFactKey,
  rustTypeAliasDeclarationFactKey,
} from "../../../analysis/facts/keys.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/operations/facts.js";
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
import type { RustProjectMethodPropertyPlan } from "../../../analysis/project-types/method-properties.js";
import type { RustProjectFieldDispatchQueries } from "../../../analysis/project-types/field-dispatch.js";
import type { RustObjectRepresentationPlan } from "../../../analysis/project-types/object-representation.js";
import { rustProjectObjectLayout } from "../../../analysis/project-types/object-layout.js";
import type { RustProjectTypeDefinition } from "../../../analysis/project-types/type-policy.js";
import type { RustProjectTypePolicy } from "../../../analysis/project-types/type-policy.js";
import {
  rustValueConversionContract,
} from "../../../target-model/conversions/contracts.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import type { RustValueConversion } from "../../../target-model/operations/model.js";
import type { RustPlanQueries } from "../../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustOptionElementCarrier } from "../../../target-model/types/index.js";
import {
  isRustPreconstructionThisOperation,
  markBinaryProjectIdentityUsed,
  structuralFieldKey,
  visitConversionContract,
} from "./generated-item-usage-helpers.js";

export type RustDispatchMemberRole =
  | "read"
  | "write"
  | "method-virtual"
  | "method-exact";

export type RustGeneratedProjectFieldRole =
  | "wrapper-identity"
  | "wrapper-dispatch"
  | "wrapper-state"
  | "base-state"
  | "index-storage";

export interface RustGeneratedItemUsage {
  isProjectTypeUsed(declaration: Node): boolean;
  isProjectTypeConstructed(declaration: Node): boolean;
  isProjectConstructorInvoked(declaration: Node): boolean;
  isAuthoredFieldRead(declaration: Node): boolean;
  isProjectGeneratedFieldUsed(
    declaration: Node,
    role: RustGeneratedProjectFieldRole,
  ): boolean;
  isDispatchMemberUsed(declaration: Node, role: RustDispatchMemberRole): boolean;
  isDowncastUsed(source: Node, target: Node): boolean;
  isStructuralFieldRead(carrier: TargetTypeRef, storageIndex: number): boolean;
  isStructuralFieldWritten(carrier: TargetTypeRef, storageIndex: number): boolean;
  isStructuralShapeConstructed(carrier: TargetTypeRef): boolean;
  isVariantConstructed(declaration: Node, variantName: string): boolean;
}

type RustOperationAbi = Extract<
  RustTargetOperationFact,
  { readonly kind: "provider-operation" | "runtime-set" }
>["abi"];

export function analyzeRustGeneratedItemUsage(input: {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly declarations: readonly Node[];
  readonly facts: RustPlanQueries;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly projectMethodProperties: RustProjectMethodPropertyPlan;
  readonly projectFieldDispatch: RustProjectFieldDispatchQueries;
  readonly navigation: TargetPlanningSourceNavigation;
}): RustGeneratedItemUsage {
  const declarationsByCarrier = new Map<string, Node[]>();
  for (const declaration of input.declarations) {
    const kind = input.ast.kindName(declaration);
    if (kind !== "KindEnumDeclaration" && kind !== "KindTypeAliasDeclaration") continue;
    if (kind === "KindTypeAliasDeclaration" &&
      input.facts.getFact(declaration, rustTypeAliasDeclarationFactKey)?.kind === "erased") {
      continue;
    }
    const carrier = input.facts.getRuntimeCarrierFact(declaration)?.carrier;
    if (carrier === undefined) continue;
    const key = closedMetadataKey(carrier);
    const declarations = declarationsByCarrier.get(key) ?? [];
    declarations.push(declaration);
    declarationsByCarrier.set(key, declarations);
  }

  const structuralFieldReads = new Set<string>();
  const structuralFieldWrites = new Set<string>();
  const variantsByDeclaration = new Map<Node, Set<string>>();
  const usedProjectTypes = new WeakSet<Node>();
  const constructedProjectTypes = new WeakSet<Node>();
  const invokedProjectConstructors = new WeakSet<Node>();
  const readAuthoredFields = new WeakSet<Node>();
  const usedProjectFields = new WeakMap<Node, Set<RustGeneratedProjectFieldRole>>();
  const usedDispatchMembers = new WeakMap<Node, Set<RustDispatchMemberRole>>();
  const usedDowncasts = new WeakMap<Node, WeakSet<Node>>();
  const constructedStructuralShapes = new Set<string>();
  const declarationNames = new WeakSet<Node>();

  for (const declaration of input.declarations) {
    const name = input.ast.name(declaration);
    if (name !== undefined) declarationNames.add(name);
  }

  const markProjectTypeUsed = (carrier: TargetTypeRef | undefined): void => {
    const definition = input.projectTypes.definitionForCarrier(carrier);
    if (definition !== undefined) usedProjectTypes.add(definition.declaration);
  };
  const markProjectTypeConstructed = (carrier: TargetTypeRef | undefined): void => {
    const definition = input.projectTypes.definitionForCarrier(carrier);
    if (definition === undefined) return;
    usedProjectTypes.add(definition.declaration);
    constructedProjectTypes.add(definition.declaration);
  };
  const markProjectConstructorInvoked = (carrier: TargetTypeRef | undefined): void => {
    const definition = input.projectTypes.definitionForCarrier(carrier);
    if (definition?.kind !== "class") return;
    markProjectTypeConstructed(carrier);
    invokedProjectConstructors.add(definition.declaration);
  };
  const markProjectFieldUsed = (
    declaration: Node | undefined,
    role: RustGeneratedProjectFieldRole,
  ): void => {
    if (declaration === undefined) return;
    const roles = usedProjectFields.get(declaration) ?? new Set<RustGeneratedProjectFieldRole>();
    roles.add(role);
    usedProjectFields.set(declaration, roles);
  };
  const markProjectCarrierFieldUsed = (
    carrier: TargetTypeRef | undefined,
    role: RustGeneratedProjectFieldRole,
  ): void => {
    markProjectFieldUsed(input.projectTypes.definitionForCarrier(carrier)?.declaration, role);
  };
  const markDispatchMemberUsed = (
    declaration: Node | undefined,
    role: RustDispatchMemberRole,
  ): void => {
    if (declaration === undefined) return;
    const roles = usedDispatchMembers.get(declaration) ?? new Set<RustDispatchMemberRole>();
    roles.add(role);
    usedDispatchMembers.set(declaration, roles);
    const implementation = input.navigation.callableImplementation(declaration);
    if (implementation.kind === "resolved" &&
      implementation.implementation.declaration !== declaration) {
      const selected = implementation.implementation.declaration;
      const implementationRoles = usedDispatchMembers.get(selected) ??
        new Set<RustDispatchMemberRole>();
      implementationRoles.add(role);
      usedDispatchMembers.set(selected, implementationRoles);
    }
  };
  const markDowncastUsed = (source: TargetTypeRef, target: TargetTypeRef): void => {
    const sourceDefinition = input.projectTypes.definitionForCarrier(source);
    const targetDefinition = input.projectTypes.definitionForCarrier(target);
    if (sourceDefinition === undefined || targetDefinition === undefined) return;
    const targets = usedDowncasts.get(sourceDefinition.declaration) ?? new WeakSet<Node>();
    targets.add(targetDefinition.declaration);
    usedDowncasts.set(sourceDefinition.declaration, targets);
  };
  const markStructuralFieldRead = (carrier: TargetTypeRef, storageIndex: number): void => {
    if (Number.isSafeInteger(storageIndex) && storageIndex >= 0) {
      structuralFieldReads.add(structuralFieldKey(carrier, storageIndex));
    }
  };
  const markStructuralFieldWritten = (carrier: TargetTypeRef, storageIndex: number): void => {
    if (Number.isSafeInteger(storageIndex) && storageIndex >= 0) {
      structuralFieldWrites.add(structuralFieldKey(carrier, storageIndex));
    }
  };
  const markVariantConstructed = (carrier: TargetTypeRef, variantName: string): void => {
    for (const declaration of declarationsByCarrier.get(closedMetadataKey(carrier)) ?? []) {
      const variants = variantsByDeclaration.get(declaration) ?? new Set<string>();
      variants.add(variantName);
      variantsByDeclaration.set(declaration, variants);
    }
  };
  const markStructuralShapeConstructed = (carrier: TargetTypeRef | undefined): void => {
    if (carrier !== undefined) constructedStructuralShapes.add(closedMetadataKey(carrier));
  };
  const markProjectIdentityUsed = (carrier: TargetTypeRef | undefined): void => {
    const selected = carrier !== undefined &&
        input.projectTypes.definitionForCarrier(carrier) === undefined
      ? rustOptionElementCarrier(carrier)
      : carrier;
    markProjectCarrierFieldUsed(selected, "wrapper-identity");
  };
  const markProjectWrapperCloneUsed = (carrier: TargetTypeRef | undefined): void => {
    const definition = input.projectTypes.definitionForCarrier(carrier);
    const representation = input.objectRepresentations.representationFor(definition);
    if (definition === undefined || representation === undefined) return;
    if (representation.kind === "open-hierarchy" || representation.kind === "closed-hierarchy") {
      markProjectFieldUsed(definition.declaration, "wrapper-identity");
      markProjectFieldUsed(definition.declaration, "wrapper-dispatch");
      return;
    }
    if (representation.kind !== "value") {
      markProjectFieldUsed(definition.declaration, "wrapper-state");
    }
  };
  const markProjectStateOwnerUsed = (
    concrete: RustProjectTypeDefinition,
    storageOwner: RustProjectTypeDefinition,
  ): void => {
    const lineage = input.projectTypes.classLineage(concrete);
    const ownerIndex = lineage === undefined
      ? -1
      : lineage.indexOf(storageOwner);
    if (ownerIndex < 0 || lineage === undefined) return;
    for (let index = ownerIndex + 1; index < lineage.length; index += 1) {
      markProjectFieldUsed(lineage[index]!.declaration, "base-state");
    }
  };
  const markProjectStatePathUsed = (
    concrete: RustProjectTypeDefinition,
    implementation: Node,
  ): void => {
    const storageOwner = input.projectTypes.definitionContainingDeclaration(implementation);
    if (storageOwner !== undefined) markProjectStateOwnerUsed(concrete, storageOwner);
  };
  const markProjectMemberUsed = (
    receiverCarrier: TargetTypeRef,
    declaration: Node | undefined,
    role: RustDispatchMemberRole,
  ): void => {
    if (declaration === undefined) return;
    markDispatchMemberUsed(declaration, role);
    const receiver = input.projectTypes.definitionForCarrier(receiverCarrier) ??
      input.projectTypes.definitionContainingDeclaration(declaration);
    if (receiver === undefined) return;
    for (const concrete of input.projectTypes.concreteClassesFor(receiver)) {
      const selected = input.projectTypes.memberImplementation(concrete, declaration);
      const implementation = selected.kind === "resolved"
        ? selected.implementation.declaration
        : declaration;
      if (role === "read" || role === "write") {
        markProjectStatePathUsed(concrete, implementation);
        if (role === "read") readAuthoredFields.add(implementation);
        continue;
      }
      if (input.projectMethodProperties.usageFor(implementation)?.writable === true) {
        markProjectStatePathUsed(concrete, implementation);
      }
    }
  };

  const visitProjectProjectionFacts = (node: Node): void => {
    const binding = input.facts.getFact(node, rustBindingProjectionFactKey);
    if (binding?.projection.kind === "object-rest") {
      markStructuralShapeConstructed(binding.bindingCarrier);
    }
    const upcast = input.facts.getFact(node, rustProjectUpcastFactKey);
    if (upcast !== undefined) {
      markProjectCarrierFieldUsed(upcast.sourceCarrier, "wrapper-identity");
      markProjectCarrierFieldUsed(upcast.sourceCarrier, "wrapper-dispatch");
      markProjectTypeConstructed(upcast.targetCarrier);
    }
    const downcast = input.facts.getFact(node, rustProjectDowncastFactKey);
    if (downcast !== undefined) {
      markProjectCarrierFieldUsed(downcast.dispatchCarrier, "wrapper-identity");
      markProjectCarrierFieldUsed(downcast.dispatchCarrier, "wrapper-dispatch");
      markProjectTypeConstructed(downcast.targetCarrier);
      markDowncastUsed(downcast.dispatchCarrier, downcast.targetCarrier);
    }
    const flow = input.facts.getFact(node, rustFlowReadProjectionFactKey);
    if (flow?.kind === "project-downcast") {
      markProjectCarrierFieldUsed(flow.dispatchCarrier, "wrapper-identity");
      markProjectCarrierFieldUsed(flow.dispatchCarrier, "wrapper-dispatch");
      markProjectTypeConstructed(flow.selectedCarrier);
      markDowncastUsed(flow.dispatchCarrier, flow.selectedCarrier);
    }
  };

  for (const concrete of input.projectTypes.definitions) {
    if (concrete.kind !== "class" || !input.projectTypes.isPolymorphic(concrete)) continue;
    const lineage = input.projectTypes.classLineage(concrete);
    const interfaces = input.projectTypes.interfacesForClass(concrete);
    if (lineage === undefined || interfaces === undefined) continue;
    for (const contract of [...lineage, ...interfaces]) {
      const layout = rustProjectObjectLayout(contract.declaration, input.ast);
      const contractFields = [
        ...(input.projectTypes.externalBaseForDefinition(contract)?.fields ?? []).map((field) => ({
          declaration: field.declaration,
          external: true,
        })),
        ...(layout?.fields ?? []).map((field) => ({
          declaration: field.declaration,
          external: false,
        })),
      ];
      for (const field of contractFields) {
        const implementation = field.external
          ? { kind: "stored" as const, declaration: field.declaration }
          : input.projectFieldDispatch.implementationFor(concrete, field.declaration);
        if (implementation?.kind === "stored") {
          const owner = input.projectTypes.definitionContainingDeclaration(
            implementation.declaration,
          ) ?? contract;
          markProjectStateOwnerUsed(concrete, owner);
        }
      }
      for (const member of input.ast.members(contract.declaration)) {
        if (member === undefined || input.ast.hasModifierKind(member, "static")) continue;
        const kind = input.ast.kindName(member);
        if (kind !== "KindMethodDeclaration" && kind !== "KindMethodSignature" &&
          kind !== "KindGetAccessor" && kind !== "KindSetAccessor") {
          continue;
        }
        const selected = input.projectTypes.memberImplementation(concrete, member);
        if (selected.kind !== "resolved") continue;
        const implementation = selected.implementation.declaration;
        if ((kind === "KindMethodDeclaration" || kind === "KindMethodSignature") &&
          (input.projectMethodProperties.usageFor(member)?.writable === true ||
            input.projectMethodProperties.usageFor(implementation)?.writable === true)) {
          markProjectStatePathUsed(concrete, implementation);
        }
      }
    }
  }
  const visitConversion = (conversion: RustValueConversion | undefined): void => {
    if (conversion === undefined) return;
    const contract = rustValueConversionContract(conversion);
    if (contract === undefined) {
      throw new Error("A finalized Rust value conversion has no valid dead-code usage contract.");
    }
    visitConversionContract(contract, markStructuralFieldRead, markVariantConstructed);
  };
  const visitFinalizedConversion = (conversion: RustFinalizedValueConversion): void => {
    if (conversion.kind === "semantic") visitConversion(conversion.conversion);
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
  const visitAbi = (abi: RustOperationAbi): void => {
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
  const visitFact = (node: Node, fact: RustTargetOperationFact): void => {
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
          readAuthoredFields.add(fact.declaration);
        }
        if (fact.dispatch !== undefined) {
          markProjectCarrierFieldUsed(fact.receiverCarrier, "wrapper-dispatch");
          if (fact.accessMode !== "write") {
            markProjectMemberUsed(fact.receiverCarrier, fact.declaration, "read");
          }
          if (fact.accessMode !== "read") {
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
        if (fact.target.form === "constructor") {
          markProjectConstructorInvoked(fact.target.typeCarrier);
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
      case "record-literal":
        if (fact.storage === "project-object") {
          markProjectTypeConstructed(fact.resultCarrier);
        } else {
          markStructuralShapeConstructed(fact.resultCarrier);
        }
        for (const contribution of fact.contributions) {
          if (contribution.kind !== "spread") continue;
          for (const field of contribution.fields) {
            markStructuralFieldRead(contribution.sourceCarrier, field.sourceStorageIndex);
          }
        }
        return;
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
      case "string-concat":
      case "conditional":
      case "template-string":
      case "typeof":
      case "void-expression":
      case "identity-expression":
      case "non-null-expression":
      case "switch":
      case "array-literal":
      case "option-check":
      case "option-equality":
      case "option-value-equality":
      case "disjoint-equality":
      case "program-error-type-test":
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
      visitProjectProjectionFacts(node);
      if (fact !== undefined) visitFact(node, fact);
      input.ast.forEachChild(node, (child) => {
        if (child !== undefined) pending.push({ node: child, insideTypeAlias });
      });
    }
  }

  return Object.freeze({
    isProjectTypeUsed: (declaration: Node) => usedProjectTypes.has(declaration),
    isProjectTypeConstructed: (declaration: Node) =>
      constructedProjectTypes.has(declaration),
    isProjectConstructorInvoked: (declaration: Node) =>
      invokedProjectConstructors.has(declaration),
    isAuthoredFieldRead: (declaration: Node) => readAuthoredFields.has(declaration),
    isProjectGeneratedFieldUsed: (
      declaration: Node,
      role: RustGeneratedProjectFieldRole,
    ) => usedProjectFields.get(declaration)?.has(role) === true,
    isDispatchMemberUsed: (declaration: Node, role: RustDispatchMemberRole) =>
      usedDispatchMembers.get(declaration)?.has(role) === true,
    isDowncastUsed: (source: Node, target: Node) =>
      usedDowncasts.get(source)?.has(target) === true,
    isStructuralFieldRead: (carrier: TargetTypeRef, storageIndex: number) =>
      structuralFieldReads.has(structuralFieldKey(carrier, storageIndex)),
    isStructuralFieldWritten: (carrier: TargetTypeRef, storageIndex: number) =>
      structuralFieldWrites.has(structuralFieldKey(carrier, storageIndex)),
    isStructuralShapeConstructed: (carrier: TargetTypeRef) =>
      constructedStructuralShapes.has(closedMetadataKey(carrier)),
    isVariantConstructed: (declaration: Node, variantName: string) =>
      variantsByDeclaration.get(declaration)?.has(variantName) === true,
  });
}
