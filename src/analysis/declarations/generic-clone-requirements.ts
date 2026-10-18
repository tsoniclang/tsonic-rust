import type { Node } from "@tsonic/tsts";
import type { RustContextualValueConversion } from "../../target-model/conversions/contextual.js";
import { rustValueConversionContract, type RustValueConversionContract } from "../../target-model/conversions/contracts.js";
import type { RustFinalizedValueConversion } from "../../target-model/records/finalized-operation.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustReadTransferRequirement, type RustOwnershipFlow } from "../ownership/flow.js";
import type { RustReadOwnershipRequirements } from "../ownership/reads.js";
import type { RustGenericRequirement } from "./generic-requirements.js";
import type { RustCallableInvocationRequirementContext } from "./generic-callable-invocation-requirements.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import { ElementAccessExpression_ArgumentExpression, KindBinaryExpression, KindExpressionStatement,
  Node_Expression } from "@tsonic/target-api/source";
import { isRustCopyCarrier } from "../../target-model/types/index.js";
import { rustBindingProjectionCloneCarriers } from "../../policy/types/storage/binding-normalization.js";
import { rustProjectStaticFieldStorage } from "../project-types/object-layout.js";
import { rustJsArrayEntriesElementTargetType } from "../../target-model/types/carriers/array-entries.js";
import { rustRecordReadAdmitsAbsence } from "../../target-model/types/carriers/records.js";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import { rustValueCarrierBeforeOptionProjection } from "../conversions/value-carrier-queries.js";
import { rustFinalizedSourceInputs } from "../operations/finalized-operation/conversions.js";

interface RustCloneRequirementContext extends Pick<RustCallableInvocationRequirementContext,
  "ast" | "records" | "projectTypes"> {
  readonly typeDefinitions: RustTypeDefinitions;
  readonly readRequirements: RustReadOwnershipRequirements;
  readonly ownershipFlow: RustOwnershipFlow;
}

export function createRustCloneRequirementCollector(
  input: RustCloneRequirementContext,
  addUse: (node: Node, carrier: TargetTypeRef | undefined, requirements: readonly RustGenericRequirement[]) => string | undefined,
): {
  binding(node: Node, carrier: TargetTypeRef | undefined): string | undefined;
  operation(node: Node, operation: RustTargetOperationFact | undefined): string | undefined;
  read(node: Node, operation: RustTargetOperationFact | undefined): string | undefined;
} {
  const { ast, records } = input;
  const requireConversionContract = (node: Node, selected: RustValueConversionContract): string | undefined => {
    const children: RustValueConversionContract[] = [];
    const required: { readonly carrier: TargetTypeRef; readonly requirements: readonly RustGenericRequirement[] }[] = [];
    switch (selected.lowering) {
      case "project-closed-value":
        required.push({ carrier: selected.source, requirements: ["static"] });
        break;
      case "call":
        if (selected.path === "js_abi::js_value_from_closed") required.push({ carrier: selected.source, requirements: ["clone", "static"] });
        else if (/^(rt::TsValue|js_abi::JsValue)::from_(closed|identity|shared_identity|error)$/u.test(selected.path))
          required.push({ carrier: selected.source, requirements: ["static"] });
        break;
      case "rest-sequence":
        required.push(...selected.cloneSources.map(carrier => ({ carrier, requirements: ["clone"] as const })));
        children.push(...selected.elementConversions.flatMap(conversion => conversion === null ? [] : [conversion]));
        break;
      case "js-array-backing":
        required.push({ carrier: selected.element, requirements: ["static"] });
        break;
      case "js-value-from-array":
        required.push({ carrier: selected.element, requirements: ["clone", "static"] });
        children.push(selected.elementConversion);
        break;
      case "closed-value-from-option": children.push(selected.elementConversion); break;
      case "option-map": children.push(selected.element); break;
      case "option-some": if (selected.element !== null) children.push(selected.element); break;
      case "source-union-variant": if (selected.payloadConversion !== null) children.push(selected.payloadConversion); break;
      case "union-fold": children.push(...selected.arms.map(arm => arm.conversion)); break;
      case "js-value-from-structural-to-json": children.push(selected.resultConversion); break;
      case "js-value-from-properties":
      case "js-value-from-structural-object":
        for (const field of selected.fields) {
          required.push({ carrier: field.sourceCarrier, requirements: ["clone"] });
          children.push(field.conversion);
        }
        break;
      case "program-error": {
        const visitRoute = (route: typeof selected.route): string | undefined => {
          if (route.kind === "closed-admission") return requireConversion(node, route.admission);
          for (const arm of route.kind === "union" ? route.arms : []) {
            const error = visitRoute(arm.route);
            if (error !== undefined) return error;
          }
          return undefined;
        };
        const error = visitRoute(selected.route);
        if (error !== undefined) return error;
        break;
      }
    }
    for (const { carrier, requirements } of required) {
      const error = addUse(node, carrier, requirements);
      if (error !== undefined) return error;
    }
    for (const child of children) {
      const error = requireConversionContract(node, child);
      if (error !== undefined) return error;
    }
    return undefined;
  };
  const requireConversion = (node: Node, conversion: RustContextualValueConversion): string | undefined => {
    if (conversion.kind === "provider-record-copy") {
      for (const field of conversion.fields) {
        const error = addUse(node, field.sourceCarrier, ["clone"]) ??
          (field.conversion === undefined ? undefined : requireConversion(node, field.conversion));
        if (error !== undefined) return error;
      }
      return undefined;
    }
    if (conversion.kind === "project-union-map") {
      const projection = input.readRequirements.storageReads.get(node)?.projection;
      const moving = projection?.flowConversionInput === "borrow-unless-moving" &&
        rustReadTransferRequirement(input.ownershipFlow, node) === "transfer";
      if (!moving) for (const arm of conversion.arms) {
        if (arm.source[arm.source.length - 1]?.variant.kind !== "payload") continue;
        const error = addUse(node, arm.carrier, ["clone"]);
        if (error !== undefined) return error;
      }
      return undefined;
    }
    if (conversion.kind === "callable-adapter") {
      for (const value of [...conversion.parameters, conversion.result]) {
        if (value.kind !== "value") continue;
        const error = requireConversion(node, value.conversion);
        if (error !== undefined) return error;
      }
      return undefined;
    }
    if (conversion.kind === "native-trait-object-upcast" || conversion.kind === "reference-reborrow" ||
      conversion.kind === "generic-callable-flow" || conversion.kind === "empty-record" || conversion.kind === "integer-truncation") return undefined;
    const selected = rustValueConversionContract(conversion, input.typeDefinitions);
    return selected === undefined ? "A selected native conversion lost its exact physical requirement contract."
      : requireConversionContract(node, selected);
  };
  const requireFinalizedConversion = (node: Node, conversion: RustFinalizedValueConversion): string | undefined => {
    if (conversion.kind === "identity") return undefined;
    for (const step of conversion.kind === "sequence" ? conversion.steps : [conversion]) {
      const error = requireConversion(node, step.conversion);
      if (error !== undefined) return error;
    }
    return undefined;
  };
  return {
    binding(node, carrier) {
      const moduleBinding = records.moduleBinding.get(node);
      const sourceBinding = records.sourceBinding.get(node);
      const referencedModule = sourceBinding === undefined ? undefined : records.moduleBinding.get(sourceBinding.sourceDeclaration);
      const storedCallable = moduleBinding?.storage === "native-callable" && moduleBinding.value !== undefined &&
        records.moduleCallableStorage.get(moduleBinding.callableDeclaration)?.kind === "stored" ? moduleBinding.value.carrier : undefined;
      const moduleCarrier = moduleBinding?.storage === "module-cell" && moduleBinding.initialization === "value"
        ? moduleBinding.valueCarrier : referencedModule?.storage === "module-cell" ? referencedModule.valueCarrier : storedCallable;
      const staticField = ast.kindName(node) !== "KindPropertyDeclaration" || !ast.hasModifierKind(node, "static") ? undefined
        : rustProjectStaticFieldStorage(node, ast, input.projectTypes.memberSlotName(node, "static"));
      if (moduleCarrier !== undefined || staticField !== undefined) {
        const error = addUse(node, moduleCarrier ?? carrier, ["clone", "static"]);
        if (error !== undefined) return error;
      }
      const contextual = records.contextualValueConversion.get(node);
      if (contextual !== undefined) {
        const error = requireConversion(node, contextual.conversion);
        if (error !== undefined) return error;
      }
      const projection = records.bindingProjection.get(node);
      for (const copied of projection === undefined ? [] : rustBindingProjectionCloneCarriers(projection)) {
        const error = addUse(node, copied, ["clone"]);
        if (error !== undefined) return error;
      }
      return undefined;
    },
    operation(node, operation) {
      if (operation?.kind === "project-type-test" && operation.lowering.kind === "closed-native" ||
        operation?.kind === "source-call" && operation.resultProjection?.kind === "closed-native") {
        const carrier = operation.kind === "source-call" ? operation.resultProjection!.selectedCarrier : operation.targetCarrier;
        const error = addUse(node, carrier, ["clone", "static"]);
        if (error !== undefined) return error;
      }
      if (operation?.kind === "operator-call" || operation?.kind === "operator-token") {
        for (const conversion of [operation.leftConversion, operation.rightConversion]) {
          const error = conversion === undefined ? undefined : requireConversion(node, conversion);
          if (error !== undefined) return error;
        }
      }
      if (operation?.kind === "logical-value") {
        for (const conversion of [operation.leftConversion, operation.rightConversion]) {
          const error = conversion === null ? undefined : requireFinalizedConversion(node, conversion);
          if (error !== undefined) return error;
        }
      }
      if (operation?.kind === "array-literal") {
        for (const contribution of operation.contributions) {
          if (contribution.kind !== "spread") continue;
          for (const selected of contribution.input.inputs) {
            if (selected.kind === "empty") continue;
            const conversion = rustValueConversionContract(selected.conversion, input.typeDefinitions);
            if (conversion?.lowering !== "rest-sequence") return "An array spread has no exact sequence conversion contract.";
            for (const element of conversion.cloneSources) {
              const error = addUse(node, element, ["clone"]);
              if (error !== undefined) return error;
            }
          }
        }
      }
      if (operation?.kind === "source-index-signature" &&
        (operation.accessMode === "read" || operation.accessMode === "read-write")) {
        const requirements: readonly RustGenericRequirement[] = operation.storage.kind === "record" &&
          rustRecordReadAdmitsAbsence(operation.resultCarrier) ? ["clone", "default"] : ["clone"];
        const error = addUse(node, operation.resultCarrier, requirements);
        if (error !== undefined) return error;
      }
      if (operation?.kind === "record-index-literal" && operation.contributions.some(contribution => contribution.kind === "spread")) {
        const error = addUse(node, operation.valueCarrier, ["clone"]);
        if (error !== undefined) return error;
      }
      if ((operation?.kind === "source-field" || operation?.kind === "source-union-field") && operation.accessMode !== "write") {
        const fields = operation.kind === "source-field" ? [operation]
          : operation.selectedVariantIndexes.map(index => operation.variants[index]?.field);
        if (fields.some(field => field?.storage === "structural-object" && field.valueSemantics.kind === "stored")) {
          const error = addUse(node, operation.resultCarrier, ["clone"]);
          if (error !== undefined) return error;
        }
      }
      if (operation?.kind === "nullish-assignment") {
        const parent = ast.parent(node);
        if (parent === undefined || ast.kindName(parent) !== KindExpressionStatement) {
          const error = addUse(node, operation.rightCarrier, ["clone"]);
          if (error !== undefined) return error;
        }
      }
      if (operation?.kind === "iteration" && operation.iterationKind !== "for-in") {
        const iterable = Node_Expression(ast, node);
        const carrier = iterable === undefined ? undefined : records.runtimeCarrier.get(iterable)?.carrier;
        if (operation.lowering.kind === "js-array" || operation.lowering.kind === "borrowed" && operation.lowering.style === "cloned" ||
          operation.lowering.kind === "receiver-method" && (rustJsArrayEntriesElementTargetType(carrier) !== undefined ||
            operation.lowering.name === "entries" || operation.lowering.name === "values")) {
          const error = addUse(node, operation.elementCarrier, ["clone"]);
          if (error !== undefined) return error;
        }
      }
      return undefined;
    },
    read(node, operation) {
      if (ast.kindName(node) === KindBinaryExpression) {
        const parent = ast.parent(node);
        const assignment = operation?.kind === "runtime-set" ||
          (operation?.kind === "operator-token" || operation?.kind === "operator-call") && isRustAssignmentOperator(operation.operator);
        if (assignment && (parent === undefined || ast.kindName(parent) !== KindExpressionStatement)) {
          const carrier = rustValueCarrierBeforeOptionProjection(records, node);
          if (carrier !== undefined) {
            const error = addUse(node, carrier, ["clone"]);
            if (error !== undefined) return error;
          }
        }
      }
      const projection = input.readRequirements.storageReads.get(node)?.projection;
      for (const carrier of projection?.requiredCloneSources ?? []) {
        const error = addUse(node, carrier, ["clone", "static"]);
        if (error !== undefined) return error;
      }
      if (projection !== undefined && rustReadTransferRequirement(input.ownershipFlow, node) !== "transfer" &&
        !(projection.cloneBorrowable && input.readRequirements.borrowed.has(node))) {
        for (const carrier of projection.cloneSources) {
          const error = addUse(node, carrier, ["clone"]);
          if (error !== undefined) return error;
        }
      }
      const providers = operation?.kind === "provider-operation" ? [operation] : operation?.kind === "union-property"
        ? operation.variants.flatMap(variant => variant.operation === undefined ? [] : [variant.operation]) : [];
      for (const provider of providers) {
        for (const result of input.readRequirements.nativeResults.get(node) ?? []) {
          if (result.abi !== provider.abi || !result.requiresClone) continue;
          const error = addUse(node, result.carrier, ["clone"]);
          if (error !== undefined) return error;
        }
        for (const argument of rustFinalizedSourceInputs(provider.abi)) {
          const error = requireFinalizedConversion(node, argument.conversion);
          if (error !== undefined) return error;
        }
        const result = provider.abi.result;
        const error = requireFinalizedConversion(node, result.kind === "sync" ? result.conversion : result.awaitedConversion);
        if (error !== undefined) return error;
        for (const argument of provider.abi.sourceArguments) {
          if (argument.disposition !== "runtime" || argument.mode !== "value" || argument.form !== "value") continue;
          const expression = ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node) ? ast.arguments(node)[argument.sourceIndex]
            : ast.is.IsElementAccessExpression(node) && argument.role === "index" && argument.sourceIndex === 0
              ? ElementAccessExpression_ArgumentExpression(ast, node) : undefined;
          if (expression === undefined || !ast.is.IsIdentifier(expression) ||
            rustReadTransferRequirement(input.ownershipFlow, expression) === "transfer") continue;
          const carrier = records.runtimeCarrier.get(expression)?.carrier;
          if (carrier === undefined) return "A provider argument lost its exact source storage carrier.";
          if (isRustCopyCarrier(carrier)) continue;
          const error = addUse(expression, carrier, ["clone"]);
          if (error !== undefined) return error;
        }
        for (const requirement of provider.carrierRequirements ?? []) {
          const error = addUse(node, requirement.carrier, [requirement.requirement]);
          if (error !== undefined) return error;
        }
      }
      return undefined;
    },
  };
}
