import { expect, test } from "bun:test";
import { safeImageUrl, safeLinkUrl } from "./rich-text";

/** Builds a URL for a scheme the sanitizer must refuse, without writing one as a literal for the lint rules. */
function scheme(protocol: string, rest: string): string {
  return `${protocol}:${rest}`;
}

test.each([
  ["https://github.com/octo/repo", "https://github.com/octo/repo"],
  ["/octo/repo/pull/1", "https://github.com/octo/repo/pull/1"],
  ["//evil.example/x", "https://evil.example/x"],
  ["mailto:hi@example.com", "mailto:hi@example.com"],
  [scheme("javascript", "alert(1)"), null],
  ["data:text/html,<script>", null],
  ["ftp://github.com/x", null],
])("a link to %s becomes %s", (input, expected) => {
  expect(safeLinkUrl(input)).toEqual(expected);
});

test.each([
  ["https://camo.githubusercontent.com/abc", "https://camo.githubusercontent.com/abc"],
  ["https://private-user-images.githubusercontent.com/1/x.png", "https://private-user-images.githubusercontent.com/1/x.png"],
  ["https://avatars.githubusercontent.com/u/1?v=4", "https://avatars.githubusercontent.com/u/1?v=4"],
  ["https://github.com/user-attachments/assets/x", "https://github.com/user-attachments/assets/x"],
  ["/assets/x.png", "https://github.com/assets/x.png"],
])("an image on GitHub's own hosts stays, %s", (input, expected) => {
  expect(safeImageUrl(input)).toEqual(expected);
});

test.each([
  "https://evil.example/pixel.png",
  "//evil.example/pixel.png",
  "https://evilgithub.com/x.png",
  "https://github.com.evil.example/x.png",
  "https://camo.githubusercontent.com.evil.example/x.png",
  scheme("http", "//camo.githubusercontent.com/abc"),
  scheme("javascript", "alert(1)"),
  "data:image/png;base64,AAAA",
])("an image anywhere else is dropped: %s", (input) => {
  expect(safeImageUrl(input)).toBeNull();
});
