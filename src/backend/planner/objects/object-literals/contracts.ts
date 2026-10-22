import { rustPackageFallibleBoundary, rustErrorType } from "../../program/fallible-boundaries.js";
import {
  readRustProjectObjectField,
  readRustProjectMethodOverride,
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  writeRustProjectObjectField,
  writeRustProjectMethodOverride,
} from "../project-objects.js";
import { applyRustCallableValueAdapter } from "../../declarations/callables/adapters.js";
import { planRustCallableArguments } from "../../declarations/callables/parameter-adapters.js";
import { projectOwnFields } from "../polymorphism/model.js";
import { rustProjectDispatchTraitType } from "../polymorphism/names.js";
import type { RustExpr, RustImplFunction, RustItem, RustStmt, RustType } from "../../../target-ast/syntax/nodes.js";
import type { RustObjectLiteralAccessorImplementationPlan, RustObjectLiteralImplementationPlan, RustObjectLiteralMethodDispatchPlan } from "./model.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustErrorBoundaryForProjectMember } from "../../program/plan-context.js";
import { applyRustFallibleResultExpression } from "../../types/fallible-shape.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import { rustSelfParameter } from "../../declarations/callables/self-parameter.js";
import { checkRustDataWrite } from "../data-writes.js";
import { planCheckedProjectProjectionImplementation } from "../checked-project-projections.js";

export function planContractImplementation(
  contract: import("../../../../target-model/types/project-types.js").RustProjectInstanceContract,
  rootType: RustType,
  wrapperType: RustType,
  contracts: readonly import("../../../../target-model/types/project-types.js").RustProjectInstanceContract[],
  stateFields: readonly RustObjectLiteralImplementationPlan["stateFields"][number][],
  accessors: readonly RustObjectLiteralAccessorImplementationPlan[],
  methods: readonly RustObjectLiteralMethodDispatchPlan[],
  context: RustPlanContext,
): RustItem | undefined {
  const trait = rustProjectDispatchTraitType(contract.carrier, context);
  const fields = projectOwnFields(contract.definition, contract.carrier, context);
  const representation = context.input.program.records.objectRepresentation.get(contract.definition);
  const selected = context.input.program.records.projectDispatchEmission.get(contract.definition);
  if (trait === undefined || fields === undefined || representation === undefined || selected === undefined ||
    wrapperType.kind !== "named") {
    failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
  }
  const functions: RustImplFunction[] = [];
  const projectionSlot = selected.projection?.slot;
  if (projectionSlot !== undefined) {
    const projection = planCheckedProjectProjectionImplementation(projectionSlot, contracts, [], context);
    if (projection === undefined) failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
    functions.push(projection);
  }
  for (const field of fields) {
    const chosen = selected.fields.get(field.declaration);
    const dispatch = chosen?.dispatch;
    const stateField = stateFields.find((candidate) =>
      candidate.contractDeclarations.includes(field.declaration));
    const accessor = accessors.find((candidate) =>
      candidate.contractDeclarations.includes(field.declaration));
    const read = chosen?.read;
    const write = chosen?.write;
    if (dispatch === undefined || (stateField === undefined) === (accessor === undefined) ||
      read === undefined || dispatch.write !== undefined && write === undefined) {
      failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
    }
    const fieldErrorBoundary = dispatch.read.fallible || dispatch.write?.fallible === true
      ? rustErrorBoundaryForProjectMember(field.declaration, context)
      : undefined;
    if ((dispatch.read.fallible || dispatch.write?.fallible === true) &&
      fieldErrorBoundary === undefined) {
      failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
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
          context,
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
      failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
    }
    functions.push({ kind: "function",
      name: read,
      visibility: "private",
      generics: emptyRustGenerics,
      selfParam: rustSelfParameter(dispatch.read.selfMode),
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
      let writeValue: RustExpr | undefined = stateField !== undefined
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
      const check = stateField === undefined ? undefined
        : context.input.program.records.frozenDataReceiver.get(field.declaration);
      if (writeValue !== undefined && check !== undefined) {
        if (fieldErrorBoundary === undefined) failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
        writeValue = checkRustDataWrite(check, { kind: "path", path: "self" }, writeValue, rustPackageFallibleBoundary(fieldErrorBoundary));
      }
      if (writeValue === undefined || !dispatch.write.fallible && accessor !== undefined) {
        failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
      }
      functions.push({ kind: "function",
        name: write!,
        visibility: "private",
        generics: emptyRustGenerics,
        selfParam: rustSelfParameter(dispatch.write.selfMode),
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
  for (const selectedMethod of selected.methods) {
      const contractMethod = selectedMethod.declaration;
      const variant = selectedMethod.variant;
      const method = methods.find((candidate) =>
        candidate.contractMethod === contractMethod &&
        candidate.variant.virtualSlot === variant.virtualSlot);
      if (method === undefined) {
        failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
      }
      if (wrapperType.kind !== "named") {
        failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
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
      const overrideStatements: readonly RustStmt[] = method.override === undefined
        ? []
        : [{ kind: "expr", expr: { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: overrideName }] }, expression: readRustProjectMethodOverride(
              { kind: "path", path: "self" },
              method.override.fieldName,
              representation,
            ), whenTrue: { kind: "block", body: {
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
            } } } }];
      const methodErrorBoundary = method.errorType === undefined
        ? undefined
        : rustErrorBoundaryForProjectMember(method.contractMethod, context);
      if (method.errorType !== undefined && methodErrorBoundary === undefined) {
        failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
      }
      const adapterContext: RustPlanContext = {
        ...context,
        fallibleBoundary: methodErrorBoundary === undefined ? undefined : rustPackageFallibleBoundary(methodErrorBoundary),
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
          failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
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
        functions.push({ kind: "function",
          name: variant.virtualSlot,
          visibility: "private",
          generics: emptyRustGenerics,
          selfParam: rustSelfParameter("rc"),
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
      const adapted = planRustCallableArguments({
        declaration: method.contractMethod,
        parameters: method.parameters,
        parameterAbis: method.adapter.parameterAbis,
        parameterAdapters: method.adapter.parameterAdapters,
      }, adapterContext);
      if (adapted === undefined) {
        failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
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
      const adaptedResult = applyRustCallableValueAdapter(
        invocation,
        method.adapter.resultAdapter,
        method.contractMethod,
        adapterContext,
      );
      if (adaptedResult === undefined) {
        failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
      }
      const result = method.errorType === undefined
        ? adaptedResult
        : applyRustFallibleResultExpression(adaptedResult, { errorType: method.errorType });
      functions.push({ kind: "function",
        name: variant.virtualSlot,
        visibility: "private",
        generics: emptyRustGenerics,
        selfParam: rustSelfParameter("rc"),
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
  for (const selectedWrite of selected.methodWrites) {
      const contractMethod = selectedWrite.property.declaration;
      const implementations = methods.filter((candidate) =>
        candidate.contractMethod === contractMethod);
      const override = implementations[0]?.override;
      const write = selectedWrite.slot;
      if (override === undefined || write === undefined ||
        implementations.some((candidate) => candidate.override !== override)) {
        failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
      }
      const replacement = writeRustProjectMethodOverride(
        { kind: "path", path: "self" },
        override.fieldName,
        { kind: "path", path: "value" },
        representation,
      );
      if (replacement === undefined) {
        failRustPlannerInvariant("An admitted native object literal requires its exact sealed contract implementation.", contract.definition.declaration);
      }
      functions.push({ kind: "function",
        name: write,
        visibility: "private",
        generics: emptyRustGenerics,
        selfParam: rustSelfParameter("ref"),
        params: [{ name: "value", type: override.callableType }],
        body: {
          statements: [{
            kind: "expr",
            expr: replacement,
          }],
        },
      });
  }
  return {
    kind: "impl",
    generics: emptyRustGenerics,
    trait,
    target: rootType,
    members: functions,
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
