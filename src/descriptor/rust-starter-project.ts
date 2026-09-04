import type {
  TargetStarterProject,
  TargetStarterProjectContext,
} from "@tsonic/target-api";
import { rustTargetId } from "../target-model/identities/target.js";

export function createRustStarterProject(
  context: TargetStarterProjectContext,
): TargetStarterProject {
  const crateName = context.projectName.replace(/[.-]/gu, "_");
  return Object.freeze({
    target: Object.freeze({
      id: rustTargetId,
      options: Object.freeze({
        crateName,
        edition: "2024",
        outputType: "bin",
      }),
    }),
    scripts: Object.freeze({
      build: "tsonic build --project tsonic.json",
      start: "npm run build && cargo run --manifest-path out/rust/Cargo.toml",
      check: "npm run build && cargo check --manifest-path out/rust/Cargo.toml",
    }),
    files: Object.freeze([
      Object.freeze({
        path: "src/App.ts",
        contents: [
          "export function main(): void {",
          "  const answer = 40 + 2;",
          "  if (answer !== 42) {",
          '    throw new Error("unexpected answer");',
          "  }",
          "}",
          "",
        ].join("\n"),
      }),
    ]),
    requirements: Object.freeze([
      Object.freeze({
        id: "rustup-toolchain",
        displayName: "Rust toolchain",
        checks: Object.freeze([
          Object.freeze({ command: "rustup", args: Object.freeze(["show", "active-toolchain"]) }),
          Object.freeze({ command: "rustc", args: Object.freeze(["--version"]) }),
          Object.freeze({ command: "cargo", args: Object.freeze(["--version"]) }),
          Object.freeze({ command: "rustdoc", args: Object.freeze(["--version"]) }),
          Object.freeze({ command: "rustfmt", args: Object.freeze(["--version"]) }),
        ]),
        installUrl: "https://www.rust-lang.org/tools/install",
        installInstructions: "Install stable Rust with rustup, then run 'rustup component add rustfmt'.",
      }),
    ]),
  });
}
