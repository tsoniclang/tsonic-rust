import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import { rustSourceTypeCarrierValue } from "../../../../target-model/types/index.js";
import type {
  RustExpr,
  RustGenericArgument,
  RustGenerics,
  RustType,
} from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { sourceModuleItemPath } from "../../program/plan-context.js";
import {
  rustAstGenericArgumentFromSemanticInContext,
  rustAstGenericsFromSemanticInContext,
} from "../../types/render.js";

export function rustProjectDispatchTraitName(
  definition: RustProjectTypeDefinition,
): string {
  return definition.dispatchName;
}

export function rustProjectRootName(
  definition: RustProjectTypeDefinition,
): string {
  if (definition.rootName === undefined) {
    throw new Error("Rust project root names exist only for project classes.");
  }
  return definition.rootName;
}

export function rustProjectGenerics(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
): RustGenerics | undefined {
  const semantic = context.input.program.projectTypes.genericsForDefinition(definition);
  return semantic === undefined
    ? undefined
    : rustAstGenericsFromSemanticInContext(semantic, context);
}

export function rustProjectDispatchTraitType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustType | undefined {
  return rustProjectGeneratedType(carrier, context, rustProjectDispatchTraitName);
}

export function rustProjectRootType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustType | undefined {
  return rustProjectGeneratedType(carrier, context, rustProjectRootName);
}

export function rustProjectStateType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustType | undefined {
  return rustProjectGeneratedType(carrier, context, (definition) => definition.stateName);
}

export function rustProjectStateMarker(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
): {
  readonly name: string;
  readonly type: RustType;
  readonly value: RustExpr;
} | undefined {
  const semantic = context.input.program.projectTypes.genericsForDefinition(definition);
  const rendered = semantic === undefined ? undefined : rustProjectGenerics(definition, context);
  if (semantic === undefined || rendered === undefined) {
    return undefined;
  }
  const markerElements = rendered.parameters.flatMap((parameter): readonly RustType[] => {
    if (parameter.kind === "const") return [];
    if (parameter.kind === "lifetime") {
      return [{
        kind: "reference",
        lifetime: { kind: "named", name: parameter.name },
        mutable: false,
        referent: { kind: "unit" },
      }];
    }
    return [{ kind: "named", path: parameter.name }];
  });
  if (markerElements.length === 0) {
    return undefined;
  }
  return {
    name: context.input.program.projectTypes.stateMarkerFieldName(definition),
    type: {
      kind: "named",
      path: "std::marker::PhantomData",
      genericArguments: [{
        kind: "type",
        type: {
          kind: "tuple",
          elements: markerElements,
        },
      }],
    },
    value: { kind: "path", path: "std::marker::PhantomData" },
  };
}

function rustProjectGeneratedType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
  generatedName: (definition: RustProjectTypeDefinition) => string,
): RustType | undefined {
  const value = rustSourceTypeCarrierValue(carrier);
  const definition = context.input.program.projectTypes.definitionForCarrier(carrier);
  const path = value === undefined || definition === undefined
    ? undefined
    : sourceModuleItemPath(context, value.fileName, generatedName(definition));
  if (value === undefined || definition === undefined || path === undefined ||
    value.genericArguments.length !== definition.genericArguments.length) {
    return undefined;
  }
  const genericArguments = value.genericArguments.map((argument) =>
    rustAstGenericArgumentFromSemanticInContext(argument, context));
  if (genericArguments.some((argument) => argument === undefined)) {
    return undefined;
  }
  return {
    kind: "named",
    path,
    ...(genericArguments.length === 0
      ? {}
      : { genericArguments: genericArguments as readonly RustGenericArgument[] }),
  };
}
