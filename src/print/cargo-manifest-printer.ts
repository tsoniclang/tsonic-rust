import type { CargoManifestPlan } from "../backend/planner/cargo-project.js";

export function printCargoManifest(manifest: CargoManifestPlan): string {
  const lines: string[] = [
    "[package]",
    `name = ${tomlString(manifest.packageName)}`,
    'version = "0.1.0"',
    `edition = ${tomlString(manifest.edition)}`,
  ];
  if (manifest.dependencies.length > 0) {
    lines.push("", "[dependencies]");
    for (const dependency of manifest.dependencies) {
      lines.push(`${dependency.name} = { path = ${tomlString(dependency.path)} }`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}
