import { compareText, digestText, genericParameterIdentity } from "./utilities.js";
import type {
  RustCompilerDependency,
  RustCompilerFunction,
  RustCompilerGenerics,
  RustCompilerTypeTraits,
} from "../model/model.js";
import type { ProjectionContext } from "./model.js";
import type {
  RustNamedTypeTraitContract,
  RustNamedTypeTraitContractEntry,
} from "../../../target-model/types/model.js";
import type { RustProviderModuleDefinition, RustProviderOperationDefinition } from "../../packages/model.js";
import type { RustProviderTypeParameterRequirement } from "../../../target-model/operations/model.js";
import {
  rustBoundSemanticKey,
  rustSemanticIdentityKey,
} from "../../../target-model/semantics/index.js";
import type { RustSemanticIdentity } from "../../../target-model/semantics/index.js";
import {
  targetBoundFor,
  targetGenericArgumentFor,
  targetTraitFor,
} from "./types.js";
import {
  rustNamedTypeTraitImplementationSemanticKey,
  rustNamedTypeTraitRequirementSemanticKey,
} from "../../../target-model/types/index.js";

export function operationRow(operation: RustProviderOperationDefinition): RustProviderOperationDefinition {
  return Object.freeze(operation);
}

export function materializeImports(
  imports: ReadonlyMap<string, ReadonlySet<string>>,
  currentModule: string,
): NonNullable<RustProviderModuleDefinition["imports"]> {
  return Object.freeze([...imports.entries()]
    .filter(([moduleSpecifier]) => moduleSpecifier !== currentModule)
    .sort(([left], [right]) => compareText(left, right))
    .map(([moduleSpecifier, names]) => Object.freeze({
      moduleSpecifier,
      namedImports: Object.freeze([...names].sort(compareText).map((exportedName) => Object.freeze({ exportedName }))),
    })));
}

export function recordCarrierTraits(
  traits: Map<string, RustNamedTypeTraitContractEntry>,
  typeIdentity: RustSemanticIdentity,
  contract: RustNamedTypeTraitContract,
): void {
  const identityKey = rustSemanticIdentityKey(typeIdentity);
  const existing = traits.get(identityKey);
  if (existing !== undefined && traitContractKey(existing.contract) !== traitContractKey(contract)) {
    throw new Error(`Rust compiler target carrier '${identityKey}' has conflicting native trait contracts.`);
  }
  traits.set(identityKey, Object.freeze({ typeIdentity, contract }));
}

export function projectCompilerTraitContract(
  contract: RustCompilerTypeTraits,
  context: ProjectionContext,
): RustNamedTypeTraitContract {
  const implementations = contract.implementations.map((implementation) => Object.freeze({
    trait: targetTraitFor(implementation.trait, context, "result"),
    genericBindings: Object.freeze(implementation.genericBindings.map((binding) => Object.freeze({
      parameter: targetGenericArgumentFor(binding.parameter, context, "result"),
      genericArgumentIndex: binding.genericArgumentIndex,
    }))),
    requirements: Object.freeze(implementation.requirements.map((requirement) => {
      const bound = targetBoundFor(requirement.bound, context, "result");
      if (bound.kind !== "trait") {
        throw new Error("Rust compiler trait requirement lost its trait-bound identity during projection.");
      }
      return Object.freeze({
        genericArgumentIndex: requirement.genericArgumentIndex,
        bound,
      });
    }).sort((left, right) => compareText(
      rustNamedTypeTraitRequirementSemanticKey(left),
      rustNamedTypeTraitRequirementSemanticKey(right),
    ))),
  })).sort((left, right) => compareText(
    rustNamedTypeTraitImplementationSemanticKey(left),
    rustNamedTypeTraitImplementationSemanticKey(right),
  ));
  return Object.freeze({ implementations: Object.freeze(implementations) });
}

export function typeRequirements(
  generics: RustCompilerGenerics,
  allowedTypeParameters: readonly string[],
  context: ProjectionContext,
): { readonly typeRequirements?: readonly RustProviderTypeParameterRequirement[] } {
  const allowed = new Set(allowedTypeParameters);
  const requirements = generics.parameters.flatMap((parameter) => {
    if (parameter.kind !== "type") return [];
    const name = context.genericNames?.get(parameter.identity.itemId);
    if (name === undefined) {
      throw new Error(`Rust generic identity '${parameter.identity.itemId}' has no exact source-visible requirement name.`);
    }
    if (!allowed.has(name)) return [];
    const bounds = [
      ...parameter.bounds,
      ...generics.wherePredicates.flatMap((predicate) =>
        predicate.kind === "type" && predicate.type.kind === "type-parameter" &&
            predicate.type.identity.itemId === parameter.identity.itemId
          ? predicate.bounds
          : []),
    ];
    const requirementsByIdentity = new Map(bounds.map((bound) => {
      const requirement = targetBoundFor(bound, context, "parameter");
      return [rustBoundSemanticKey(requirement), requirement] as const;
    }));
    const requirements = [...requirementsByIdentity.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, requirement]) => requirement);
    return requirements.length === 0 ? [] : [Object.freeze({
      name,
      requirements: Object.freeze(requirements),
    })];
  }).sort((left, right) => compareText(left.name, right.name));
  return requirements.length === 0 ? {} : { typeRequirements: Object.freeze(requirements) };
}

export function compilerModuleSpecifier(alias: string, modulePath: readonly string[]): string {
  const path = modulePath.length === 0 ? "index" : modulePath.join("/");
  return `@tsonic/rust/crates/${alias}/${path}.js`;
}

export function compilerModulePathFromSpecifier(alias: string, specifier: string): readonly string[] | undefined {
  const prefix = `@tsonic/rust/crates/${alias}/`;
  if (!specifier.startsWith(prefix) || !specifier.endsWith(".js")) return undefined;
  const raw = specifier.slice(prefix.length, -3);
  if (raw === "index") return Object.freeze([]);
  const segments = raw.split("/");
  return segments.length > 0 && segments.every((segment) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(segment))
    ? Object.freeze(segments)
    : undefined;
}

export function compilerProviderVersion(projectDigest: string): string {
  return `1.${projectDigest.slice(0, 32)}`;
}

export function compilerProviderModuleId(dependency: RustCompilerDependency, modulePath: readonly string[]): string {
  return `cargo:${digestText(dependency.packageId).slice(0, 24)}:${modulePath.length === 0 ? "root" : modulePath.join("::")}`;
}

export function compilerExportId(dependency: RustCompilerDependency, modulePath: readonly string[], name: string): string {
  return `${dependency.packageId}::${[...modulePath, name].join("::")}`;
}

export function compilerTargetTypeId(dependency: RustCompilerDependency, canonicalPath: readonly string[]): string {
  return `rust.cargo.${digestText(dependency.packageId).slice(0, 24)}.${canonicalPath.join(".")}`;
}

export function rustPath(crateName: string, modulePath: readonly string[], ...tail: readonly string[]): string {
  return [crateName, ...modulePath, ...tail].join("::");
}

export function functionSignatureDigest(fn: RustCompilerFunction): string {
  return digestText([
    fn.identity.itemId,
    fn.name,
    fn.safety,
    fn.abi,
    fn.variadic ? "variadic" : "fixed",
    ...fn.enclosingGenerics.parameters.map(genericParameterIdentity),
    ...fn.generics.parameters.map(genericParameterIdentity),
  ].join("\0")).slice(0, 24);
}

export function providerFunctionPointerAbi(abi: string): string {
  if (abi === "Rust") return "target-default";
  if (abi === "C" || abi === "system") return abi;
  throw new Error(`Rust function pointer ABI '${abi}' has no source contract.`);
}

function traitContractKey(contract: RustNamedTypeTraitContract): string {
  return contract.implementations
    .map(rustNamedTypeTraitImplementationSemanticKey)
    .sort(compareText)
    .join("\0");
}
