import { materializeRustOutputPlan } from "../../dist/backend/emission/materialize.js";

export function printRustSourceFile(model, edition = "2024") {
  const output = materializeRustOutputPlan({
    edition,
    artifacts: [{ kind: "source", path: "src/lib.rs", model }],
  });
  const source = output.artifacts[0];
  if (source?.kind !== "source") {
    throw new Error("Rust source materialization did not produce its source artifact.");
  }
  return source.text;
}
