import {
  readRustProjectObjectField,
  readRustProjectMethodOverride,
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  writeRustProjectObjectField,
  writeRustProjectMethodOverride,
} from "../project-objects.js";
import { applyRustObjectLiteralValueAdapter, planRustObjectLiteralMethodArguments } from "../method-adapters.js";
import { projectOwnFields, projectOwnMethods } from "../polymorphism/model.js";
import { rustProjectDispatchTraitType } from "../polymorphism/names.js";
import { rustTargetTypeRefEquals } from "../../../../policy/types/equality.js";
import type {
  RustExpr,
  RustImplFunction,
  RustItem,
  RustType,
} from "../../../rust-ast/nodes.js";
import type { RustObjectLiteralAccessorImplementationPlan, RustObjectLiteralImplementationPlan, RustObjectLiteralMethodDispatchPlan } from "./model.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { TargetTypeRef } from "../../../../policy/types/model.js";

export function planContractImplementation(
  contract: import("../../../../analysis/project-types/type-policy.js").RustProjectInterfaceContract,
  resultCarrier: TargetTypeRef,
  rootType: RustType,
  wrapperType: RustType,
  stateFields: readonly RustObjectLiteralImplementationPlan["stateFields"][number][],
  accessors: readonly RustObjectLiteralAccessorImplementationPlan[],
  methods: readonly RustObjectLiteralMethodDispatchPlan[],
  context: RustPlanContext,
): RustItem | undefined {
  const trait = rustProjectDispatchTraitType(contract.carrier, context);
  const fields = projectOwnFields(contract.definition, contract.carrier, context);
  if (trait === undefined || fields === undefined || wrapperType.kind !== "named") {
    return undefined;
  }
  const functions: RustImplFunction[] = [];
  for (const route of context.input.projectTypes.downcastRoutesFor(contract.definition)) {
    const routeTrait = rustProjectDispatchTraitType(route.targetCarrier, context);
    if (routeTrait === undefined) {
      return undefined;
    }
    const relation = context.input.projectTypes.relationship(resultCarrier, route.target);
    const matches = relation.kind === "related" &&
      rustTargetTypeRefEquals(relation.targetType, route.targetCarrier);
    functions.push({
      name: route.slot,
      visibility: "private",
      selfParam: "rc",
      params: [],
      returnType: {
        kind: "named",
        path: "Option",
        typeArguments: [{
          kind: "named",
          path: "std::rc::Rc",
          typeArguments: [{ kind: "trait-object", trait: routeTrait }],
        }],
      },
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
  for (const field of fields) {
    const dispatch = context.input.projectFieldDispatch.planFor(field.declaration);
    const stateField = stateFields.find((candidate) =>
      candidate.contractDeclarations.includes(field.declaration));
    const accessor = accessors.find((candidate) =>
      candidate.contractDeclarations.includes(field.declaration));
    const read = context.input.projectTypes.memberSlotName(field.declaration, "read");
    const write = dispatch?.write === undefined
      ? undefined
      : context.input.projectTypes.memberSlotName(field.declaration, "write");
    if (dispatch === undefined || (stateField === undefined) === (accessor === undefined) ||
      read === undefined || dispatch.write !== undefined && write === undefined) {
      return undefined;
    }
    const readValue: RustExpr = stateField !== undefined
      ? readRustProjectObjectField(
          { kind: "path", path: "self" },
          stateField.targetName,
          field.carrier,
        )
      : {
          kind: "method-call",
          receiver: {
            kind: "field",
            receiver: { kind: "path", path: "self" },
            name: accessor!.getter.fieldName,
          },
          method: "call",
          args: [{
            kind: "tuple-literal",
            elements: [projectObjectLiteralReceiver(wrapperType.path, "self")],
          }],
        };
    const readResult = dispatch.read.fallible
      ? accessor === undefined
        ? { kind: "call" as const, path: "Ok", args: [readValue] }
        : readValue
      : accessor === undefined
        ? readValue
        : undefined;
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
      const writeValue: RustExpr | undefined = stateField !== undefined
        ? writeRustProjectObjectField(
            { kind: "path", path: "self" },
            stateField.targetName,
            "=",
            { kind: "path", path: "value" },
          )
        : accessor?.setter === undefined
          ? undefined
          : {
              kind: "method-call",
              receiver: {
                kind: "field",
                receiver: { kind: "path", path: "self" },
                name: accessor.setter.fieldName,
              },
              method: "call",
              args: [{
                kind: "tuple-literal",
                elements: [
                  projectObjectLiteralReceiver(wrapperType.path, "self"),
                  { kind: "path", path: "value" },
                ],
              }],
            };
      if (writeValue === undefined || !dispatch.write.fallible && accessor !== undefined) {
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
                expr: accessor === undefined
                  ? {
                      kind: "evaluate-then",
                      effect: writeValue,
                      discard: "unit",
                      value: { kind: "call", path: "Ok", args: [{ kind: "path", path: "()" }] },
                    }
                  : writeValue,
              }],
            }
          : {
              statements: [{ kind: "expr", expr: writeValue }],
            },
      });
    }
  }
  for (const contractMethod of projectOwnMethods(contract.definition, context)) {
    if (context.input.ast.hasModifierKind(contractMethod, "static")) {
      continue;
    }
    for (const variant of context.input.projectMethodDispatch.variantsForMember(contractMethod)) {
      const method = methods.find((candidate) =>
        candidate.contractMethod === contractMethod &&
        candidate.variant.virtualSlot === variant.virtualSlot);
      if (method === undefined) {
        return undefined;
      }
      if (wrapperType.kind !== "named") {
        return undefined;
      }
      const receiver: RustExpr = {
        kind: "struct-literal",
        path: wrapperType.path,
        fields: [{
          name: rustProjectObjectIdentityField,
          value: {
            kind: "method-call",
            receiver: {
              kind: "field",
              receiver: { kind: "path", path: "self" },
              name: rustProjectObjectIdentityField,
            },
            method: "clone",
            args: [],
          },
        }, {
          name: rustProjectObjectDispatchField,
          value: {
            kind: "method-call",
            receiver: { kind: "path", path: "self" },
            method: "clone",
            args: [],
          },
        }],
      };
      const implementationName = allocateMemberFieldName(
        new Set(method.parameters.map((parameter) => parameter.name)),
        "implementation",
      );
      const overrideName = allocateMemberFieldName(
        new Set([
          ...method.parameters.map((parameter) => parameter.name),
          implementationName,
        ]),
        "method_override",
      );
      const overrideStatements = method.override === undefined
        ? []
        : [{
            kind: "if-let-some" as const,
            binding: overrideName,
            expression: readRustProjectMethodOverride(
              { kind: "path", path: "self" },
              method.override.fieldName,
            ),
            body: {
              statements: [{
                kind: "return" as const,
                expr: {
                  kind: "method-call" as const,
                  receiver: { kind: "path" as const, path: overrideName },
                  method: "call",
                  args: [{
                    kind: "tuple-literal" as const,
                    elements: method.parameters.map((parameter) => ({
                      kind: "path" as const,
                      path: parameter.name,
                    })),
                  }],
                },
              }],
            },
          }];
      const adapterContext: RustPlanContext = {
        ...context,
        fallibleContext: method.fallible,
      };
      const implementationBinding: RustExpr = {
        kind: "path",
        path: implementationName,
      };
      if (method.adapter === undefined) {
        const invocation: RustExpr = {
          kind: "method-call",
          receiver: implementationBinding,
          method: "call",
          args: [{
            kind: "tuple-literal",
            elements: method.parameters.map((parameter) => ({
              kind: "path" as const,
              path: parameter.name,
            })),
          }],
        };
        functions.push({
          name: variant.virtualSlot,
          visibility: "private",
          selfParam: "rc",
          params: method.parameters,
          ...(method.returnType === undefined ? {} : { returnType: method.returnType }),
          fallible: true,
          body: {
            statements: [...overrideStatements, {
              kind: "let",
              name: implementationName,
              mutable: false,
              init: {
                kind: "method-call",
                receiver: {
                  kind: "field",
                  receiver: { kind: "path", path: "self" },
                  name: method.implementation.fieldName,
                },
                method: "clone",
                args: [],
              },
            }, {
              kind: "tail",
              expr: invocation,
            }],
          },
        });
        continue;
      }
      const adapted = planRustObjectLiteralMethodArguments(method, adapterContext);
      if (adapted === undefined) {
        return undefined;
      }
      let invocation: RustExpr = {
        kind: "method-call",
        receiver: implementationBinding,
        method: "call",
        args: [{
          kind: "tuple-literal",
          elements: [receiver, ...adapted.adaptedArguments],
        }],
      };
      if (method.implementation.fallible) {
        invocation = { kind: "try", expr: invocation, errorDomain: "runtime" };
      }
      const adaptedResult = applyRustObjectLiteralValueAdapter(
        invocation,
        method.adapter.resultAdapter,
        method.contractMethod,
        adapterContext,
      );
      if (adaptedResult === undefined) {
        return undefined;
      }
      const result = method.fallible
        ? adaptedResult.kind === "try"
          ? adaptedResult.expr
          : { kind: "call" as const, path: "Ok", args: [adaptedResult] }
        : adaptedResult;
      functions.push({
        name: variant.virtualSlot,
        visibility: "private",
        selfParam: "rc",
        params: method.parameters,
        ...(method.returnType === undefined ? {} : { returnType: method.returnType }),
        ...(method.fallible ? { fallible: true } : {}),
        ...(method.isUnsafe ? { isUnsafe: true } : {}),
        body: {
          statements: [...overrideStatements, {
            kind: "let",
            name: implementationName,
            mutable: false,
            init: {
              kind: "method-call",
              receiver: {
                kind: "field",
                receiver: { kind: "path", path: "self" },
                name: method.implementation.fieldName,
              },
              method: "clone",
              args: [],
            },
          }, ...adapted.statements, {
            kind: "tail",
            expr: result,
          }],
        },
      });
    }
    const usage = context.input.projectMethodProperties.usageFor(contractMethod);
    if (usage?.writable === true) {
      const implementations = methods.filter((candidate) =>
        candidate.contractMethod === contractMethod);
      const override = implementations[0]?.override;
      const write = context.input.projectTypes.memberSlotName(
        contractMethod,
        "method-write",
      );
      if (override === undefined || write === undefined ||
        implementations.some((candidate) => candidate.override !== override)) {
        return undefined;
      }
      functions.push({
        name: write,
        visibility: "private",
        selfParam: "ref",
        params: [{ name: "value", type: override.callableType }],
        body: {
          statements: [{
            kind: "expr",
            expr: writeRustProjectMethodOverride(
              { kind: "path", path: "self" },
              override.fieldName,
              { kind: "path", path: "value" },
            ),
          }],
        },
      });
    }
  }
  return {
    kind: "impl",
    trait,
    target: rootType,
    functions,
  };
}

function projectObjectLiteralReceiver(wrapperPath: string, selfPath: string): RustExpr {
  return {
    kind: "struct-literal",
    path: wrapperPath,
    fields: [{
      name: rustProjectObjectIdentityField,
      value: {
        kind: "method-call",
        receiver: {
          kind: "field",
          receiver: { kind: "path", path: selfPath },
          name: rustProjectObjectIdentityField,
        },
        method: "clone",
        args: [],
      },
    }, {
      name: rustProjectObjectDispatchField,
      value: {
        kind: "method-call",
        receiver: { kind: "path", path: selfPath },
        method: "clone",
        args: [],
      },
    }],
  };
}

export function allocateMemberFieldName(used: Set<string>, preferred: string): string {
  let suffix = 1;
  for (;;) {
    const candidate = suffix === 1 ? preferred : `${preferred}_${suffix}`;
    suffix += 1;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
