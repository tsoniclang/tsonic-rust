import { materializeRustOutputPlan } from "../../dist/backend/emission/materialize.js";
import { formatRustCompileOutput } from "../../dist/toolchain/rustfmt.js";

export function printRustSourceFile(model, edition = "2024") {
  const output = formatRustCompileOutput(materializeRustOutputPlan({
    edition,
    artifacts: [{ kind: "source", path: "src/lib.rs", model }],
  }), edition);
  const source = output.artifacts[0];
  if (source?.kind !== "source") {
    throw new Error("Rust source materialization did not produce its source artifact.");
  }
  return source.text;
}
