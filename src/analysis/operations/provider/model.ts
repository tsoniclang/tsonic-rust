import { rustSourceSemanticsModules } from "../../../source/profiles/source-modules.js";
import { tsonicCoreSourceSemanticsModules } from "@tsonic/source-core";
import type { RustProjectMethodPropertyPlanRegistry } from "../../project-types/method-properties.js";
import type { RustProjectMethodDispatchPlanRegistry } from "../../project-types/method-dispatch.js";
import type { RustProjectTypePolicy } from "../../project-types/type-policy.js";
import type { RustProviderOperationRow } from "../../../providers/packages/model.js";
import type { RustSourceCallableAbiResolver } from "../../../policy/ownership/source-callable-abi.js";
import type { RustSourceProfileRegistry } from "../../../policy/types/source-profile.js";
import type { RustSourceTypeRegistry } from "../../project-types/source-type-registry.js";
import type { RustTargetTypeResolutionOptions } from "../../../policy/types/resolution.js";

export const sourceCallMarkerByIdentity = new Map(
  [
    ...tsonicCoreSourceSemanticsModules(),
    ...rustSourceSemanticsModules(),
  ].flatMap((module) =>
    module.exports
      .filter((declaration) => declaration.kind === "call-marker")
      .map((declaration) => [
        `${module.moduleSpecifier}::${declaration.exportName}`,
        declaration.marker,
      ] as const)),
);

export interface RustOperationsProviderOptions {
  readonly providerExports: readonly import("../../../providers/packages/model.js").RustProviderExportRow[];
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly providerTypes: readonly import("../../../providers/packages/model.js").RustProviderTypeRow[];
  readonly providerCarrierPaths: ReadonlyMap<string, string>;
  readonly jsEnabled: boolean;
  readonly regExpSubsetViolation: (pattern: string, flags: string) => string | undefined;
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly resolveProjectUnionCarrier: RustTargetTypeResolutionOptions["resolveProjectUnionCarrier"];
  readonly sourceCallableAbi: RustSourceCallableAbiResolver;
  readonly projectTypes: RustProjectTypePolicy;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlanRegistry;
  readonly projectMethodProperties: RustProjectMethodPropertyPlanRegistry;
}
