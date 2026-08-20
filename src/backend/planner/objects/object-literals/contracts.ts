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
import { planProjectDowncastRouteImplementation } from "../polymorphism/forwarders.js";
import { rustProjectDispatchTraitType } from "../polymorphism/names.js";
import type {
  RustExpr,
  RustImplFunction,
  RustItem,
  RustType,
} from "../../../rust-ast/nodes.js";
import type { RustObjectLiteralAccessorImplementationPlan, RustObjectLiteralImplementationPlan, RustObjectLiteralMethodDispatchPlan } from "./model.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import {
  rustErrorBoundaryForProjectMember,
  rustErrorType,
} from "../../program/plan-context.js";
import { applyRustFallibleResultExpression } from "../../types/fallible-shape.js";
import { rustTypeEquals } from "../../../rust-ast/type-equality.js";

export function planContractImplementation(
  contract: import("../../../../analysis/project-types/type-policy.js").RustProjectInterfaceContract,
  rootType: RustType,
  wrapperType: RustType,
  stateFields: readonly RustObjectLiteralImplementationPlan["stateFields"][number][],
  accessors: readonly RustObjectLiteralAccessorImplementationPlan[],
  methods: readonly RustObjectLiteralMethodDispatchPlan[],
  context: RustPlanContext,
): RustItem | undefined {
  const trait = rustProjectDispatchTraitType(contract.carrier, context);
  const fields = projectOwnFields(contract.definition, contract.carrier, context);
  const representation = context.input.objectRepresentations.representationFor(
    contract.definition,
  );
  if (trait === undefined || fields === undefined || representation === undefined ||
    wrapperType.kind !== "named") {
    return undefined;
  }
  const functions: RustImplFunction[] = [];
  for (const route of context.input.projectTypes.downcastRoutesFor(contract.definition)) {
    const implementation = planProjectDowncastRouteImplementation(route, false, context);
    if (implementation === undefined) {
      return undefined;
    }
    functions.push(implementation);
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
    const fieldErrorBoundary = dispatch.read.fallible || dispatch.write?.fallible === true
      ? rustErrorBoundaryForProjectMember(field.declaration, context)
      : undefined;
    if ((dispatch.read.fallible || dispatch.write?.fallible === true) &&
      fieldErrorBoundary === undefined) {
      return undefined;
    }
    const fieldErrorType = fieldErrorBoundary === undefined
      ? undefined
      : rustErrorType(fieldErrorBoundary);
    const readValue: RustExpr = stateField !== undefined
      ? readRustProjectObjectField(
          { kind: "path", path: "self" },
          stateField.targetName,
          field.carrier,
          representation,
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
      ...(dispatch.read.fallible ? { errorType: fieldErrorType! } : {}),
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
            representation,
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
        ...(dispatch.write.fallible ? { errorType: fieldErrorType! } : {}),
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
              representation,
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
      const methodErrorBoundary = method.errorType === undefined
        ? undefined
        : rustErrorBoundaryForProjectMember(method.contractMethod, context);
      if (method.errorType !== undefined &&
        (methodErrorBoundary === undefined ||
          !rustTypeEquals(rustErrorType(methodErrorBoundary), method.errorType))) {
        return undefined;
      }
      const adapterContext: RustPlanContext = {
        ...context,
        fallibleBoundary: methodErrorBoundary,
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
        if (method.errorType === undefined && method.implementation.errorType !== undefined) {
          return undefined;
        }
        const result = method.errorType === undefined
          ? invocation
          : applyRustFallibleResultExpression(
              method.implementation.errorType === undefined
                ? invocation
                : {
                    kind: "try",
                    expr: invocation,
                    resultErrorType: method.errorType,
                    operandErrorType: method.implementation.errorType,
                  },
              { errorType: method.errorType },
            );
        functions.push({
          name: variant.virtualSlot,
          visibility: "private",
          selfParam: "rc",
          params: method.parameters,
          ...(method.returnType === undefined ? {} : { returnType: method.returnType }),
          ...(method.errorType === undefined ? {} : { errorType: method.errorType }),
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
              expr: result,
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
      if (method.implementation.errorType !== undefined) {
        invocation = {
          kind: "try",
          expr: invocation,
          resultErrorType: method.errorType!,
          operandErrorType: method.implementation.errorType,
        };
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
      const result = method.errorType === undefined
        ? adaptedResult
        : applyRustFallibleResultExpression(adaptedResult, { errorType: method.errorType });
      functions.push({
        name: variant.virtualSlot,
        visibility: "private",
        selfParam: "rc",
        params: method.parameters,
        ...(method.returnType === undefined ? {} : { returnType: method.returnType }),
        ...(method.errorType === undefined ? {} : { errorType: method.errorType }),
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
      const replacement = writeRustProjectMethodOverride(
        { kind: "path", path: "self" },
        override.fieldName,
        { kind: "path", path: "value" },
        representation,
      );
      if (replacement === undefined) {
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
            expr: replacement,
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
