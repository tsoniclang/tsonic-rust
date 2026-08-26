import { compareText, digestText, typeRequirementKey } from "./utilities.js";
import { compilerTypeRequirementCanonicalPath } from "../model/rustdoc-types.js";
import type {
  RustCompilerDependency,
  RustCompilerFunction,
  RustCompilerTypeParameter,
  RustCompilerTypeTraits,
} from "../model/model.js";
import type { ProjectionContext } from "./model.js";
import type { RustNamedTypeTraitContract } from "../../../target-model/types/model.js";
import type { RustProviderModuleDefinition, RustProviderOperationDefinition } from "../../packages/model.js";
import type { RustProviderTypeParameterRequirement } from "../../../target-model/operations/model.js";

export function operationRow(
  operation: RustProviderOperationDefinition,
): RustProviderOperationDefinition {
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

export function recordCarrierPath(paths: Map<string, string>, id: string, path: string): void {
  const existing = paths.get(id);
  if (existing !== undefined && existing !== path) {
    throw new Error(`Rust compiler target carrier '${id}' maps to both '${existing}' and '${path}'.`);
  }
  paths.set(id, path);
}

export function recordCarrierTraits(
  traits: Map<string, RustNamedTypeTraitContract>,
  id: string,
  contract: RustNamedTypeTraitContract,
): void {
  const existing = traits.get(id);
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(contract)) {
    throw new Error(`Rust compiler target carrier '${id}' has conflicting native trait contracts.`);
  }
  traits.set(id, contract);
}

export function projectCompilerTraitContract(
  contract: RustCompilerTypeTraits,
): RustNamedTypeTraitContract {
  const implementations = contract.implementations.map((implementation) => Object.freeze({
    traitPath: compilerRequirementTraitPath(implementation.trait),
    requirements: Object.freeze(implementation.requirements.map((requirement) => Object.freeze({
      typeArgumentIndex: requirement.typeArgumentIndex,
      traitPath: compilerRequirementTraitPath(requirement.requirement),
    })).sort((left, right) =>
      left.typeArgumentIndex - right.typeArgumentIndex || compareText(left.traitPath, right.traitPath))),
  })).sort((left, right) => compareText(
    `${left.traitPath}\0${JSON.stringify(left.requirements)}`,
    `${right.traitPath}\0${JSON.stringify(right.requirements)}`,
  ));
  return Object.freeze({ implementations: Object.freeze(implementations) });
}

function compilerRequirementTraitPath(
  requirement: RustCompilerTypeParameter["requirements"][number],
): string {
  return compilerTypeRequirementCanonicalPath(requirement).join("::");
}

export function typeRequirements(
  parameters: readonly RustCompilerTypeParameter[],
  allowedTypeParameters: readonly string[],
): { readonly typeRequirements?: readonly RustProviderTypeParameterRequirement[] } {
  const allowed = new Set(allowedTypeParameters);
  const requirements = parameters
    .filter((parameter) => allowed.has(parameter.name) && parameter.requirements.length > 0)
    .map((parameter) => Object.freeze({
      name: parameter.name,
      requirements: Object.freeze([...parameter.requirements]
        .sort((left, right) => compareText(typeRequirementKey(left), typeRequirementKey(right)))
        .map((requirement) => requirement === "clone" || requirement === "copy"
          ? requirement
          : Object.freeze({ kind: "trait" as const, path: requirement.trait.path }))),
    }))
    .sort((left, right) => compareText(left.name, right.name));
  return requirements.length === 0
    ? {}
    : { typeRequirements: Object.freeze(requirements) };
}

export function compilerModuleSpecifier(alias: string, modulePath: readonly string[]): string {
  const path = modulePath.length === 0 ? "index" : modulePath.join("/");
  return `@tsonic/rust/crates/${alias}/${path}.js`;
}

export function compilerModulePathFromSpecifier(alias: string, specifier: string): readonly string[] | undefined {
  const prefix = `@tsonic/rust/crates/${alias}/`;
  if (!specifier.startsWith(prefix) || !specifier.endsWith(".js")) {
    return undefined;
  }
  const raw = specifier.slice(prefix.length, -3);
  if (raw === "index") {
    return Object.freeze([]);
  }
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

export function compilerTargetTypeId(
  dependency: RustCompilerDependency,
  canonicalPath: readonly string[],
): string {
  return `rust.cargo.${digestText(dependency.packageId).slice(0, 24)}.${canonicalPath.join(".")}`;
}

export function rustPath(crateName: string, modulePath: readonly string[], ...tail: readonly string[]): string {
  return [crateName, ...modulePath, ...tail].join("::");
}

export function targetTraitPath(path: string, context: ProjectionContext): string {
  const segments = path.split("::");
  if (segments[0] === context.dependency.crateName) {
    segments[0] = context.dependency.targetCrateName;
  }
  return segments.join("::");
}

export function functionSignatureDigest(fn: RustCompilerFunction): string {
  return digestText(JSON.stringify(fn)).slice(0, 24);
}

export function providerFunctionPointerAbi(abi: string): string {
  if (abi === "Rust") {
    return "target-default";
  }
  if (abi === "C" || abi === "system") {
    return abi;
  }
  throw new Error(`Rust function pointer ABI '${abi}' has no source contract.`);
}
