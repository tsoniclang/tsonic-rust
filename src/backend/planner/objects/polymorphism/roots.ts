import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustImplFunction, RustItem, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustErrorBoundaryForProjectMember } from "../../program/plan-context.js";
import { rustErrorType, rustPackageFallibleBoundary } from "../../program/fallible-boundaries.js";
import { applyRustFallibleResultExpression } from "../../types/fallible-shape.js";
import { rustSelfParameter } from "../../declarations/callables/self-parameter.js";
import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustObjectRepresentation } from "../../../../target-model/records/objects/object-representation.js";
import type { RustProjectMethodDispatchVariant } from "../../../../target-model/records/operations/method-dispatch.js";
import type { RustProjectRootContractEmission } from "../../../../target-model/records/objects/project-classes.js";
import { projectFieldStoragePath, projectOwnFields, renderProjectMethodProperty } from "./model.js";
import type { ProjectClassStateLayer } from "./model.js";
import {
  planProjectDowncastRouteImplementation, planProjectFieldAccessorCall, planRootAccessorForwarder,
  planRootAccessorImplementation, planRootMethodForwarder, planRootMethodImplementation, projectAccessorCallableShape,
} from "./forwarders.js";
import {
  readRustProjectObjectField, readRustProjectObjectFieldOwner, readRustProjectPrivateField,
  writeRustProjectMethodOverride, writeRustProjectObjectField, writeRustProjectPrivateField,
  mutateRustProjectObjectField,
} from "../project-objects.js";
import { rustProjectDispatchTraitType, rustProjectRepresentationGenerics } from "./names.js";
import { rustCapturedFieldStorage } from "../captured-fields.js";
import { checkRustDataWrite } from "../data-writes.js";
import { checkedProjectProjectionTypes, planCheckedProjectProjectionImplementation } from "../checked-project-projections.js";
import { rustArrayFieldMutationName, rustArrayFieldMutationType } from "./array-fields.js";
import { rustProjectObjectIdentityImplementation } from "../project-identity.js";
import { planRustProjectErrorRoot } from "./project-errors.js";
import { planRustReceiverAlias } from "./receiver-aliases.js";

export function planProjectRootImplementations(
  concrete: RustProjectTypeDefinition,
  concreteCarrier: TargetTypeRef,
  rootType: RustType,
  layers: readonly ProjectClassStateLayer[],
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const headerPlacement = context.input.program.records.classImplementationContext.get(concrete.declaration, concreteCarrier);
  if (headerPlacement === undefined) failRustPlannerInvariant("A native root requires its exact completed generic header placement.", concrete.declaration);
  context = { ...context, nativeHeaderPlacement: headerPlacement, nativeHeaderParent: undefined };
  const selected = context.input.program.records.projectRootEmission.get(concreteCarrier);
  const representation = context.input.program.records.objectRepresentation.get(concrete);
  const instanceContracts = context.input.program.records.projectInstanceContracts.get(concreteCarrier);
  if (selected === undefined || representation === undefined || instanceContracts === undefined)
    failRustPlannerInvariant("An admitted native root requires its sealed contracts, projections and representation.", concrete.declaration);
  const errorImplementations = planRustProjectErrorRoot(concrete, concreteCarrier, rootType, layers, context);
  const projectionTypes = checkedProjectProjectionTypes(instanceContracts, selected.projections, context);
  if (errorImplementations === undefined || projectionTypes === undefined)
    failRustPlannerInvariant("An admitted native root requires renderable sealed error and projection implementations.", concrete.declaration);
  const generics = rustProjectRepresentationGenerics(representation, context);
  const items: RustItem[] = [...errorImplementations, rustProjectObjectIdentityImplementation(rootType, generics, {
    kind: "reference", expr: { kind: "field", receiver: { kind: "path", path: "self" }, name: "identity" },
  }, undefined, projectionTypes)];
  const methodImplementations = new Map<Node, RustImplFunction[]>();
  const accessorImplementations = new Map<Node, RustImplFunction>();
  const implementationFor = (implementation: Node, variant: RustProjectMethodDispatchVariant): RustImplFunction => {
    const implementations = methodImplementations.get(implementation) ?? [];
    const existing = implementations.find(candidate => candidate.name === variant.exactSlot);
    if (existing !== undefined) return existing;
    const planned = planRootMethodImplementation(concreteCarrier, implementation, variant, context);
    if (planned === undefined) failRustPlannerInvariant("An admitted native root method requires its exact implementation.", implementation);
    implementations.push(planned);
    methodImplementations.set(implementation, implementations);
    return planned;
  };
  const accessorImplementationFor = (accessor: Node, role: "read" | "write"): RustImplFunction => {
    const existing = accessorImplementations.get(accessor);
    if (existing !== undefined) return existing;
    const planned = planRootAccessorImplementation(concreteCarrier, accessor, role, context);
    if (planned === undefined) failRustPlannerInvariant("An admitted native root accessor requires its exact implementation.", accessor);
    accessorImplementations.set(accessor, planned);
    return planned;
  };
  for (const contract of selected.contracts) {
    const traitType = rustProjectDispatchTraitType(contract.carrier, context);
    if (traitType === undefined) failRustPlannerInvariant("An admitted native root contract requires its exact trait type.", contract.definition.declaration);
    items.push({ kind: "impl", generics, trait: traitType, target: rootType,
      members: planRootContractFunctions(concreteCarrier, contract, selected.projections, rootType, layers,
        representation, implementationFor, accessorImplementationFor, context) });
  }
  const helpers = [...methodImplementations.values(), [...accessorImplementations.values()]].flat()
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  return helpers.length === 0 ? items : [{ kind: "impl", generics, target: rootType, members: helpers }, ...items];
}

function planRootContractFunctions(
  concreteCarrier: TargetTypeRef,
  selected: RustProjectRootContractEmission,
  projections: readonly TargetTypeRef[],
  rootType: RustType,
  layers: readonly ProjectClassStateLayer[],
  representation: RustObjectRepresentation,
  implementationFor: (implementation: Node, variant: RustProjectMethodDispatchVariant) => RustImplFunction,
  accessorImplementationFor: (accessor: Node, role: "read" | "write") => RustImplFunction,
  context: RustPlanContext,
): readonly RustImplFunction[] {
  const functions: RustImplFunction[] = [];
  const contract = selected.definition;
  if (selected.projectionSlot !== undefined) {
    const contracts = context.input.program.records.projectInstanceContracts.get(concreteCarrier);
    const projection = contracts === undefined ? undefined
      : planCheckedProjectProjectionImplementation(selected.projectionSlot, contracts, projections, context);
    if (projection === undefined) failRustPlannerInvariant("An admitted root contract requires its exact checked projection.", contract.declaration);
    functions.push(projection);
  }
  for (const route of selected.routes) {
    const implementation = planProjectDowncastRouteImplementation(route, true, context);
    if (implementation === undefined) failRustPlannerInvariant("An admitted native root requires its exact downcast implementation.", contract.declaration);
    functions.push(implementation);
  }
  const fields = projectOwnFields(contract, selected.carrier, context);
  if (fields === undefined) failRustPlannerInvariant("An admitted root contract requires its exact native fields.", contract.declaration);
  for (const field of fields) {
    const chosen = selected.fields.get(field.declaration);
    if (chosen === undefined) failRustPlannerInvariant("An admitted root field requires its sealed native implementation.", field.declaration);
    const { implementation, dispatch, read, write } = chosen;
    const storagePath = implementation.kind === "stored"
      ? projectFieldStoragePath(implementation.declaration, layers, context) : undefined;
    if (rustCapturedFieldStorage(field.declaration, context) !== undefined) {
      const captureStorage = implementation.kind === "stored" ? rustCapturedFieldStorage(implementation.declaration, context) : undefined;
      if (chosen.capture === undefined || implementation.kind !== "stored" || storagePath === undefined || captureStorage === undefined)
        failRustPlannerInvariant("An admitted captured root field requires its exact physical owner slot.", field.declaration);
      functions.push({ kind: "function", name: chosen.capture, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter("ref"), params: [], returnType: field.storageType,
        body: { statements: [{ kind: "tail", expr: readRustProjectObjectFieldOwner(
          { kind: "path", path: "self" }, storagePath, representation, captureStorage) }] } });
    }
    const readHelper = implementation.kind === "accessor" ? accessorImplementationFor(implementation.getter, "read") : undefined;
    const readValue: { readonly expression: RustExpr; readonly errorType?: RustType } | undefined = implementation.kind === "receiver-alias"
      ? (() => {
          const expression = planRustReceiverAlias({ kind: "path", path: "self" }, concreteCarrier, field.carrier, context, true);
          return expression === undefined ? undefined : { expression };
        })()
      : implementation.kind === "stored"
        ? storagePath === undefined ? undefined : (() => {
            const expression = chosen.private
              ? readRustProjectPrivateField({ kind: "path", path: "self" }, storagePath, read, representation)
              : readRustProjectObjectField({ kind: "path", path: "self" }, storagePath, field.carrier, representation,
                context, rustCapturedFieldStorage(implementation.declaration, context));
            return expression === undefined ? undefined : { expression };
          })()
        : planProjectFieldAccessorCall(rootType, readHelper, undefined);
    if (readValue === undefined) failRustPlannerInvariant("An admitted root field requires its exact native read expression.", field.declaration);
    if (chosen.contentMutation) {
      if (storagePath === undefined) failRustPlannerInvariant("An admitted mutable root field requires its exact stored path.", field.declaration);
      const mutation = mutateRustProjectObjectField({ kind: "path", path: "self" }, storagePath,
        storage => ({ kind: "invoke", callee: { kind: "path", path: "action" }, args: [
          { kind: "reference", mutable: true, expr: storage },
        ] }), representation);
      if (mutation === undefined) failRustPlannerInvariant("An admitted mutable root field requires its native mutation expression.", field.declaration);
      functions.push({ kind: "function", name: rustArrayFieldMutationName(read), visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter("ref"), params: [{ name: "action", type: rustArrayFieldMutationType(field.type) }],
        body: { statements: [{ kind: "expr", expr: mutation }] } });
    }
    const fieldErrorBoundary = dispatch.read.fallible || dispatch.write?.fallible === true
      ? rustErrorBoundaryForProjectMember(field.declaration, context) : undefined;
    if ((dispatch.read.fallible || dispatch.write?.fallible === true) && fieldErrorBoundary === undefined)
      failRustPlannerInvariant("An admitted fallible root field requires its exact native error boundary.", field.declaration);
    const fieldErrorType = fieldErrorBoundary === undefined ? undefined : rustErrorType(fieldErrorBoundary);
    const readResult = chosen.readWrap
      ? applyRustFallibleResultExpression(readValue.expression, { errorType: fieldErrorType! }) : readValue.expression;
    functions.push({ kind: "function", name: read, visibility: "private", generics: emptyRustGenerics,
      selfParam: rustSelfParameter(dispatch.read.selfMode), params: [], returnType: field.type,
      ...(dispatch.read.fallible ? { errorType: fieldErrorType! } : {}),
      body: { statements: [{ kind: "tail", expr: readResult }] } });
    if (dispatch.write !== undefined) {
      const writeValue: { readonly expression: RustExpr; readonly errorType?: RustType } | undefined = implementation.kind === "stored"
        ? storagePath === undefined ? undefined : (() => {
            const expression = chosen.private
              ? writeRustProjectPrivateField({ kind: "path", path: "self" }, storagePath, write!, { kind: "path", path: "value" }, representation)
              : writeRustProjectObjectField({ kind: "path", path: "self" }, storagePath, "=", { kind: "path", path: "value" },
                representation, rustCapturedFieldStorage(implementation.declaration, context));
            const check = context.input.program.records.frozenDataReceiver.get(implementation.declaration);
            if (check !== undefined && fieldErrorBoundary === undefined)
              failRustPlannerInvariant("An admitted checked root field write requires its native error boundary.", field.declaration);
            const checked = expression === undefined ? undefined : check === undefined ? expression
              : checkRustDataWrite(check, { kind: "path", path: "self" }, expression, rustPackageFallibleBoundary(fieldErrorBoundary!));
            return checked === undefined ? undefined : { expression: checked };
          })()
        : implementation.kind !== "accessor" || implementation.setter === undefined ? undefined
          : planProjectFieldAccessorCall(rootType, accessorImplementationFor(implementation.setter, "write"), { kind: "path", path: "value" });
      if (write === undefined || writeValue === undefined)
        failRustPlannerInvariant("An admitted root field write requires its exact native expression and slot.", field.declaration);
      functions.push({ kind: "function", name: write, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter(dispatch.write.selfMode), params: [{ name: "value", type: field.type }],
        ...(dispatch.write.fallible ? { errorType: fieldErrorType! } : {}),
        body: dispatch.write.fallible ? { statements: [{ kind: "tail", expr: chosen.writeWrap
          ? { kind: "evaluate-then", effect: writeValue.expression, discard: "unit",
              value: applyRustFallibleResultExpression({ kind: "path", path: "()" }, { errorType: fieldErrorType! }) }
          : writeValue.expression }] } : { statements: [{ kind: "expr", expr: writeValue.expression }] } });
    }
  }
  for (const accessor of selected.accessors) {
    const helper = accessorImplementationFor(accessor.implementation, accessor.role);
    const shape = projectAccessorCallableShape(contract, selected.carrier, accessor.declaration, accessor.role, context);
    const forwarder = shape === undefined ? undefined : planRootAccessorForwarder(concreteCarrier, accessor.declaration,
      accessor.implementation, accessor.role, accessor.slot, rootType, helper, shape, context);
    if (forwarder === undefined) failRustPlannerInvariant("An admitted root accessor requires its exact native forwarding implementation.", accessor.declaration);
    functions.push(forwarder);
  }
  for (const method of selected.methods) {
    const virtual = implementationFor(method.virtual.declaration, method.virtual.variant);
    const virtualMethod = planRootMethodForwarder(concreteCarrier, method.member, method.virtual.declaration,
      method.variant, method.variant.virtualSlot, rootType, virtual, method.overridePath, context);
    if (virtualMethod === undefined) failRustPlannerInvariant("An admitted root method requires its exact virtual native forwarder.", method.member);
    functions.push(virtualMethod);
    if (method.exact !== undefined) {
      const exact = implementationFor(method.exact.declaration, method.exact.variant);
      const exactMethod = planRootMethodForwarder(concreteCarrier, method.member, method.exact.declaration,
        method.variant, method.variant.exactSlot, rootType, exact, undefined, context);
      if (exactMethod === undefined) failRustPlannerInvariant("An admitted root method requires its exact native forwarder.", method.member);
      functions.push(exactMethod);
    }
    if (method.write !== undefined) {
      const property = renderProjectMethodProperty(method.write.property, context);
      const replacement = writeRustProjectMethodOverride({ kind: "path", path: "self" }, method.write.path,
        { kind: "path", path: "value" }, representation);
      if (replacement === undefined) failRustPlannerInvariant("An admitted writable root method requires its exact native replacement.", method.member);
      functions.push({ kind: "function", name: method.write.slot, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter("ref"), params: [{ name: "value", type: property.callableType }],
        body: { statements: [{ kind: "expr", expr: replacement }] } });
    }
  }
  return functions;
}
