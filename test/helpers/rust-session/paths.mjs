import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(testDirectory, "../../..");
export const repositoryRoot = packageRoot;
export const fixtureCratesRoot = resolve(repositoryRoot, "test/fixtures/crates");
export const rustRuntimeCratePath = resolve(repositoryRoot, "../rust-runtime/crates/tsonic_rust_runtime");
