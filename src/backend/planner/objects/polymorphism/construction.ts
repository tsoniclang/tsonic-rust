import type { Node } from "@tsonic/tsts";
import {
  KindCallExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import type {
  RustProjectConstructorSignature,
  RustProjectTypeDefinition,
} from "../../../../analysis/project-types/type-policy.js";
import { rustInheritedProjectConstructor } from "../../../../analysis/project-types/type-policy.js";
import {
  rustFallibleFactKey,
  rustSourceCallEffectsFactKey,
  rustSourceParameterAbiFactKey,
  rustTargetOperationFactKey,
} from "../../../../analysis/facts/keys.js";
import type {
  RustExpr,
  RustFunctionParam,
  RustImplFunction,
  RustStmt,
  RustType,
} from "../../../rust-ast/nodes.js";
import { rustLintAttributes } from "../../../rust-ast/lint-policy.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "../../diagnostics.js";
import {
  planExpression,
  planRustSelectedSourceCallArguments,
} from "../../expressions/index.js";
import {
  diagnosticInput,
  rustErrorBoundaryForDeclaration,
  rustErrorType,
} from "../../program/plan-context.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import {
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  rustProjectObjectStateField,
} from "../project-objects.js";
import {
  cloneExpression,
  type ProjectClassStateLayer,
  type ProjectFieldPlan,
  projectMembers,
  projectFieldStoragePath,
  projectStateType,
} from "./model.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import {
  planRustCallableParameterPrelude,
  planRustCallableParameters,
} from "../../declarations/callable-parameters.js";
import {
  isValidRustIdentifier,
} from "../../program/plan-context.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../../names/synthetic.js";
import {
  rustDeclarationRequiresUnsafe,
  rustSafetyAttributesForDeclaration,
} from "../../safety/explicit-safety.js";
import {
  prepareRustPreconstructionNode,
  rustNamedFieldPath,
  type RustPreconstructionFieldValue,
} from "../../declarations/preconstruction-fields.js";
import { planStatementSequence } from "../../statements/index.js";
import { applyFallibleShape } from "../../types/fallible-shape.js";
import { rustProjectStateMarker } from "./names.js";

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
  if (constructorSignatures.length === 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, definition.declaration),
      "rust.backend.project-constructor-overloads",
      "Project construction requires at least one exact effective constructor signature.",
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
  const safetyDeclaration = constructor ?? definition.declaration;
  const isUnsafe = rustDeclarationRequiresUnsafe(
    definition.declaration,
    "constructor",
    context.input,
    constructor,
  );
  const initializationSafetyAttributes = rustSafetyAttributesForDeclaration(
    safetyDeclaration,
    false,
    context.input,
  );
  const syntheticNames = createRustSyntheticNameState(
    context.input.ast,
    constructor ?? definition.declaration,
    [],
  );
  const baseStateName = allocateRustSyntheticName(syntheticNames, "base_state");
  const stateName = allocateRustSyntheticName(syntheticNames, "state");
  const identityName = allocateRustSyntheticName(syntheticNames, "identity");
  const rootName = allocateRustSyntheticName(syntheticNames, "root");
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
  const fallible = context.input.facts.getFact(
    constructor ?? definition.declaration,
    rustFallibleFactKey,
  ) !== undefined;
  const constructorErrorBoundary = fallible
    ? rustErrorBoundaryForDeclaration(constructor ?? definition.declaration, context)
    : undefined;
  if (fallible && constructorErrorBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, constructor ?? definition.declaration),
      "rust.backend.project-constructor-error-boundary",
      "A fallible project constructor has no exact source-package error boundary.",
    ));
    return undefined;
  }
  const constructorErrorType = constructorErrorBoundary === undefined
    ? undefined
    : rustErrorType(constructorErrorBoundary);
  if (fallible) {
    context.usedAliases?.add("rt");
  }
  const stateType = projectStateType(layers, context);
  if (stateType === undefined) {
    return undefined;
  }
  const initializationContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: stateType,
    ...(constructorErrorBoundary === undefined
      ? {}
      : { fallibleBoundary: constructorErrorBoundary }),
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
  const externalBase = context.input.projectTypes.externalBaseForDefinition(definition);
  const ownLayer = layers[layers.length - 1];
  if (ownLayer === undefined || ownLayer.definition !== definition ||
    (base !== undefined && externalBase !== undefined)) {
    return undefined;
  }
  const values = new Map<Node, RustExpr>();
  const fieldSlots: RustPreconstructionFieldValue[] = [];
  const availableFields: RustPreconstructionFieldValue[] = [];
  for (const field of ownLayer.fields) {
    const name = allocateRustSyntheticName(syntheticNames, `field_${field.sourceName}`);
    const expression: RustExpr = { kind: "path", path: name };
    const slot = {
      declaration: field.declaration,
      storageIndex: field.storageIndex,
      carrier: field.carrier,
      expression,
    };
    statements.push({
      kind: "let",
      name,
      mutable: true,
      type: field.type,
    });
    values.set(field.declaration, expression);
    fieldSlots.push(slot);
  }
  const bindInitializedField = (
    field: ProjectFieldPlan,
    value: RustExpr,
  ): void => {
    const slot = fieldSlots.find((candidate) => candidate.declaration === field.declaration);
    if (slot === undefined) {
      return;
    }
    statements.push({ kind: "assign", target: slot.expression, operator: "=", value });
    const existing = availableFields.findIndex((candidate) =>
      candidate.declaration === field.declaration);
    if (existing < 0) {
      availableFields.push(slot);
    } else {
      availableFields[existing] = slot;
    }
  };
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
    const inheritedBase = constructor === undefined
      ? rustInheritedProjectConstructor(
          context.input.projectTypes,
          definition,
          constructorSignature,
        )
      : undefined;
    const implicitBase = inheritedBase?.base === base.target
      ? inheritedBase.constructor
      : undefined;
    const baseConstructor = explicitBase?.constructor ?? implicitBase;
    if (baseConstructor === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, constructor ?? definition.declaration),
        "rust.backend.project-inherited-constructor",
        "Project construction does not identify one exact inherited base constructor ABI.",
      ));
      return undefined;
    }
    const baseArgs = explicitBase === undefined
      ? parameterPlan.params.map((parameter) => ({
          kind: "path" as const,
          path: parameter.name,
        }))
      : planRustSelectedSourceCallArguments(explicitBase.call, initializationContext);
    const baseType = rustTypeFromCarrierInContext(base.targetType, context);
    if (baseArgs === undefined || baseType === undefined) {
      return undefined;
    }
    let baseInitialization: RustExpr = {
      kind: "associated-call",
      owner: baseType,
      method: baseConstructor.initializeName,
      args: baseArgs,
    };
    const explicitBaseEffects = explicitBase === undefined
      ? undefined
      : context.input.facts.getFact(
          explicitBase.call,
          rustSourceCallEffectsFactKey,
        );
    if (explicitBase !== undefined &&
      (explicitBaseEffects === undefined || explicitBaseEffects.awaiting !== "not-applicable")) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, explicitBase.call),
        "rust.backend.project-base-constructor-effects",
        "An explicit project base constructor call has no exact finalized synchronous invocation effects.",
      ));
      return undefined;
    }
    const baseFallible = explicitBase === undefined
      ? context.input.facts.getFact(
          baseConstructor.declaration ?? base.target.declaration,
          rustFallibleFactKey,
        ) !== undefined
      : explicitBaseEffects!.invocation === "fallible";
    if (baseFallible && !fallible) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, constructor ?? definition.declaration),
        "rust.backend.project-constructor-fallibility",
        "A fallible selected base constructor conflicts with the finalized derived constructor ABI.",
      ));
      return undefined;
    }
    if (baseFallible) {
      const baseErrorBoundary = rustErrorBoundaryForDeclaration(
        baseConstructor.declaration ?? base.target.declaration,
        context,
      );
      if (baseErrorBoundary === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, constructor ?? definition.declaration),
          "rust.backend.project-base-constructor-error-boundary",
          "A fallible selected base constructor has no exact source-package error boundary.",
        ));
        return undefined;
      }
      baseInitialization = {
        kind: "try",
        expr: baseInitialization,
        resultErrorType: constructorErrorType!,
        operandErrorType: rustErrorType(baseErrorBoundary),
      };
    }
    statements.push({
      kind: "let",
      name: baseStateName,
      mutable: true,
      init: baseInitialization,
    });
    bodyIndex = constructor === undefined ? 0 : 1;
  } else if (externalBase !== undefined) {
    const externalCall = constructor === undefined
      ? undefined
      : selectedExplicitExternalBaseConstructor(
          constructor,
          bodyStatements as readonly Node[],
          externalBase.constructorOperationId,
          context,
        );
    const baseError = externalCall === undefined
      ? undefined
      : planExpression(externalCall, initializationContext);
    if (baseError === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, constructor ?? definition.declaration),
        "rust.backend.external-project-constructor",
        "An external source-profile base requires one exact checked super(...) call as the first constructor statement.",
      ));
      return undefined;
    }
    const baseName = allocateRustSyntheticName(syntheticNames, "external_base");
    statements.push({ kind: "let", name: baseName, mutable: false, init: baseError });
    const basePath: RustExpr = { kind: "path", path: baseName };
    for (const externalField of externalBase.fields) {
      const field = ownLayer.fields.find((candidate) =>
        candidate.origin === "external" &&
        candidate.declaration === externalField.declaration);
      if (field === undefined) {
        return undefined;
      }
      const value: RustExpr = externalField.initializer.kind === "none"
        ? { kind: "none" }
        : {
            kind: "method-call",
            receiver: {
              kind: "method-call",
              receiver: basePath,
              method: externalField.initializer.kind === "error-kind-string"
                ? "kind"
                : "message",
              args: [],
            },
            method: "to_string",
            args: [],
          };
      bindInitializedField(field, value);
    }
    bodyIndex = 1;
  }
  if (base !== undefined) {
    const baseLayers = layers.slice(0, -1);
    for (const layer of baseLayers) {
      for (const field of layer.fields) {
        const storagePath = projectFieldStoragePath(
          field.declaration,
          baseLayers,
          context,
        );
        if (storagePath === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, field.declaration),
            "rust.backend.preconstruction-base-field",
            "An initialized base field has no exact preconstruction storage path.",
          ));
          return undefined;
        }
        availableFields.push({
          declaration: field.declaration,
          storageIndex: field.storageIndex,
          carrier: field.carrier,
          expression: rustNamedFieldPath(
            { kind: "path", path: baseStateName },
            storagePath,
          ),
        });
      }
    }
  }
  const resolveSelectedFieldDeclaration = (selected: Node): Node | undefined => {
    if (availableFields.some((field) => field.declaration === selected) ||
      ownLayer.fields.some((field) => field.declaration === selected)) {
      return selected;
    }
    const resolved = context.input.projectTypes.memberImplementation(
      definition,
      selected,
    );
    return resolved.kind === "resolved"
      ? resolved.implementation.declaration
      : undefined;
  };
  const evaluateField = (field: ProjectFieldPlan, expression: Node): boolean => {
    const expressionContext = prepareRustPreconstructionNode(
      expression,
      availableFields,
      initializationContext,
      resolveSelectedFieldDeclaration,
    );
    if (expressionContext === undefined) {
      return false;
    }
    const value = planExpression(expression, expressionContext);
    if (value === undefined) {
      return false;
    }
    bindInitializedField(field, value);
    return true;
  };
  for (const field of ownLayer.fields) {
    if (field.initializer !== undefined && !evaluateField(field, field.initializer)) {
      return undefined;
    }
  }
  const constructorStatements = bodyStatements.slice(bodyIndex) as readonly Node[];
  if (body !== undefined && constructorStatements.length > 0) {
    const bodyFields = [...availableFields];
    for (const slot of fieldSlots) {
      if (!bodyFields.some((candidate) => candidate.declaration === slot.declaration)) {
        bodyFields.push(slot);
      }
    }
    let bodyContext = initializationContext;
    for (const statement of constructorStatements) {
      const prepared = prepareRustPreconstructionNode(
        statement,
        bodyFields,
        bodyContext,
        resolveSelectedFieldDeclaration,
      );
      if (prepared === undefined) {
        return undefined;
      }
      bodyContext = prepared;
    }
    const bodyPlan = planStatementSequence(constructorStatements, body, bodyContext);
    if (bodyPlan === undefined) {
      return undefined;
    }
    statements.push(...bodyPlan.statements);
  }
  const state: RustExpr = {
    kind: "struct-literal",
    path: definition.stateName,
    fields: [
      ...(base === undefined
        ? []
        : [{
            name: context.input.projectTypes.baseStateFieldName(definition),
            value: { kind: "path" as const, path: baseStateName },
          }]),
      ...ownLayer.fields.map((field) => ({
        name: field.targetName,
        value: values.get(field.declaration)!,
      })),
      ...ownLayer.methodProperties.map((property) => ({
        name: property.targetName,
        value: { kind: "none" as const },
      })),
      ...(() => {
        const marker = rustProjectStateMarker(definition, context);
        return marker === undefined ? [] : [{ name: marker.name, value: marker.value }];
      })(),
    ],
  };
  statements.push({ kind: "tail", expr: state });
  const initialize: RustImplFunction = {
    name: constructorSignature.initializeName,
    visibility: "crate",
    ...(initializationSafetyAttributes.length === 0
      ? {}
      : { attrs: initializationSafetyAttributes }),
    params: parameterPlan.params,
    ...(constructorErrorType === undefined ? {} : { errorType: constructorErrorType }),
    returnType: stateType,
    body: {
      ...applyFallibleShape(
        { statements },
        fallible
          ? { fallible: true, hasReturnValue: true, errorType: constructorErrorType! }
          : { fallible: false, hasReturnValue: true },
      ),
    },
  };
  const forwardArgs = parameterPlan.params.map((parameter) => ({
    kind: "path" as const,
    path: parameter.name,
  }));
  const construct: RustImplFunction = {
    name: constructorSignature.targetName,
    ...(isUnsafe ? { isUnsafe: true } : {}),
    visibility: constructor === undefined ||
        (!context.input.ast.hasModifierKind(constructor, "private") &&
          !context.input.ast.hasModifierKind(constructor, "protected"))
      ? "public"
      : "private",
    ...(() => {
      const attrs = [
        ...(isUnsafe ? [rustLintAttributes.missingSafetyDoc] : []),
        ...(context.input.ast.hasModifierKind(definition.declaration, "export")
          ? []
          : [rustLintAttributes.deadCode]),
      ];
      return attrs.length === 0 ? {} : { attrs };
    })(),
    params: parameterPlan.params,
    ...(constructorErrorType === undefined ? {} : { errorType: constructorErrorType }),
    returnType: wrapperType,
    body: applyFallibleShape({
      statements: [
        {
          kind: "let",
          name: stateName,
          mutable: false,
          init: fallible ? {
            kind: "try",
            resultErrorType: constructorErrorType!,
            operandErrorType: constructorErrorType!,
            expr: {
              kind: "associated-call",
              owner: wrapperType,
              method: constructorSignature.initializeName,
              args: forwardArgs,
            },
          } : {
            kind: "associated-call",
            owner: wrapperType,
            method: constructorSignature.initializeName,
            args: forwardArgs,
          },
        },
        {
          kind: "let",
          name: identityName,
          mutable: false,
          init: { kind: "call", path: "rt::ObjectIdentity::new", args: [] },
        },
        {
          kind: "let",
          name: rootName,
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
                  value: cloneExpression({ kind: "path", path: identityName }),
                },
                {
                  name: rustProjectObjectStateField,
                  value: {
                    kind: "call",
                    path: "rt::ObjectHandle::new",
                    args: [{ kind: "path", path: stateName }],
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
                value: { kind: "path", path: identityName },
              },
              {
                name: rustProjectObjectDispatchField,
                value: { kind: "path", path: rootName },
              },
            ],
          },
        },
      ],
    }, fallible
      ? { fallible: true, hasReturnValue: true, errorType: constructorErrorType! }
      : { fallible: false, hasReturnValue: true }),
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
    const name = context.input.names.nameForDeclaration(parameter.parameterDeclaration) ?? "";
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
  return { params, prelude: [] };
}

function selectedExplicitExternalBaseConstructor(
  constructor: Node,
  statements: readonly Node[],
  operationId: string,
  context: RustPlanContext,
): Node | undefined {
  const first = statements[0];
  const call = first === undefined ? undefined : Node_Expression(context.input.ast, first);
  const callee = call === undefined ? undefined : Node_Expression(context.input.ast, call);
  const fact = call === undefined
    ? undefined
    : context.input.facts.getFact(call, rustTargetOperationFactKey);
  if (call === undefined || context.input.ast.kindName(call) !== KindCallExpression ||
    callee === undefined || context.input.ast.kindName(callee) !== "KindSuperKeyword" ||
    fact?.kind !== "provider-operation" || fact.operationId !== operationId ||
    fact.abi.operationKind !== "constructor") {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, constructor),
      "rust.backend.external-project-super-constructor",
      "External project heritage requires the exact selected source-profile constructor as the first super(...) statement.",
    ));
    return undefined;
  }
  return call;
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
