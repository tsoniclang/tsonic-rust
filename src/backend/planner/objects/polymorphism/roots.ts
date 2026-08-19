import {
  projectFieldStoragePath,
  projectMemberImplementation,
  projectMethodPropertyStoragePath,
  projectOwnAccessors,
  projectOwnMethodProperties,
  projectOwnFields,
  projectOwnMethods,
} from "./model.js";
import { planProjectFieldAccessorCall, planRootAccessorImplementation, planRootCallableForwarder, planRootMethodForwarder, planRootMethodImplementation, projectAccessorCallableShape, projectDowncastReturnType } from "./forwarders.js";
import { readRustProjectObjectField, writeRustProjectMethodOverride, writeRustProjectObjectField } from "../project-objects.js";
import { rustProjectDispatchTraitType, rustProjectTypeParameters } from "./names.js";
import { rustTargetTypeRefEquals } from "../../../../policy/types/equality.js";
import type { Node } from "@tsonic/tsts";
import type { RustImplFunction, RustItem, RustType } from "../../../rust-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import type { TargetTypeRef } from "../../../../policy/types/model.js";
import type { ProjectClassStateLayer } from "./model.js";

export function planProjectRootImplementations(
  concrete: RustProjectTypeDefinition,
  concreteCarrier: TargetTypeRef,
  rootType: RustType,
  layers: readonly ProjectClassStateLayer[],
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const lineage = context.input.projectTypes.classLineage(concrete);
  const interfaces = context.input.projectTypes.interfacesForClass(concrete);
  if (lineage === undefined || interfaces === undefined) {
    return undefined;
  }
  const items: RustItem[] = [];
  const typeParams = rustProjectTypeParameters(concrete);
  const methodImplementations = new Map<Node, RustImplFunction[]>();
  const accessorImplementations = new Map<Node, RustImplFunction>();
  const implementationFor = (
    implementation: Node,
    targetTypeArguments: readonly TargetTypeRef[],
  ): RustImplFunction | undefined => {
    const variant = context.input.projectMethodDispatch.variantForMember(
      implementation,
      targetTypeArguments,
    );
    if (variant === undefined) {
      return undefined;
    }
    const existing = (methodImplementations.get(implementation) ?? []).find((candidate) =>
      candidate.name === variant.exactSlot);
    if (existing !== undefined) {
      return existing;
    }
    const planned = planRootMethodImplementation(
      concreteCarrier,
      implementation,
      variant,
      context,
    );
    if (planned !== undefined) {
      const implementations = methodImplementations.get(implementation) ?? [];
      implementations.push(planned);
      methodImplementations.set(implementation, implementations);
    }
    return planned;
  };
  const accessorImplementationFor = (
    accessor: Node,
    role: "read" | "write",
  ): RustImplFunction | undefined => {
    const existing = accessorImplementations.get(accessor);
    if (existing !== undefined) {
      return existing;
    }
    const planned = planRootAccessorImplementation(
      concreteCarrier,
      accessor,
      role,
      context,
    );
    if (planned !== undefined) {
      accessorImplementations.set(accessor, planned);
    }
    return planned;
  };
  for (const contract of [...lineage, ...interfaces]) {
    const relation = context.input.projectTypes.relationship(concreteCarrier, contract);
    if (relation.kind !== "related") {
      return undefined;
    }
    const traitType = rustProjectDispatchTraitType(relation.targetType, context);
    const functions = planRootContractFunctions(
      concrete,
      concreteCarrier,
      contract,
      relation.targetType,
      rootType,
      layers,
      implementationFor,
      accessorImplementationFor,
      context,
    );
    if (traitType === undefined || functions === undefined) {
      return undefined;
    }
    items.push({
      kind: "impl",
      ...(typeParams.length === 0 ? {} : { typeParams }),
      trait: traitType,
      target: rootType,
      functions,
    });
  }
  const helpers = [
    ...methodImplementations.values(),
    ...[...accessorImplementations.values()].map((implementation) => [implementation]),
  ].flat().sort((left, right) =>
    left.name.localeCompare(right.name, "en"));
  return helpers.length === 0
    ? items
    : [{
        kind: "impl",
        ...(typeParams.length === 0 ? {} : { typeParams }),
        target: rootType,
        functions: helpers,
      }, ...items];
}

function planRootContractFunctions(
  concrete: RustProjectTypeDefinition,
  concreteCarrier: TargetTypeRef,
  contract: RustProjectTypeDefinition,
  contractCarrier: TargetTypeRef,
  rootType: RustType,
  layers: readonly ProjectClassStateLayer[],
  implementationFor: (
    implementation: Node,
    targetTypeArguments: readonly TargetTypeRef[],
  ) => RustImplFunction | undefined,
  accessorImplementationFor: (
    accessor: Node,
    role: "read" | "write",
  ) => RustImplFunction | undefined,
  context: RustPlanContext,
): readonly RustImplFunction[] | undefined {
  const functions: RustImplFunction[] = [];
  for (const route of context.input.projectTypes.downcastRoutesFor(contract)) {
    const returnType = projectDowncastReturnType(route, context);
    if (returnType === undefined) {
      return undefined;
    }
    const relation = context.input.projectTypes.relationship(concreteCarrier, route.target);
    const matches = relation.kind === "related" &&
      rustTargetTypeRefEquals(relation.targetType, route.targetCarrier);
    functions.push({
      name: route.slot,
      visibility: "private",
      selfParam: "rc",
      params: [],
      returnType,
      body: {
        statements: [{
          kind: "tail",
          expr: matches
            ? { kind: "call", path: "Some", args: [{ kind: "path", path: "self" }] }
            : { kind: "none" },
        }],
      },
    });
  }
  const fields = projectOwnFields(contract, contractCarrier, context);
  if (fields === undefined) {
    return undefined;
  }
  for (const field of fields) {
    const dispatch = context.input.projectFieldDispatch.planFor(field.declaration);
    const implementation = field.origin === "external"
      ? { kind: "stored" as const, declaration: field.declaration }
      : context.input.projectFieldDispatch.implementationFor(
          concrete,
          field.declaration,
        );
    const storagePath = implementation?.kind === "stored"
      ? projectFieldStoragePath(implementation.declaration, layers, context)
      : undefined;
    const readHelper = implementation?.kind === "accessor"
      ? accessorImplementationFor(implementation.getter, "read")
      : undefined;
    const read = context.input.projectTypes.memberSlotName(field.declaration, "read");
    const write = dispatch?.write === undefined
      ? undefined
      : context.input.projectTypes.memberSlotName(field.declaration, "write");
    const readValue = implementation?.kind === "stored"
      ? storagePath === undefined
        ? undefined
        : {
            expression: readRustProjectObjectField(
              { kind: "path", path: "self" },
              storagePath,
              field.carrier,
            ),
            fallible: false,
          }
      : implementation?.kind === "accessor"
        ? planProjectFieldAccessorCall(
            rootType,
            readHelper,
            undefined,
            field.type,
          )
        : undefined;
    if (dispatch === undefined || implementation === undefined || read === undefined ||
      readValue === undefined ||
      dispatch.write !== undefined && write === undefined) {
      return undefined;
    }
    const readResult = dispatch.read.fallible
      ? readValue.fallible
        ? readValue.expression
        : { kind: "call" as const, path: "Ok", args: [readValue.expression] }
      : readValue.fallible
        ? undefined
        : readValue.expression;
    if (readResult === undefined) {
      return undefined;
    }
    functions.push({
      name: read,
      visibility: "private",
      selfParam: dispatch.read.selfMode,
      params: [],
      returnType: field.type,
      ...(dispatch.read.fallible ? { fallible: true } : {}),
      body: {
        statements: [{
          kind: "tail",
          expr: readResult,
        }],
      },
    });
    if (dispatch.write !== undefined) {
      const writeValue = implementation.kind === "stored"
        ? storagePath === undefined
          ? undefined
          : {
              expression: writeRustProjectObjectField(
                { kind: "path", path: "self" },
                storagePath,
                "=",
                { kind: "path", path: "value" },
              ),
              fallible: false,
            }
        : implementation.setter === undefined
          ? undefined
          : (() => {
              const helper = accessorImplementationFor(implementation.setter!, "write");
              return planProjectFieldAccessorCall(
                rootType,
                helper,
                { kind: "path", path: "value" },
                field.type,
              );
            })();
      if (writeValue === undefined || !dispatch.write.fallible && writeValue.fallible) {
        return undefined;
      }
      functions.push({
        name: write!,
        visibility: "private",
        selfParam: dispatch.write.selfMode,
        params: [{ name: "value", type: field.type }],
        ...(dispatch.write.fallible ? { fallible: true } : {}),
        body: dispatch.write.fallible
          ? {
              statements: [{
                kind: "tail",
                expr: writeValue.fallible
                  ? writeValue.expression
                  : {
                      kind: "evaluate-then",
                      effect: writeValue.expression,
                      discard: "unit",
                      value: { kind: "call", path: "Ok", args: [{ kind: "path", path: "()" }] },
                    },
              }],
            }
          : {
              statements: [{
                kind: "expr",
                expr: writeValue.expression,
              }],
            },
      });
    }
  }
  for (const accessor of projectOwnAccessors(contract, context)) {
    const implementation = projectMemberImplementation(
      concrete,
      accessor.declaration,
      context,
    );
    const helper = implementation === undefined
      ? undefined
      : accessorImplementationFor(implementation, accessor.role);
    const slot = context.input.projectTypes.memberSlotName(
      accessor.declaration,
      accessor.role,
    );
    const contractShape = projectAccessorCallableShape(
      contract,
      contractCarrier,
      accessor.declaration,
      accessor.role,
      context,
    );
    const forwarder = implementation === undefined || helper === undefined ||
        slot === undefined || contractShape === undefined
      ? undefined
      : planRootCallableForwarder(
          implementation,
          slot,
          rootType,
          helper,
          contractShape,
          undefined,
          context,
        );
    if (forwarder === undefined) {
      return undefined;
    }
    functions.push(forwarder);
  }
  for (const member of projectOwnMethods(contract, context)) {
    if (context.input.ast.hasModifierKind(member, "static")) {
      continue;
    }
    for (const variant of context.input.projectMethodDispatch.variantsForMember(member)) {
      const virtualImplementation = projectMemberImplementation(concrete, member, context);
      if (virtualImplementation === undefined) {
        return undefined;
      }
      const virtualImplementationMethod = implementationFor(
        virtualImplementation,
        variant.targetTypeArguments,
      );
      const virtualMethod = virtualImplementationMethod === undefined
        ? undefined
        : planRootMethodForwarder(
            concreteCarrier,
            member,
            virtualImplementation,
            variant,
            variant.virtualSlot,
            rootType,
            virtualImplementationMethod,
            (context.input.projectMethodProperties.usageFor(member)?.writable === true ||
                context.input.projectMethodProperties.usageFor(virtualImplementation)?.writable === true)
              ? projectMethodPropertyStoragePath(
                  virtualImplementation,
                  layers,
                  context,
                )
              : undefined,
            context,
          );
      if (virtualMethod === undefined) {
        return undefined;
      }
      functions.push(virtualMethod);
      if (contract.kind === "class") {
        const exactImplementationMethod = implementationFor(
          member,
          variant.targetTypeArguments,
        );
        const exactMethod = exactImplementationMethod === undefined
          ? undefined
          : planRootMethodForwarder(
              concreteCarrier,
              member,
              member,
              variant,
              variant.exactSlot,
              rootType,
              exactImplementationMethod,
              undefined,
              context,
            );
        if (exactMethod === undefined) {
          return undefined;
        }
        functions.push(exactMethod);
      }
      const usage = context.input.projectMethodProperties.usageFor(member);
      if (usage?.writable === true) {
        const write = context.input.projectTypes.memberSlotName(member, "method-write");
        const storagePath = projectMethodPropertyStoragePath(
          virtualImplementation,
          layers,
          context,
        );
        const implementationOwner = context.input.projectTypes
          .definitionContainingDeclaration(virtualImplementation);
        const implementationCarrier = implementationOwner === undefined
          ? undefined
          : context.input.projectTypes.relationship(
              concreteCarrier,
              implementationOwner,
            );
        const properties = implementationCarrier?.kind === "related"
          ? projectOwnMethodProperties(
              implementationOwner!,
              implementationCarrier.targetType,
              context,
            )
          : undefined;
        const property = properties?.find((candidate) =>
          candidate.declaration === virtualImplementation);
        if (write === undefined || storagePath === undefined || property === undefined) {
          return undefined;
        }
        if (!functions.some((candidate) => candidate.name === write)) {
          functions.push({
            name: write,
            visibility: "private",
            selfParam: "ref",
            params: [{ name: "value", type: property.callableType }],
            body: {
              statements: [{
                kind: "expr",
                expr: writeRustProjectMethodOverride(
                  { kind: "path", path: "self" },
                  storagePath,
                  { kind: "path", path: "value" },
                ),
              }],
            },
          });
        }
      }
    }
  }
  return functions;
}
