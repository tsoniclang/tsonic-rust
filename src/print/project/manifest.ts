import type { CargoManifestPlan } from "../../backend/artifact-model/project/cargo.js";

export function printCargoManifest(manifest: CargoManifestPlan): string {
  const lines: string[] = [
    "[package]",
    `name = ${tomlString(manifest.packageName)}`,
    'version = "0.1.0"',
    `edition = ${tomlString(manifest.edition)}`,
  ];
  if (manifest.workspace !== undefined) {
    lines.push("", "[workspace]", 'resolver = "3"');
    if (manifest.workspace.members.length > 0) {
      lines.push(`members = [${manifest.workspace.members.map(tomlString).join(", ")}]`);
    }
  }
  if (manifest.dependencies.length > 0) {
    lines.push("", "[dependencies]");
    for (const dependency of manifest.dependencies) {
      const attributes = [`path = ${tomlString(dependency.path)}`];
      if (dependency.defaultFeatures !== undefined) {
        attributes.push(`default-features = ${String(dependency.defaultFeatures)}`);
      }
      if (dependency.features !== undefined && dependency.features.length > 0) {
        attributes.push(`features = [${dependency.features.map(tomlString).join(", ")}]`);
      }
      lines.push(`${dependency.name} = { ${attributes.join(", ")} }`);
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
