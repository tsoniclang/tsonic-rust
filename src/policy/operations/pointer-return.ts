import type { Node } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "../types/resolution.js";
import { resolveRustTargetTypeRef } from "../types/resolution.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  rustLocationTargetType,
  rustOptionTargetType,
  rustUndefinedTargetType,
} from "../../target-model/types/index.js";
import { resolveRustExactNullishValueCarrier } from "../types/resolution/target.js";

export interface RustPointerReturnContract {
  readonly returnCarrier: TargetTypeRef;
  readonly undefinedReturn: boolean;
  readonly fallthroughUndefined: boolean;
}

export function selectRustPointerReturnCarrier(
  declaration: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  return selectRustPointerReturnContract(declaration, context, options)?.returnCarrier;
}

export function selectRustPointerReturnContract(
  declaration: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): RustPointerReturnContract | undefined {
  const evidence = context.pointerReturns.resolve(declaration);
  if (evidence === undefined) {
    return undefined;
  }
  const pointees = evidence.pointees.map((value) => resolveRustTargetTypeRef(value.typeNode ?? value.type, {
    ...context,
    currentSourceFile: context.ast.getSourceFile(value.subject)!,
    currentSemantics: context.semanticsFor(value.subject),
  }, options));
  const first = pointees[0];
  if (first === undefined || pointees.some((type) =>
    type === undefined || !rustTargetTypeRefEquals(type, first))) {
    return undefined;
  }
  const nullish = evidence.nullishTypes.map((type) =>
    resolveRustExactNullishValueCarrier(type, context.semanticsFor(declaration)));
  if (nullish.some((type) => !rustTargetTypeRefEquals(type, rustUndefinedTargetType()))) {
    return undefined;
  }
  const carrier = rustLocationTargetType(first);
  return Object.freeze({
    returnCarrier: nullish.length === 0 ? carrier : rustOptionTargetType(carrier),
    undefinedReturn: nullish.length > 0,
    fallthroughUndefined: nullish.length > 0 && evidence.completion.canFallThrough,
  });
}
