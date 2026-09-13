import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler provider local Date observations execute with native timezone rules", { timeout: 300_000 }, () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const { result } = compileRust({
      surfaces: ["js"], packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "provider_date" } },
      files: { "index.ts": `
import { check } from "@acme/testing";
export function main(): void {
  const before = new Date(1583650799999);
  const after = new Date(1583650800000);
  check(before.getFullYear() === 2020 && before.getMonth() === 2);
  check(before.getDate() === 8 && before.getDay() === 0);
  check(before.getHours() === 1 && before.getMinutes() === 59);
  check(before.getSeconds() === 59 && before.getMilliseconds() === 999);
  check(before.getTimezoneOffset() === 300);
  check(after.getHours() === 3 && after.getMinutes() === 0);
  check(after.getTimezoneOffset() === 240);
  check(after.getUTCHours() === 7);
  check(Number.isNaN(new Date(Number.NaN).getFullYear()));
}
` },
    });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("compiler-provider-date", result.artifacts, { run: true });
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
