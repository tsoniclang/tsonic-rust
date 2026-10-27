import { requireRustRecord } from "../program/records/objects/required-records.js";

import { appendRustDiagnostic } from "../program/walk.js";

import { selectRustClassEnvironment, recordRustClassEnvironmentDemands } from "./class-environments.js";

import type { RustFactWalk } from "../program/walk.js";

import type { RustProjectTypePolicy } from "../project-types/index.js";

export function recordRustProgramClassEnvironments(walk: RustFactWalk, projectTypes: RustProjectTypePolicy): void {
  const context = walk.context;
  recordRustClassEnvironmentDemands(walk);
  for (const definition of projectTypes.definitions) {
    const selected = selectRustClassEnvironment(walk, definition.declaration);
    if (selected.kind === "unresolved") {
      appendRustDiagnostic(walk, "RUST_CLASS_ENVIRONMENT_NOT_CLOSED", selected.reason, definition.declaration,
        ["target.capability=rust.class-value.environment"]);
    } else if (selected.kind === "available") {
      if (!context.classValues.recordEnvironment(selected.environment)) {
        appendRustDiagnostic(walk, "RUST_CLASS_ENVIRONMENT_NOT_CLOSED",
          "Class evaluation requires one consistent, immutable capture and static-storage contract.", definition.declaration,
          ["target.capability=rust.class-value.environment"]);
      }
      requireRustRecord(context.requiredRecords, "closureCapture", definition.declaration, "class-environment", "analysis/program/analyze.ts");
      context.records.closureCaptures.capture(definition.declaration, selected.environment.captures);
    }
  }
}
