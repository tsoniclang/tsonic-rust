import type {
  RustBound,
  RustCapturedGeneric,
  RustGenericArgument,
  RustGenericParameter,
  RustLifetimeRef,
  RustTraitRef,
  RustTypeRef,
} from "../../target-model/semantics/index.js";
import {
  rustLifetimeSemanticKey,
} from "../../target-model/semantics/index.js";

export type RustCallableLifetimeElisionResult =
  | {
      readonly kind: "resolved";
      readonly result: RustTypeRef;
    }
  | {
      readonly kind: "rejected";
      readonly reason: "no-input-lifetime" | "ambiguous-input-lifetime";
    };

export function resolveRustCallableLifetimeElision(options: {
  readonly parameters: readonly RustTypeRef[];
  readonly result: RustTypeRef;
  readonly receiverLifetime?: RustLifetimeRef;
}): RustCallableLifetimeElisionResult {
  const resultElisions = collectInferredLifetimes(options.result);
  if (resultElisions.size === 0) {
    return { kind: "resolved", result: options.result };
  }
  const inputLifetimes = new Map<string, RustLifetimeRef>();
  for (const parameter of options.parameters) {
    collectCallableInputLifetimes(parameter, inputLifetimes);
  }
  const selected = options.receiverLifetime ??
    (inputLifetimes.size === 1 ? inputLifetimes.values().next().value : undefined);
  if (selected === undefined) {
    return {
      kind: "rejected",
      reason: inputLifetimes.size === 0
        ? "no-input-lifetime"
        : "ambiguous-input-lifetime",
    };
  }
  return {
    kind: "resolved",
    result: replaceInferredLifetimes(
      options.result,
      new Map([...resultElisions].map((identity) => [identity, selected])),
    ),
  };
}

export type RustFunctionPointerLifetimeElisionResult =
  | {
      readonly kind: "resolved";
      readonly parameters: readonly RustTypeRef[];
      readonly result: RustTypeRef;
      readonly binder?: {
        readonly id: string;
        readonly lifetimes: readonly Extract<RustGenericParameter, { readonly kind: "lifetime" }>[];
      };
    }
  | {
      readonly kind: "rejected";
      readonly reason: "no-input-lifetime" | "ambiguous-input-lifetime";
    };

export function resolveRustFunctionPointerLifetimeElision(options: {
  readonly binderId: string;
  readonly parameters: readonly RustTypeRef[];
  readonly result: RustTypeRef;
}): RustFunctionPointerLifetimeElisionResult {
  const replacements = new Map<string, RustLifetimeRef>();
  for (const parameter of options.parameters) {
    for (const identity of collectInferredLifetimes(parameter)) {
      if (replacements.has(identity)) continue;
      const ordinal = replacements.size;
      replacements.set(identity, Object.freeze({
        kind: "bound" as const,
        binderId: options.binderId,
        parameterId: `elided-${ordinal}`,
        displayName: `elided${ordinal}`,
      }));
    }
  }
  const parameters = Object.freeze(options.parameters.map((parameter) =>
    replaceInferredLifetimes(parameter, replacements)));
  const resultElisions = collectInferredLifetimes(options.result);
  let result = options.result;
  if (resultElisions.size > 0) {
    const inputLifetimes = new Map<string, RustLifetimeRef>();
    for (const parameter of parameters) {
      collectCallableInputLifetimes(parameter, inputLifetimes);
    }
    const selected = inputLifetimes.size === 1
      ? inputLifetimes.values().next().value
      : undefined;
    if (selected === undefined) {
      return {
        kind: "rejected",
        reason: inputLifetimes.size === 0
          ? "no-input-lifetime"
          : "ambiguous-input-lifetime",
      };
    }
    result = replaceInferredLifetimes(
      result,
      new Map([...resultElisions].map((identity) => [identity, selected])),
    );
  }
  const lifetimes = Object.freeze([...replacements.values()].map((identity) =>
    Object.freeze({
      kind: "lifetime" as const,
      identity,
      bounds: Object.freeze([]),
    })));
  return {
    kind: "resolved",
    parameters,
    result,
    ...(lifetimes.length === 0
      ? {}
      : { binder: Object.freeze({ id: options.binderId, lifetimes }) }),
  };
}

function collectCallableInputLifetimes(
  type: RustTypeRef,
  selected: Map<string, RustLifetimeRef>,
): void {
  visitRustFreeLifetimes(type, (lifetime) => {
    selected.set(rustLifetimeSemanticKey(lifetime), lifetime);
  });
}

function collectInferredLifetimes(type: RustTypeRef): ReadonlySet<string> {
  const selected = new Set<string>();
  visitRustFreeLifetimes(type, (lifetime) => {
    if (lifetime.kind === "inferred-region") {
      selected.add(rustLifetimeSemanticKey(lifetime));
    }
  });
  return selected;
}

export function visitRustFreeLifetimes(
  type: RustTypeRef,
  visit: (lifetime: RustLifetimeRef) => void,
): void {
  const visitArgument = (argument: RustGenericArgument): void => {
    if (argument.kind === "lifetime") visit(argument.value);
    if (argument.kind === "type") visitRustFreeLifetimes(argument.value, visit);
  };
  const visitTrait = (trait: RustTraitRef): void => {
    trait.arguments.forEach(visitArgument);
    for (const constraint of trait.associatedConstraints) {
      constraint.arguments.forEach(visitArgument);
      if (constraint.kind === "equality") visitRustFreeLifetimes(constraint.type, visit);
      else constraint.bounds.forEach(visitBound);
    }
  };
  const visitBound = (bound: RustBound): void => {
    switch (bound.kind) {
      case "trait":
        visitTrait(bound.trait);
        return;
      case "lifetime-outlives":
        visit(bound.longer);
        visit(bound.shorter);
        return;
      case "type-outlives":
        visitRustFreeLifetimes(bound.type, visit);
        visit(bound.lifetime);
        return;
      case "associated-equality":
        visitRustFreeLifetimes(bound.projection, visit);
        visitRustFreeLifetimes(bound.value, visit);
        return;
    }
  };
  switch (type.kind) {
    case "tuple":
      type.elements.forEach((element) => visitRustFreeLifetimes(element, visit));
      return;
    case "array":
    case "sequence":
    case "slice":
      visitRustFreeLifetimes(type.element, visit);
      return;
    case "path":
      type.arguments.forEach(visitArgument);
      return;
    case "reference":
      visit(type.lifetime);
      visitRustFreeLifetimes(type.target, visit);
      return;
    case "raw-pointer":
      visitRustFreeLifetimes(type.target, visit);
      return;
    case "function-pointer":
      if (type.binder === undefined) {
        type.parameters.forEach((parameter) => visitRustFreeLifetimes(parameter, visit));
        visitRustFreeLifetimes(type.result, visit);
      }
      return;
    case "closure":
      type.parameters.forEach((parameter) => visitRustFreeLifetimes(parameter, visit));
      visitRustFreeLifetimes(type.result, visit);
      for (const capture of type.captures) {
        if (capture.kind === "lifetime") visit(capture.value);
      }
      return;
    case "trait-object":
      visitTrait(type.principal);
      type.autoTraits.forEach(visitTrait);
      visit(type.lifetime);
      return;
    case "opaque":
      type.bounds.forEach(visitBound);
      for (const capture of type.captures) {
        if (capture.kind === "lifetime") visit(capture.value);
      }
      return;
    case "associated-type":
      visitRustFreeLifetimes(type.owner, visit);
      visitTrait(type.trait);
      type.arguments.forEach(visitArgument);
      return;
    case "source-primitive":
    case "primitive":
    case "never":
    case "unit":
    case "str":
    case "self":
    case "type-parameter":
    case "inference-variable":
    case "source-carrier":
      return;
  }
}

function replaceInferredLifetimes(
  type: RustTypeRef,
  replacements: ReadonlyMap<string, RustLifetimeRef>,
): RustTypeRef {
  const lifetime = (value: RustLifetimeRef): RustLifetimeRef =>
    value.kind === "inferred-region"
      ? replacements.get(rustLifetimeSemanticKey(value)) ?? value
      : value;
  const argument = (value: RustGenericArgument): RustGenericArgument => {
    switch (value.kind) {
      case "lifetime": return Object.freeze({ ...value, value: lifetime(value.value) });
      case "type": return Object.freeze({ ...value, value: replaceInferredLifetimes(value.value, replacements) });
      case "const": return value;
    }
  };
  const capture = (value: RustCapturedGeneric): RustCapturedGeneric =>
    value.kind === "lifetime"
      ? Object.freeze({ ...value, value: lifetime(value.value) })
      : value;
  const trait = (value: RustTraitRef): RustTraitRef => Object.freeze({
    ...value,
    arguments: Object.freeze(value.arguments.map(argument)),
    associatedConstraints: Object.freeze(value.associatedConstraints.map((constraint) =>
      constraint.kind === "equality"
        ? Object.freeze({
            ...constraint,
            arguments: Object.freeze(constraint.arguments.map(argument)),
            type: replaceInferredLifetimes(constraint.type, replacements),
          })
        : Object.freeze({
            ...constraint,
            arguments: Object.freeze(constraint.arguments.map(argument)),
            bounds: Object.freeze(constraint.bounds.map(bound)),
          }))),
  });
  const bound = (value: RustBound): RustBound => {
    switch (value.kind) {
      case "trait": return Object.freeze({ ...value, trait: trait(value.trait) });
      case "lifetime-outlives": return Object.freeze({
        ...value,
        longer: lifetime(value.longer),
        shorter: lifetime(value.shorter),
      });
      case "type-outlives": return Object.freeze({
        ...value,
        type: replaceInferredLifetimes(value.type, replacements),
        lifetime: lifetime(value.lifetime),
      });
      case "associated-equality": return Object.freeze({
        ...value,
        projection: replaceInferredLifetimes(value.projection, replacements) as Extract<
          RustTypeRef,
          { readonly kind: "associated-type" }
        >,
        value: replaceInferredLifetimes(value.value, replacements),
      });
    }
  };
  switch (type.kind) {
    case "tuple": return Object.freeze({
      ...type,
      elements: Object.freeze(type.elements.map((element) =>
        replaceInferredLifetimes(element, replacements))),
    });
    case "array": return Object.freeze({
      ...type,
      element: replaceInferredLifetimes(type.element, replacements),
    });
    case "sequence":
    case "slice": return Object.freeze({
      ...type,
      element: replaceInferredLifetimes(type.element, replacements),
    });
    case "path": return Object.freeze({
      ...type,
      arguments: Object.freeze(type.arguments.map(argument)),
    });
    case "reference": return Object.freeze({
      ...type,
      lifetime: lifetime(type.lifetime),
      target: replaceInferredLifetimes(type.target, replacements),
    });
    case "raw-pointer": return Object.freeze({
      ...type,
      target: replaceInferredLifetimes(type.target, replacements),
    });
    case "function-pointer":
      if (type.binder !== undefined) return type;
      return Object.freeze({
        ...type,
        parameters: Object.freeze(type.parameters.map((parameter) =>
          replaceInferredLifetimes(parameter, replacements))),
        result: replaceInferredLifetimes(type.result, replacements),
      });
    case "closure": return Object.freeze({
      ...type,
      parameters: Object.freeze(type.parameters.map((parameter) =>
        replaceInferredLifetimes(parameter, replacements))),
      result: replaceInferredLifetimes(type.result, replacements),
      captures: Object.freeze(type.captures.map(capture)),
    });
    case "trait-object": return Object.freeze({
      ...type,
      principal: trait(type.principal),
      autoTraits: Object.freeze(type.autoTraits.map(trait)),
      lifetime: lifetime(type.lifetime),
    });
    case "opaque": return Object.freeze({
      ...type,
      bounds: Object.freeze(type.bounds.map(bound)),
      captures: Object.freeze(type.captures.map(capture)),
    });
    case "associated-type": return Object.freeze({
      ...type,
      owner: replaceInferredLifetimes(type.owner, replacements),
      trait: trait(type.trait),
      arguments: Object.freeze(type.arguments.map(argument)),
    });
    case "source-primitive":
    case "primitive":
    case "never":
    case "unit":
    case "str":
    case "self":
    case "type-parameter":
    case "inference-variable":
    case "source-carrier":
      return type;
  }
}
