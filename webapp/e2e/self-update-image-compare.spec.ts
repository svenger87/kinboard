import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The pre-upgrade backup runs only when the pull actually changed an image,
 * decided by comparing the stack's image ids before and after. It fired on a
 * production run where nothing had changed, because the list being compared
 * came back in a different order every time:
 *
 *   docker compose config --images | md5sum     (three consecutive calls)
 *   2504dcd67ed41f7321324da8a9db6e36
 *   e89eb6a98b4265b9ad6d59ac2d1fd2f8
 *   5911aee806f94f70acfc6880b7545387
 *
 * with every image id identical. So "no image changed; skipping" was all but
 * unreachable: every run took a backup, a run that had nothing to upgrade
 * could still abort on a backup failure, and the "fast no-op" the script
 * promised was not one. Sorted, five calls produce one hash.
 */

const script = readFileSync("docker/kinboard-self-update.sh", "utf8");

test("the image list is sorted before it is compared", () => {
  // The list comes from stack_image_refs (`config --images`, or the
  // containers' references in container mode, RFC-023 PR 14).
  const refs = script.slice(script.indexOf("stack_image_refs() {"), script.indexOf("images_now()"));
  expect(refs, "could not find stack_image_refs()").toContain("config --images");
  const fn = script.slice(script.indexOf("images_now()"), script.indexOf("IMAGES_BEFORE="));
  expect(
    fn,
    "`docker compose config --images` returns images in a different order on " +
      "every call, so an unsorted before/after comparison reports a change " +
      "that did not happen",
  ).toMatch(/stack_image_refs[^\n]*\|\s*sort/);
});
