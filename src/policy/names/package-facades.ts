import type { TargetSourcePackage } from "@tsonic/target-api";

import { rustModuleSegmentName, rustPackageModuleName } from "../../target-model/names/identifiers.js";

export function sourcePackageFacadeModuleSegments(
  sourcePackage: TargetSourcePackage,
  specifier: string,
  packagePrefixRequired: boolean,
): readonly string[] {
  const packagePrefix = packagePrefixRequired
    ? [rustPackageModuleName(sourcePackage.name ?? sourcePackage.id)]
    : [];
  if (
    specifier === "." ||
    specifier === "../../analysis/program/index.js" ||
    specifier === "./index.mjs" ||
    specifier === "./index.ts" ||
    specifier === "./index.mts"
  ) {
    return Object.freeze(packagePrefix);
  }
  const withoutPrefix = specifier.startsWith("./")
    ? specifier.slice(2)
    : specifier;
  const withoutExtension = withoutPrefix.replace(/\.(?:mjs|mts|js|ts)$/u, "");
  const segments = withoutExtension.split("/")
    .filter((segment) => segment.length > 0)
    .map(rustModuleSegmentName);
  if (segments[segments.length - 1] === "index") {
    segments.pop();
  }
  return Object.freeze([...packagePrefix, ...segments]);
}
