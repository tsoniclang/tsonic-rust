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
import type {
  RustProjectConstructorSignature,
  RustProjectTypeDefinition,
} from "../../source/rust-target-semantics/project-type-policy.js";
import {
  rustSourceParameterAbiFactKey,
  rustTargetOperationFactKey,
} from "../../source/rust-facts/keys.js";
import type {
  RustExpr,
  RustFunctionParam,
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
import { rustTypeFromCarrierInContext } from "./render-types.js";
import {
  planRustCallableParameterPrelude,
  planRustCallableParameters,
} from "./callable-parameters.js";
import {
  isValidRustIdentifier,
  rustSourceName,
} from "./plan-context.js";
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
  const constructorSignatures = context.input.projectTypes.constructorsForDefinition(definition);
  if (constructorSignatures.length !== 1) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, definition.declaration),
      "rust.backend.project-constructor-overloads",
      "Project construction currently requires one exact effective constructor signature.",
    ));
    return undefined;
  }
  const constructorSignature = constructorSignatures[0]!;
  const implementationConstructors = constructors.filter((candidate) =>
    context.input.ast.body(candidate) !== undefined);
  const constructor = implementationConstructors[0];
  if (implementationConstructors.length > 1 ||
    constructorSignature.implicit !== (constructor === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, definition.declaration),
      "rust.backend.project-constructor-implementation",
      "Effective project constructor evidence conflicts with the exact authored constructor implementation.",
    ));
    return undefined;
  }
  const syntheticNames = createRustSyntheticNameState(
    context.input.ast,
    constructor ?? definition.declaration,
    [],
  );
  const parameterPlan = constructor === undefined
    ? planImplicitProjectConstructorParameters(
        definition,
        constructorSignature,
        context,
      )
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
    const explicitBase = constructor === undefined
      ? undefined
      : selectedExplicitBaseConstructor(
          constructor,
          bodyStatements as readonly Node[],
          base.target,
          context,
        );
    const implicitBase = constructor === undefined
      ? selectedImplicitBaseConstructor(
          constructorSignature,
          base.target,
          context,
        )
      : undefined;
    const baseConstructor = explicitBase?.constructor ?? implicitBase;
    const baseArgs = explicitBase === undefined
      ? parameterPlan.params.map((parameter) => ({
          kind: "path" as const,
          path: parameter.name,
        }))
      : planRustSelectedSourceCallArguments(explicitBase.call, initializationContext);
    const baseType = rustTypeFromCarrierInContext(base.targetType, context);
    if (baseConstructor === undefined || baseArgs === undefined || baseType === undefined) {
      return undefined;
    }
    statements.push({
      kind: "let",
      name: "__tsonic_base_state",
      mutable: false,
      init: {
        kind: "associated-call",
        owner: baseType,
        method: baseConstructor.initializeName,
        args: baseArgs,
      },
    });
    bodyIndex = constructor === undefined ? 0 : 1;
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
    name: constructorSignature.initializeName,
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
    name: constructorSignature.targetName,
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
            method: constructorSignature.initializeName,
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

function planImplicitProjectConstructorParameters(
  definition: RustProjectTypeDefinition,
  signature: RustProjectConstructorSignature,
  context: RustPlanContext,
): {
  readonly params: readonly RustFunctionParam[];
  readonly prelude: readonly never[];
  readonly bodyInnerAttrs: readonly never[];
} | undefined {
  const receiver = context.input.projectTypes.openCarrier(definition);
  const params: RustFunctionParam[] = [];
  for (const parameter of signature.parameters) {
    const abi = context.input.facts.getFact(
      parameter.parameterDeclaration,
      rustSourceParameterAbiFactKey,
    );
    const carrier = abi === undefined
      ? undefined
      : context.input.projectTypes.instantiateMemberCarrier(
          parameter.parameterDeclaration,
          receiver,
          abi.parameterCarrier,
        );
    const type = rustTypeFromCarrierInContext(carrier, context);
    const name = rustSourceName(context, parameter.parameterName);
    if (type === undefined || !isValidRustIdentifier(name)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter.parameterDeclaration),
        "rust.backend.project-implicit-constructor-parameter",
        "An inherited effective constructor parameter has no exact instantiated Rust ABI.",
      ));
      return undefined;
    }
    params.push({ name, type, mutable: false });
  }
  return { params, prelude: [], bodyInnerAttrs: [] };
}

function selectedImplicitBaseConstructor(
  derived: RustProjectConstructorSignature,
  base: RustProjectTypeDefinition,
  context: RustPlanContext,
): RustProjectConstructorSignature | undefined {
  const matches = context.input.projectTypes.constructorsForDefinition(base).filter((candidate) =>
    candidate.parameters.length === derived.parameters.length &&
    candidate.parameters.every((parameter, index) => {
      const selected = derived.parameters[index];
      return selected !== undefined &&
        parameter.parameterDeclaration === selected.parameterDeclaration &&
        parameter.acceptsOmission === selected.acceptsOmission &&
        parameter.rest === selected.rest;
    }));
  if (matches.length !== 1) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, base.declaration),
      "rust.backend.project-inherited-constructor",
      "An implicit derived constructor does not identify one exact inherited base constructor ABI.",
    ));
    return undefined;
  }
  return matches[0];
}

function selectedExplicitBaseConstructor(
  constructor: Node,
  statements: readonly Node[],
  base: RustProjectTypeDefinition,
  context: RustPlanContext,
): { readonly call: Node; readonly constructor: RustProjectConstructorSignature } | undefined {
  const first = statements[0];
  const call = first === undefined ? undefined : Node_Expression(context.input.ast, first);
  const callee = call === undefined ? undefined : Node_Expression(context.input.ast, call);
  const fact = call === undefined
    ? undefined
    : context.input.facts.getFact(call, rustTargetOperationFactKey);
  const selected = fact?.kind === "source-call" && fact.target.form === "constructor"
    ? context.input.projectTypes.constructorForTargetName(base, fact.target.name)
    : undefined;
  if (call === undefined || context.input.ast.kindName(call) !== KindCallExpression ||
    callee === undefined || context.input.ast.kindName(callee) !== "KindSuperKeyword" ||
    selected === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, constructor),
      "rust.backend.project-super-constructor",
      "Derived project construction requires one exact checked super(...) constructor call as its first statement.",
    ));
    return undefined;
  }
  return { call, constructor: selected };
}
