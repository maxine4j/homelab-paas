import { expect, test } from "vitest";
import { DescriptorError, parseDescriptor } from "../src/descriptor.ts";

test("draft descriptor parsing stays disabled pending CP-05 approval", () => {
  expect(() =>
    parseDescriptor("app.sd.yaml", "version: 1", {
      clusterDomain: "example.com",
      occupiedHosts: new Set(),
      reservedServiceIds: new Set(),
      reservedPaths: new Set(),
      applicationSecrets: new Map(),
      aliases: new Map(),
    }),
  ).toThrow(DescriptorError);
});
test.todo(
  "CP-05 draft: private web defaults, primary selection, requests, healthcheck, and 4096 MiB limit",
);
