import type { RustCompilerFunction, RustCompilerTraitDispatch, RustCompilerType } from "../model/model.js";
import type { ProjectionContext } from "./model.js";

export interface RustCompilerCallableSignature {
  readonly callTrait: "Fn" | "FnMut" | "FnOnce";
  readonly parameters: readonly RustCompilerType[];
  readonly result: RustCompilerType;
}

export function isCompilerCallableTrait(trait: RustCompilerTraitDispatch): boolean {
  const path = trait.identity.canonicalPath;
  return path.length === 4 && path[0] === "core" && path[1] === "ops" && path[2] === "function" &&
    ["Fn", "FnMut", "FnOnce"].includes(path[3]!) && trait.lifetimeBinder === undefined;
}

export function compilerCallableSignature(trait: RustCompilerTraitDispatch): RustCompilerCallableSignature | undefined {
  if (!isCompilerCallableTrait(trait)) return undefined;
  const inputs = trait.genericArguments[0];
  const output = trait.associatedConstraints[0];
  return trait.genericArguments.length === 1 && inputs?.kind === "type" && inputs.type.kind === "tuple" &&
      trait.associatedConstraints.length === 1 && output?.kind === "equality" &&
      output.name === "Output" && output.genericArguments.length === 0
    ? Object.freeze({ callTrait: trait.identity.canonicalPath[3] as RustCompilerCallableSignature["callTrait"],
        parameters: inputs.type.elements, result: output.type }) : undefined;
}

export function withCallableGenericProjections(fn: RustCompilerFunction, context: ProjectionContext): ProjectionContext {
  const callables = new Map(context.callableGenerics);
  for (const parameter of fn.genericParameters) {
    if (parameter.kind !== "type" || parameter.requirements.length !== 1 || parameter.outlives.length !== 0 ||
      parameter.maybeSized) continue;
    const requirement = parameter.requirements[0];
    const signature = typeof requirement === "object" ? compilerCallableSignature(requirement.trait) : undefined;
    if (signature !== undefined) callables.set(parameter.identity.itemId, signature);
  }
  return callables.size === 0 ? context : Object.freeze({ ...context, callableGenerics: callables });
}
