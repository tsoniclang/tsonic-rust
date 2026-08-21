import type {
  TargetDiagnostic,
} from "@tsonic/target-api/artifacts";
import {
  rustSourceItemIdentity,
} from "../../../analysis/program/source-package-facades.js";
import type {
  RustSourcePackageFacadeExportContract,
} from "../../../analysis/program/source-package-facades.js";
import type {
  RustPlanningContext,
} from "../context.js";
import type {
  RustSourceFileOutputIdentity,
} from "../names/source-output-identities.js";

export { rustSourceItemIdentity };

export interface RustSourcePackageFacadeExport
  extends RustSourcePackageFacadeExportContract {
  readonly implementationModuleName: string;
}

export interface RustSourcePackageFacadePlan {
  readonly rootComponentId: string;
  readonly rootExports: readonly RustSourcePackageFacadeExport[];
  readonly exportsByComponentId: ReadonlyMap<
    string,
    readonly RustSourcePackageFacadeExport[]
  >;
  readonly externalItemPathByIdentity: ReadonlyMap<string, string>;
  readonly publicTopLevelModules: ReadonlySet<string>;
  readonly publicModuleNames: ReadonlySet<string>;
  readonly publicImplementationItemIdentities: ReadonlySet<string>;
  readonly publicModuleNamesByComponent: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
  readonly publicImplementationItemIdentitiesByComponent: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
}

export function materializeRustSourcePackageFacades(
  input: RustPlanningContext,
  identitiesByFileName: ReadonlyMap<string, RustSourceFileOutputIdentity>,
): {
  readonly plan?: RustSourcePackageFacadePlan;
  readonly diagnostics: readonly TargetDiagnostic[];
} {
  const diagnostics: TargetDiagnostic[] = [];
  const classifications = input.program.sourcePackageFacades;
  const exports: RustSourcePackageFacadeExport[] = [];
  for (const componentId of classifications.componentIds) {
    const contract = classifications.exportsForComponent(componentId);
    for (const exported of contract) {
      const implementationIdentity = identitiesByFileName.get(
        exported.implementationFileName,
      );
      if (
        implementationIdentity === undefined ||
        implementationIdentity.componentId !== exported.componentId
      ) {
        diagnostics.push(facadeDiagnostic(
          "RUST_SOURCE_PACKAGE_FACADE_DECLARATION_IDENTITY_MISSING",
          `Facade '${facadeDisplayPath(exported)}' has no physical module in its sealed source-package component.`,
        ));
        continue;
      }
      exports.push(Object.freeze({
        ...exported,
        implementationModuleName: implementationIdentity.moduleName,
      }));
    }
  }
  if (diagnostics.length > 0) {
    return { diagnostics: Object.freeze(diagnostics) };
  }
  exports.sort(compareFacadeExports);

  const externalItemCandidates = new Map<
    string,
    RustSourcePackageFacadeExport[]
  >();
  for (const exported of exports) {
    if (exported.componentId === classifications.rootComponentId) {
      continue;
    }
    const key = rustSourceItemIdentity(
      exported.implementationFileName,
      exported.implementationName,
    );
    const candidates = externalItemCandidates.get(key) ?? [];
    candidates.push(exported);
    externalItemCandidates.set(key, candidates);
  }
  const externalItemPathByIdentity = new Map<string, string>();
  for (const [key, candidates] of externalItemCandidates) {
    candidates.sort(compareFacadePreference);
    const selected = candidates[0]!;
    const crateName = identitiesByFileName.get(
      selected.implementationFileName,
    )?.externalCrateName;
    if (crateName === undefined) {
      diagnostics.push(facadeDiagnostic(
        "RUST_SOURCE_PACKAGE_FACADE_CRATE_IDENTITY_MISSING",
        `External package facade '${facadeDisplayPath(selected)}' has no deterministic Rust crate identity.`,
      ));
      continue;
    }
    externalItemPathByIdentity.set(
      key,
      [crateName, ...selected.facadeModuleSegments, selected.facadeName]
        .join("::"),
    );
  }
  if (diagnostics.length > 0) {
    return { diagnostics: Object.freeze(diagnostics) };
  }

  const exportsByComponentId = new Map(
    classifications.componentIds.map((componentId) =>
      [componentId, Object.freeze(exports.filter((entry) =>
        entry.componentId === componentId))] as const),
  );
  const rootExports = exportsByComponentId.get(
    classifications.rootComponentId,
  ) ?? Object.freeze([]);
  const publicModuleNames = Object.freeze(new Set(
    classifications.publicModuleNamesForComponent(
      classifications.rootComponentId,
    ),
  ));
  const publicImplementationItemIdentities = Object.freeze(new Set(
    classifications.publicImplementationItemIdentitiesForComponent(
      classifications.rootComponentId,
    ),
  ));
  const publicModuleNamesByComponent = new Map(
    classifications.componentIds.map((componentId) => [
      componentId,
      Object.freeze(new Set(
        classifications.publicModuleNamesForComponent(componentId),
      )),
    ] as const),
  );
  const publicImplementationItemIdentitiesByComponent = new Map(
    classifications.componentIds.map((componentId) => [
      componentId,
      Object.freeze(new Set(
        classifications.publicImplementationItemIdentitiesForComponent(
          componentId,
        ),
      )),
    ] as const),
  );
  return {
    diagnostics: Object.freeze([]),
    plan: Object.freeze({
      rootComponentId: classifications.rootComponentId,
      rootExports,
      exportsByComponentId,
      externalItemPathByIdentity,
      publicTopLevelModules: Object.freeze(new Set([...publicModuleNames]
        .filter((name) => !name.includes("::")))),
      publicModuleNames,
      publicImplementationItemIdentities,
      publicModuleNamesByComponent,
      publicImplementationItemIdentitiesByComponent,
    }),
  };
}

function facadeDisplayPath(
  value: RustSourcePackageFacadeExportContract,
): string {
  return [...value.facadeModuleSegments, value.facadeName].join("::");
}

function compareFacadeExports(
  left: RustSourcePackageFacadeExport,
  right: RustSourcePackageFacadeExport,
): number {
  return compareNames(left.componentId, right.componentId) ||
    compareNames(
      left.facadeModuleSegments.join("::"),
      right.facadeModuleSegments.join("::"),
    ) ||
    compareNames(left.facadeName, right.facadeName) ||
    compareNames(left.implementationFileName, right.implementationFileName) ||
    compareNames(left.implementationName, right.implementationName);
}

function compareFacadePreference(
  left: RustSourcePackageFacadeExport,
  right: RustSourcePackageFacadeExport,
): number {
  return left.facadeModuleSegments.length - right.facadeModuleSegments.length ||
    compareFacadeExports(left, right);
}

function facadeDiagnostic(code: string, message: string): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: ["target.capability=rust.backend.source-package-facade"],
  };
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
