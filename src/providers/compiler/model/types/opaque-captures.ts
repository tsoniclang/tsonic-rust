import { compareText } from "../rustdoc-schema.js";
import type {
  RustCompilerBound,
  RustCompilerGenericArgument,
} from "../model.js";
import { visitRustCompilerBoundReferences } from "../references.js";
import {
  normalizeCompilerLifetime,
  type RustCompilerNormalizationContext,
} from "./normalization-context.js";

export function normalizeRustCompilerCapture(
  raw: unknown,
  context: RustCompilerNormalizationContext,
  position: string,
): RustCompilerGenericArgument {
  if (typeof raw !== "string") {
    throw new Error(`Rust precise capture ${position} has no stable representation.`);
  }
  if (raw.startsWith("'")) {
    const value = normalizeCompilerLifetime(raw, context, position);
    if (value.kind !== "parameter" && value.kind !== "elided") {
      throw new Error(`Rust precise capture '${raw}' is not an in-scope lifetime parameter.`);
    }
    return Object.freeze({ kind: "lifetime", value });
  }
  if (raw === "Self") {
    if (context.selfType?.kind !== "self") {
      throw new Error("Rust precise Self capture is not owned by an exact trait declaration.");
    }
    return Object.freeze({ kind: "type", value: context.selfType });
  }
  const parameter = context.parameters?.get(raw);
  if (parameter?.kind === "type") {
    return Object.freeze({
      kind: "type",
      value: Object.freeze({
        kind: "type-parameter",
        identity: parameter.identity,
        displayName: parameter.displayName,
      }),
    });
  }
  if (parameter?.kind === "const") {
    return Object.freeze({
      kind: "const",
      value: Object.freeze({
        kind: "parameter",
        identity: parameter.identity,
        displayName: parameter.displayName,
      }),
    });
  }
  throw new Error(`Rust precise capture '${raw}' has no declaration-backed identity.`);
}

export function rustCompilerCaptureIdentityKey(
  capture: RustCompilerGenericArgument,
): string {
  switch (capture.kind) {
    case "lifetime": {
      const lifetime = capture.value;
      switch (lifetime.kind) {
        case "static": return "lifetime:static";
        case "parameter": return `lifetime:parameter:${lifetime.identity.itemId}`;
        case "bound": return `lifetime:bound:${lifetime.binderId}:${lifetime.parameterId}`;
        case "elided": return `lifetime:elided:${lifetime.ownerId}:${lifetime.position}`;
      }
    }
    case "type":
      if (capture.value.kind === "type-parameter") {
        return `type:${capture.value.identity.itemId}`;
      }
      if (capture.value.kind === "self") {
        return `type:self:${capture.value.owner.itemId}`;
      }
      throw new Error(
        "Rust precise type capture is not a declaration-backed type parameter or trait Self.",
      );
    case "const":
      if (capture.value.kind !== "parameter") {
        throw new Error(
          "Rust precise const capture is not a declaration-backed const parameter.",
        );
      }
      return `const:${capture.value.identity.itemId}`;
  }
}

export function compareRustCompilerCaptures(
  left: RustCompilerGenericArgument,
  right: RustCompilerGenericArgument,
): number {
  const leftRank = left.kind === "lifetime" ? 0 : left.kind === "type" ? 1 : 2;
  const rightRank = right.kind === "lifetime" ? 0 : right.kind === "type" ? 1 : 2;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return compareText(
    rustCompilerCaptureIdentityKey(left),
    rustCompilerCaptureIdentityKey(right),
  );
}

export function requiredRustOpaqueCaptureKeys(
  bounds: readonly RustCompilerBound[],
  context: RustCompilerNormalizationContext,
): ReadonlySet<string> {
  const required = new Set<string>();
  for (const parameter of context.parameters?.values() ?? []) {
    if (parameter.kind === "type") required.add(`type:${parameter.identity.itemId}`);
    else if (parameter.kind === "const") required.add(`const:${parameter.identity.itemId}`);
  }
  if (context.selfType?.kind === "self") {
    required.add(`type:self:${context.selfType.owner.itemId}`);
  }
  for (const bound of bounds) {
    visitRustCompilerBoundReferences(bound, {
      type: () => {},
      trait: () => {},
      lifetime: (lifetime) => {
        if (lifetime.kind === "parameter") {
          required.add(`lifetime:parameter:${lifetime.identity.itemId}`);
        } else if (lifetime.kind === "elided") {
          required.add(`lifetime:elided:${lifetime.ownerId}:${lifetime.position}`);
        }
      },
    });
  }
  return required;
}
