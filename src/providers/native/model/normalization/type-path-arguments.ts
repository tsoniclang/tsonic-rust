import { isRecord, requireArray, requireRecord, requireString } from "../rustdoc-schema.js";
import { childNormalizationContext, rustCompilerDerivedIdentity } from "./context.js";
import { normalizeLifetimeBinder, normalizeTraitDispatch } from "./type-generics.js";
import { normalizeConstArgument, normalizeLifetime } from "./scalar-arguments.js";
import { normalizeType } from "./types.js";
import type { RustCompilerAssociatedConstraint, RustCompilerGenericArgument, RustCompilerItemIdentity, RustCompilerLifetime, RustCompilerTraitDispatch, RustCompilerType } from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { RustCompilerNormalizationContext } from "./context.js";

export interface NormalizedRustCompilerPathArguments {
  readonly genericArguments: readonly RustCompilerGenericArgument[];
  readonly associatedConstraints: readonly RustCompilerAssociatedConstraint[];
}

export function normalizePathArguments(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
  associatedOwner?: RustCompilerItemIdentity,
): NormalizedRustCompilerPathArguments {
  if (raw === null || raw === undefined) {
    return Object.freeze({
      genericArguments: Object.freeze([]),
      associatedConstraints: Object.freeze([]),
    });
  }
  const args = requireRecord(raw, "Rust path arguments");
  if (isRecord(args.parenthesized)) {
    if (associatedOwner === undefined) {
      throw new Error("Rust parenthesized path arguments require one exact trait identity.");
    }
    const parenthesized = args.parenthesized;
    const parameters = requireArray(parenthesized.inputs, "Rust parenthesized path inputs")
      .map((input, index) => normalizeType(
        document,
        input,
        childNormalizationContext(context, `parenthesized:input:${index}`),
      ));
    const input: RustCompilerType = parameters.length === 0
      ? Object.freeze({ kind: "unit" })
      : Object.freeze({ kind: "tuple", elements: Object.freeze(parameters) });
    const result: RustCompilerType = parenthesized.output === null
      ? Object.freeze({ kind: "unit" })
      : normalizeType(
          document,
          parenthesized.output,
          childNormalizationContext(context, "parenthesized:output"),
        );
    return Object.freeze({
      genericArguments: Object.freeze([
        Object.freeze({ kind: "type" as const, type: input }),
      ]),
      associatedConstraints: Object.freeze([Object.freeze({
        kind: "equality" as const,
        identity: rustCompilerDerivedIdentity(associatedOwner, "associated:Output"),
        name: "Output",
        genericArguments: Object.freeze([]),
        type: result,
      })]),
    });
  }
  const angle = requireRecord(args.angle_bracketed, "Rust angle-bracketed path arguments");
  const genericArguments = requireArray(angle.args, "Rust path generic arguments")
    .map((rawArgument, index): RustCompilerGenericArgument => {
      const argument = requireRecord(rawArgument, `Rust path generic argument ${index}`);
      if (argument.lifetime !== undefined) {
        return Object.freeze({
          kind: "lifetime",
          lifetime: normalizeLifetime(argument.lifetime, context, `${context.position}/argument:${index}`),
        });
      }
      if (argument.type !== undefined) {
        return Object.freeze({
          kind: "type",
          type: normalizeType(
            document,
            argument.type,
            childNormalizationContext(context, `argument:${index}:type`),
          ),
        });
      }
      if (argument.const !== undefined) {
        return Object.freeze({
          kind: "const",
          value: normalizeConstArgument(argument.const, context, `argument:${index}:const`),
        });
      }
      throw new Error(`Rust path generic argument ${index} has no exact lifetime, type, or const kind.`);
    });
  const rawConstraints = requireArray(angle.constraints, "Rust path associated constraints");
  if (rawConstraints.length !== 0 && associatedOwner === undefined) {
    throw new Error("Rust associated constraints have no exact owning trait identity.");
  }
  const associatedConstraints = rawConstraints.map((constraint, index) => normalizeAssociatedConstraint(
    document,
    constraint,
    associatedOwner!,
    childNormalizationContext(context, `constraint:${index}`),
  ));
  return Object.freeze({
    genericArguments: Object.freeze(genericArguments),
    associatedConstraints: Object.freeze(associatedConstraints),
  });
}

function normalizeAssociatedConstraint(
  document: RustdocDocument,
  raw: unknown,
  owner: RustCompilerItemIdentity,
  context: RustCompilerNormalizationContext,
): RustCompilerAssociatedConstraint {
  const constraint = requireRecord(raw, "Rust associated constraint");
  const name = requireString(constraint.name, "Rust associated constraint name");
  const selected = normalizePathArguments(
    document,
    constraint.args,
    childNormalizationContext(context, "arguments"),
  );
  if (selected.associatedConstraints.length !== 0) {
    throw new Error("Rust associated constraint arguments cannot contain nested constraints.");
  }
  const identity = rustCompilerDerivedIdentity(owner, `associated:${name}`);
  const binding = requireRecord(constraint.binding, `Rust associated constraint '${name}' binding`);
  if (isRecord(binding.equality)) {
    return Object.freeze({
      kind: "equality",
      identity,
      name,
      genericArguments: selected.genericArguments,
      type: normalizeType(
        document,
        binding.equality.type,
        childNormalizationContext(context, "equality"),
      ),
    });
  }
  const rawBounds = requireArray(binding.constraint, `Rust associated constraint '${name}' bounds`);
  const traits: RustCompilerTraitDispatch[] = [];
  const outlives: RustCompilerLifetime[] = [];
  for (const [index, rawBound] of rawBounds.entries()) {
    const bound = requireRecord(rawBound, `Rust associated constraint '${name}' bound ${index}`);
    if (bound.outlives !== undefined) {
      outlives.push(normalizeLifetime(
        bound.outlives,
        context,
        `${context.position}/outlives:${index}`,
      ));
      continue;
    }
    const traitBound = requireRecord(
      bound.trait_bound,
      `Rust associated constraint '${name}' trait bound ${index}`,
    );
    if (traitBound.modifier !== "none" && traitBound.modifier !== "maybe_const") {
      throw new Error(`Rust associated constraint '${name}' has unsupported trait modifier '${String(traitBound.modifier)}'.`);
    }
    const binder = normalizeLifetimeBinder(
      traitBound.generic_params,
      childNormalizationContext(context, `bound:${index}`),
      `associated-bound:${index}`,
    );
    const trait = normalizeTraitDispatch(document, traitBound.trait, binder.context);
    traits.push(Object.freeze({
      ...trait,
      ...(binder.binder === undefined ? {} : { lifetimeBinder: binder.binder }),
    }));
  }
  return Object.freeze({
    kind: "bounds",
    identity,
    name,
    genericArguments: selected.genericArguments,
    traits: Object.freeze(traits),
    outlives: Object.freeze(outlives),
  });
}
