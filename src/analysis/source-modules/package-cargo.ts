import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourcePackageEmissionProducer } from "../program/records/program/source-packages.js";
import type { CargoDependency, CargoManifestPlan } from "../../target-model/project/cargo.js";
import type { RustSourcePackageComponentPlan } from "../../target-model/records/program/source-packages.js";
import type { RustSourcePackageCargoPlan } from "../../target-model/records/program/source-package-crates.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export function analyzeRustPackageCargo(program: Omit<RustAnalysisProgram, "reachability">,
  producer: RustSourcePackageEmissionProducer): readonly TargetDiagnostic[] {
  if (program.configuration.project.kind === "user-owned") {
    producer.cargo({ kind: "user-owned", manifestPath: program.configuration.project.manifestPath });
    return Object.freeze([]);
  }
  const components = program.records.sourcePackageComponents.get();
  const emission = program.records.programEmission.get();
  if (components === undefined || emission === undefined) failTargetAnalysisInvariant("tsonic-rust",
    "Native source-package Cargo admission requires its exact component and program contracts.");
  const issues: TargetDiagnostic[] = [];
  const manifest: CargoManifestPlan = Object.freeze({ packageName: program.configuration.crateName,
    edition: program.configuration.edition, outputType: program.configuration.outputType,
    dependencies: program.runtimeReferences.cargoDependencies, workspace: Object.freeze({ members: Object.freeze([]) }) });
  const plan = selectCargoManifests(manifest, components, issues, emission.linkedComponentIds);
  if (plan !== undefined && issues.length === 0) producer.cargo({ kind: "generated", plan });
  return Object.freeze(issues);
}

export function selectCargoManifests(
  rootManifest: CargoManifestPlan,
  components: readonly RustSourcePackageComponentPlan[],
  diagnostics: TargetDiagnostic[],
  linkedComponentIds: readonly string[] = [],
): RustSourcePackageCargoPlan | undefined {
  const root = components.find((component) => component.root);
  if (root === undefined) {
    diagnostics.push(crateDiagnostic(
      "RUST_SOURCE_PACKAGE_COMPONENT_ROOT_MISSING",
      "Rust Cargo planning has no exact root source-package component.",
    ));
    return undefined;
  }
  const componentById = new Map(components.map((component) =>
    [component.componentId, component] as const));
  const externalComponents = components.filter((component) => !component.root);
  const runtimeNames = new Set(rootManifest.dependencies.map((dependency) => dependency.name));
  const componentIdByCrateName = new Map<string, string>();
  for (const component of externalComponents) {
    if (component.crateName === undefined || component.crateName === rootManifest.packageName ||
      runtimeNames.has(component.crateName)) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_PACKAGE_CRATE_IDENTITY_CONFLICT",
        `Generated source-package component '${component.componentId}' has conflicting Rust crate identity '${String(component.crateName)}'.`,
      ));
      continue;
    }
    const existingComponentId = componentIdByCrateName.get(component.crateName);
    if (existingComponentId !== undefined) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_PACKAGE_CRATE_IDENTITY_CONFLICT",
        `Source-package components '${existingComponentId}' and '${component.componentId}' share Rust crate identity '${component.crateName}'.`,
      ));
      continue;
    }
    componentIdByCrateName.set(component.crateName, component.componentId);
  }
  if (diagnostics.length > 0) {
    return undefined;
  }
  const dependencyFor = (
    component: RustSourcePackageComponentPlan,
    dependencyId: string,
  ): CargoDependency | undefined => {
    const dependency = componentById.get(dependencyId);
    if (dependency?.crateName === undefined) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_PACKAGE_COMPONENT_DEPENDENCY_MISSING",
        `Source-package component '${component.componentId}' has no exact generated dependency crate for '${dependencyId}'.`,
      ));
      return undefined;
    }
    return {
      name: dependency.crateName,
      path: component.root
        ? `crates/${dependency.crateName}`
        : `../${dependency.crateName}`,
    };
  };
  const rootDependencies = mergeCargoDependencies(
    rootManifest.dependencies,
    [...new Set([...root.dependencyComponentIds, ...linkedComponentIds])].flatMap((dependencyId) => {
      const dependency = dependencyFor(root, dependencyId);
      return dependency === undefined ? [] : [dependency];
    }),
    diagnostics,
  );
  const componentRuntimeDependencies = rootManifest.dependencies.map(
    (dependency): CargoDependency => Object.freeze({
      name: dependency.name,
      path: dependency.path,
      ...(dependency.defaultFeatures === undefined
        ? {}
        : { defaultFeatures: dependency.defaultFeatures }),
      ...(dependency.features === undefined ? {} : { features: dependency.features }),
    }),
  );
  const externalManifestsByComponentId = new Map<string, {
    readonly directory: `crates/${string}`;
    readonly manifest: CargoManifestPlan;
  }>();
  for (const component of externalComponents) {
    const crateName = component.crateName;
    if (crateName === undefined) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_PACKAGE_CRATE_IDENTITY_MISSING",
        `Source-package component '${component.componentId}' has no exact Rust crate identity.`,
      ));
      continue;
    }
    const componentDependencies = component.dependencyComponentIds.flatMap((dependencyId) => {
      const dependency = dependencyFor(component, dependencyId);
      return dependency === undefined ? [] : [dependency];
    });
    const dependencies = mergeCargoDependencies(
      componentRuntimeDependencies,
      componentDependencies,
      diagnostics,
    );
    externalManifestsByComponentId.set(component.componentId, Object.freeze({
      directory: `crates/${crateName}`,
      manifest: Object.freeze({
        packageName: crateName,
        edition: rootManifest.edition,
        outputType: "lib",
        dependencies,
      }),
    }));
  }
  if (diagnostics.length > 0) {
    return undefined;
  }
  return Object.freeze({
    rootManifest: Object.freeze({
      ...rootManifest,
      dependencies: rootDependencies,
      workspace: {
        members: Object.freeze([...externalManifestsByComponentId.values()]
          .map((entry) => entry.directory)
          .sort(compareNames)),
      },
    }),
    externalManifestsByComponentId: new Map(externalManifestsByComponentId),
  });
}


function mergeCargoDependencies(
  base: readonly CargoDependency[],
  added: readonly CargoDependency[],
  diagnostics: TargetDiagnostic[],
): readonly CargoDependency[] {
  const byName = new Map<string, CargoDependency>();
  for (const dependency of [...base, ...added]) {
    const existing = byName.get(dependency.name);
    if (existing !== undefined &&
      (
        existing.path !== dependency.path ||
        existing.registryPatch !== dependency.registryPatch ||
        existing.defaultFeatures !== dependency.defaultFeatures ||
        !sameCargoFeatures(existing.features, dependency.features)
      )) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_PACKAGE_CRATE_DEPENDENCY_CONFLICT",
        `Cargo dependency '${dependency.name}' has contradictory source-package and runtime paths.`,
      ));
      continue;
    }
    byName.set(dependency.name, dependency);
  }
  return Object.freeze([...byName.values()].sort((left, right) =>
    compareNames(left.name, right.name)));
}

function sameCargoFeatures(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index]);
}


function crateDiagnostic(code: string, message: string): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: ["target.capability=rust.backend.source-package-crates"],
  };
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

