import type { CargoManifestPlan } from "../../backend/project-model/cargo.js";

export function printCargoManifest(manifest: CargoManifestPlan): string {
  const lines: string[] = [
    "[package]",
    `name = ${tomlString(manifest.packageName)}`,
    'version = "0.1.0"',
    `edition = ${tomlString(manifest.edition)}`,
    "",
    "[workspace]",
  ];
  if (manifest.dependencies.length > 0) {
    lines.push("", "[dependencies]");
    for (const dependency of manifest.dependencies) {
      lines.push(`${dependency.name} = { path = ${tomlString(dependency.path)} }`);
    }
    const registryPatches = manifest.dependencies.filter((dependency) => dependency.registryPatch === "crates-io");
    if (registryPatches.length > 0) {
      lines.push("", "[patch.crates-io]");
      for (const dependency of registryPatches) {
        lines.push(`${dependency.name} = { path = ${tomlString(dependency.path)} }`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function tomlString(value: string): string {
  let escaped = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    switch (codePoint) {
      case 0x08:
        escaped += "\\b";
        break;
      case 0x09:
        escaped += "\\t";
        break;
      case 0x0a:
        escaped += "\\n";
        break;
      case 0x0c:
        escaped += "\\f";
        break;
      case 0x0d:
        escaped += "\\r";
        break;
      case 0x22:
        escaped += '\\"';
        break;
      case 0x5c:
        escaped += "\\\\";
        break;
      default:
        escaped += codePoint <= 0x1f || codePoint === 0x7f
          ? `\\u${codePoint.toString(16).padStart(4, "0")}`
          : character;
        break;
    }
  }
  return `"${escaped}"`;
}
