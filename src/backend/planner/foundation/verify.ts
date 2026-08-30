import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../../../analysis/program/model.js";
import {
  maximumRustFoundation,
  rustFoundationIncludes,
  type RustFoundation,
} from "../../../target-model/foundation/model.js";
import { rustFoundationForPath } from "../../../analysis/foundation/requirements.js";
import type { RustPlannedArtifact } from "../../artifact-model/output.js";

const allocKinds = new Set([
  "owned-string-from-borrowed-str",
  "string-concat",
  "format-write",
  "vec-literal",
]);

export function verifyRustFoundationPlan(
  program: RustTargetProgram,
  artifacts: readonly RustPlannedArtifact[],
): readonly TargetDiagnostic[] {
  let observed: RustFoundation = "core";
  const require = (foundation: RustFoundation): void => {
    observed = maximumRustFoundation(observed, foundation);
  };
  const dependencies = program.runtimeReferences.minimumFoundationByCrate;
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    if (value === null || typeof value !== "object") {
      return;
    }
    const record = value as Readonly<Record<string, unknown>>;
    const kind = record.kind;
    if (kind === "string" || allocKinds.has(String(kind))) {
      require("alloc");
    } else if (kind === "thread-local") {
      require("std");
    }
    if (typeof record.path === "string") {
      const root = record.path.split("::", 1)[0] ?? record.path;
      require(dependencies.get(root) ?? rustFoundationForPath(record.path));
    }
    Object.values(record).forEach(inspect);
  };
  for (const artifact of artifacts) {
    if (artifact.kind === "source") {
      inspect(artifact.model);
    }
  }
  if (!rustFoundationIncludes(program.foundation.selected, observed)) {
    return Object.freeze([foundationDiagnostic(
      "RUST_FOUNDATION_PLAN_VIOLATION",
      `Rust planning emitted '${observed}'-dependent syntax for a '${program.foundation.selected}' target.`,
      program,
      observed,
    )]);
  }
  if (!rustFoundationIncludes(program.foundation.required, observed)) {
    return Object.freeze([foundationDiagnostic(
      "RUST_FOUNDATION_ANALYSIS_INCOMPLETE",
      `Rust analysis sealed '${program.foundation.required}', but planning required '${observed}'.`,
      program,
      observed,
    )]);
  }
  return Object.freeze([]);
}

function foundationDiagnostic(
  code: string,
  message: string,
  program: RustTargetProgram,
  observed: RustFoundation,
): TargetDiagnostic {
  return Object.freeze({
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: Object.freeze([
      "target.capability=rust.foundation",
      `rust.foundation.selected=${program.foundation.selected}`,
      `rust.foundation.analyzed=${program.foundation.required}`,
      `rust.foundation.planned=${observed}`,
    ]),
  });
}
