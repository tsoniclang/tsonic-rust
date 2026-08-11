import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  KindCallExpression,
  KindEqualsToken,
  Node_Expression,
  Node_Name,
} from "../../common/source-ast.js";
import type { RustProjectTypeDefinition } from "../../source/rust-target-semantics/project-type-policy.js";
import type {
  RustExpr,
  RustImplFunction,
  RustStmt,
  RustType,
} from "../rust-ast/nodes.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "./diagnostics.js";
import {
  planExpression,
  planRustSelectedSourceCallArguments,
} from "./expressions.js";
import { diagnosticInput } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import {
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  rustProjectObjectStateField,
} from "./project-objects.js";
import {
  cloneExpression,
  type ProjectClassStateLayer,
  type ProjectFieldPlan,
  projectMembers,
  projectStateType,
  sourceSubtreeContainsThis,
} from "./project-polymorphism-model.js";
import { rustProjectInitializeMethod } from "./project-polymorphism-names.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import {
  planRustCallableParameterPrelude,
  planRustCallableParameters,
} from "./callable-parameters.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "./synthetic-names.js";

export function planProjectClassConstructor(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
  rootType: RustType,
  layers: readonly ProjectClassStateLayer[],
  context: RustPlanContext,
): { readonly initialize: RustImplFunction; readonly construct: RustImplFunction } | undefined {
  if (wrapperType.kind !== "named" || rootType.kind !== "named") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, definition.declaration),
      "rust.backend.project-constructor-named-types",
      "Project construction requires exact named wrapper and root carriers.",
    ));
    return undefined;
  }
  const members = projectMembers(definition, context);
  if (members === undefined) {
    return undefined;
  }
  const constructors = members.filter((member) => context.input.ast.kindName(member) === "KindConstructor");
  if (constructors.length > 1) {
    return undefined;
  }
  const constructor = constructors[0];
  const syntheticNames = createRustSyntheticNameState(
    context.input.ast,
    constructor ?? definition.declaration,
    [],
  );
  const parameterPlan = constructor === undefined
    ? { params: [], prelude: [], bodyInnerAttrs: [] }
    : planRustCallableParameters(constructor, context, syntheticNames, { requireStatic: false });
  if (parameterPlan === undefined) {
    return undefined;
  }
  const stateType = projectStateType(layers);
  const initializationContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: stateType,
  };
  const prelude = planRustCallableParameterPrelude(parameterPlan, initializationContext, planExpression);
  if (prelude === undefined) {
    return undefined;
  }
  const statements: RustStmt[] = [...prelude];
  const body = constructor === undefined ? undefined : context.input.ast.body(constructor);
  const bodyStatements = body === undefined ? [] : context.input.ast.statements(body);
  if (bodyStatements.some((statement) => statement === undefined)) {
    return undefined;
  }
  const base = context.input.projectTypes.heritageForDefinition(definition).find((edge) =>
    edge.kind === "extends" && edge.target.kind === "class");
  let bodyIndex = 0;
  if (base !== undefined) {
    const first = bodyStatements[0];
    const expression = first === undefined ? undefined : Node_Expression(context.input.ast, first);
    const callee = expression === undefined ? undefined : Node_Expression(context.input.ast, expression);
    if (constructor === undefined || expression === undefined ||
      context.input.ast.kindName(expression) !== KindCallExpression ||
      callee === undefined || context.input.ast.kindName(callee) !== "KindSuperKeyword") {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, constructor ?? definition.declaration),
        "rust.backend.project-super-constructor",
        "Derived project construction requires one explicit, checked super(...) call as its first constructor statement.",
      ));
      return undefined;
    }
    const baseArgs = planRustSelectedSourceCallArguments(expression, initializationContext);
    const baseType = rustTypeFromCarrierInContext(base.targetType, context);
    if (baseArgs === undefined || baseType === undefined) {
      return undefined;
    }
    statements.push({
      kind: "let",
      name: "__tsonic_base_state",
      mutable: false,
      init: {
        kind: "associated-call",
        owner: baseType,
        method: rustProjectInitializeMethod,
        args: baseArgs,
      },
    });
    bodyIndex = 1;
  }
  const ownLayer = layers[layers.length - 1];
  if (ownLayer === undefined || ownLayer.definition !== definition) {
    return undefined;
  }
  const values = new Map<Node, RustExpr>();
  const evaluateField = (field: ProjectFieldPlan, expression: Node): boolean => {
    if (sourceSubtreeContainsThis(expression, context)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, expression),
        "rust.backend.class-field-initializer",
        "Class field initialization cannot read this before the reference-backed Rust object exists.",
      ));
      return false;
    }
    const value = planExpression(expression, initializationContext);
    if (value === undefined) {
      return false;
    }
    const name = allocateRustSyntheticName(syntheticNames, `field_${field.sourceName}`);
    statements.push({ kind: "let", name, mutable: false, init: value });
    values.set(field.declaration, { kind: "path", path: name });
    return true;
  };
  for (const field of ownLayer.fields) {
    if (field.initializer !== undefined && !evaluateField(field, field.initializer)) {
      return undefined;
    }
  }
  for (const statement of bodyStatements.slice(bodyIndex) as readonly Node[]) {
    const expression = Node_Expression(context.input.ast, statement);
    const operator = expression === undefined
      ? undefined
      : BinaryExpression_OperatorToken(context.input.ast, expression);
    const left = expression === undefined ? undefined : BinaryExpression_Left(context.input.ast, expression);
    const right = expression === undefined ? undefined : BinaryExpression_Right(context.input.ast, expression);
    const receiver = left === undefined ? undefined : Node_Expression(context.input.ast, left);
    const name = left === undefined ? undefined : Node_Name(context.input.ast, left);
    const field = ownLayer.fields.find((candidate) =>
      name !== undefined && candidate.sourceName === context.input.ast.text(name));
    if (expression === undefined || operator === undefined ||
      context.input.ast.kindName(operator) !== KindEqualsToken ||
      left === undefined || context.input.ast.kindName(left) !== "KindPropertyAccessExpression" ||
      receiver === undefined ||
      (context.input.ast.kindName(receiver) !== "KindThisExpression" &&
        context.input.ast.kindName(receiver) !== "KindThisKeyword") ||
      right === undefined || field === undefined || !evaluateField(field, right)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, statement),
        "rust.backend.project-constructor-body",
        "Project constructors require a checked super(...) followed by total initialization of their own fields.",
      ));
      return undefined;
    }
  }
  if (values.size !== ownLayer.fields.length) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, constructor ?? definition.declaration),
      "rust.backend.project-constructor-initialization",
      "Project construction must initialize every own field exactly once.",
    ));
    return undefined;
  }
  const ownState: RustExpr = {
    kind: "tuple-literal",
    elements: ownLayer.fields.map((field) => values.get(field.declaration)!),
  };
  const state: RustExpr = base === undefined
    ? ownState
    : {
        kind: "tuple-literal",
        elements: [{ kind: "path", path: "__tsonic_base_state" }, ownState],
      };
  statements.push({ kind: "tail", expr: state });
  const initialize: RustImplFunction = {
    name: rustProjectInitializeMethod,
    visibility: "crate",
    params: parameterPlan.params,
    returnType: stateType,
    body: {
      ...(parameterPlan.bodyInnerAttrs.length === 0 ? {} : { innerAttrs: parameterPlan.bodyInnerAttrs }),
      statements,
    },
  };
  const forwardArgs = parameterPlan.params.map((parameter) => ({
    kind: "path" as const,
    path: parameter.name,
  }));
  const construct: RustImplFunction = {
    name: "new",
    visibility: constructor === undefined ||
        (!context.input.ast.hasModifierKind(constructor, "private") &&
          !context.input.ast.hasModifierKind(constructor, "protected"))
      ? "public"
      : "private",
    ...(() => {
      const attrs = [
        ...(parameterPlan.params.length === 0 ? ["#[allow(clippy::new_without_default)]"] : []),
        ...(context.input.ast.hasModifierKind(definition.declaration, "export")
          ? []
          : ["#[allow(dead_code)]"]),
      ];
      return attrs.length === 0 ? {} : { attrs };
    })(),
    params: parameterPlan.params,
    returnType: wrapperType,
    body: {
      statements: [
        {
          kind: "let",
          name: "__tsonic_state",
          mutable: false,
          init: {
            kind: "associated-call",
            owner: wrapperType,
            method: rustProjectInitializeMethod,
            args: forwardArgs,
          },
        },
        {
          kind: "let",
          name: "__tsonic_identity",
          mutable: false,
          init: { kind: "call", path: "rt::ObjectIdentity::new", args: [] },
        },
        {
          kind: "let",
          name: "__tsonic_root",
          mutable: false,
          init: {
            kind: "call",
            path: "std::rc::Rc::new",
            args: [{
              kind: "struct-literal",
              path: rootType.path,
              fields: [
                {
                  name: rustProjectObjectIdentityField,
                  value: cloneExpression({ kind: "path", path: "__tsonic_identity" }),
                },
                {
                  name: rustProjectObjectStateField,
                  value: {
                    kind: "call",
                    path: "rt::ObjectHandle::new",
                    args: [{ kind: "path", path: "__tsonic_state" }],
                  },
                },
              ],
            }],
          },
        },
        {
          kind: "tail",
          expr: {
            kind: "struct-literal",
            path: wrapperType.path,
            fields: [
              {
                name: rustProjectObjectIdentityField,
                value: { kind: "path", path: "__tsonic_identity" },
              },
              {
                name: rustProjectObjectDispatchField,
                value: { kind: "path", path: "__tsonic_root" },
              },
            ],
          },
        },
      ],
    },
  };
  return { initialize, construct };
}
