import type { Node } from "@tsonic/tsts";
import type {
  RustSelectedTargetSignature,
} from "../../policy/types.js";
import type {
  RustTargetOperationFact,
} from "../../source/rust-facts/keys.js";
import type {
  RustItem,
  RustTypeBound,
} from "../rust-ast/nodes.js";
import type {
  RustSourceCallableContract,
} from "../../translate/artifacts/index.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "./diagnostics.js";
import {
  requireRustCarrierRequirements,
} from "./generic-requirements.js";
import type {
  RustGenericRequirement,
} from "./generic-requirements.js";
import {
  diagnosticInput,
} from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";

export function publishRustSourceCallableContract(
  declaration: Node,
  item: Extract<RustItem, { readonly kind: "function" }>,
  context: RustPlanContext,
): boolean {
  const callable: RustSourceCallableContract = Object.freeze({
    sourceDeclaration: declaration,
    name: item.name,
    isAsync: item.isAsync === true,
    fallible: item.fallible === true,
    typeParameters: Object.freeze([...(item.typeParams ?? [])]),
    parameters: Object.freeze([...item.params]),
    ...(item.returnType === undefined ? {} : { returnType: item.returnType }),
  });
  const published = context.input.artifacts.publishSourceCallable(
    declaration,
    callable,
  );
  if (published.kind === "accepted") {
    return true;
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, declaration),
    "rust.backend.source-callable-contract",
    published.reason,
  ));
  return false;
}

export function applyRustSourceCallableRequirements(
  call: Node,
  selected: RustSelectedTargetSignature,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  context: RustPlanContext,
): boolean {
  if (fact.target.form !== "function") {
    return true;
  }
  const declaration = selected.sourceDeclaration;
  if (declaration === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, call),
      "rust.backend.source-callable-declaration",
      "Selected project-source function call has no exact selected source declaration.",
    ));
    return false;
  }
  const callable = context.input.artifacts.sourceCallable(declaration);
  if (callable === undefined) {
    return true;
  }
  if (callable.sourceDeclaration !== declaration ||
    callable.name !== fact.target.name) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, call),
      "rust.backend.source-callable-identity",
      "Published Rust callable contract conflicts with the exact selected project-source function.",
    ));
    return false;
  }
  const selectedTypeArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const targetTypeArguments = fact.targetTypeArguments ?? [];
  if (callable.typeParameters.length !== selectedTypeArguments.length ||
    callable.typeParameters.length !== targetTypeArguments.length ||
    callable.typeParameters.some((parameter, index) =>
      parameter.name !== selectedTypeArguments[index]?.typeParameterName)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, call),
      "rust.backend.source-callable-type-parameters",
      "Published Rust callable type parameters conflict with the exact selected source-call instantiation.",
    ));
    return false;
  }
  for (let index = 0; index < callable.typeParameters.length; index += 1) {
    const parameter = callable.typeParameters[index];
    const argument = targetTypeArguments[index];
    if (parameter === undefined || argument === undefined) {
      return false;
    }
    const requirements = rustGenericRequirements(parameter.bounds);
    if (requirements === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, call),
        "rust.backend.source-callable-bound",
        "Selected Rust source-call contract contains a generic bound outside the closed target requirement model.",
      ));
      return false;
    }
    if (!requireRustCarrierRequirements(
      argument,
      requirements,
      call,
      context,
    )) {
      return false;
    }
  }
  return true;
}

function rustGenericRequirements(
  bounds: readonly RustTypeBound[],
): readonly RustGenericRequirement[] | undefined {
  const requirements: RustGenericRequirement[] = [];
  for (const bound of bounds) {
    if (bound.kind === "trait" && bound.path === "Clone") {
      requirements.push("clone");
      continue;
    }
    if (bound.kind === "lifetime" && bound.name === "static") {
      requirements.push("static");
      continue;
    }
    return undefined;
  }
  return requirements;
}
