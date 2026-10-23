import type { Meta, StoryObj } from "@storybook/html-vite";
import { el } from "../ui/dom";
import { type FacedReview, VERDICT_LOOK, verdictFace } from "../ui/verdict-face";
import { inShadow } from "./shadow";
import FACE_STYLES from "../styles/faces.css?raw";

const OCTOCAT = "https://avatars.githubusercontent.com/u/583231?v=4";

const REVIEWS: FacedReview[] = [
  { login: "octocat", avatarUrl: OCTOCAT, verdict: "approved" },
  { login: "mona", avatarUrl: null, verdict: "changes_requested" },
  { login: "octocat", avatarUrl: OCTOCAT, verdict: "commented" },
  { login: "ada", avatarUrl: null, verdict: "approved", dismissed: true },
  { login: "octocat", avatarUrl: OCTOCAT, verdict: "changes_requested", dismissed: true },
  { login: "linus", avatarUrl: null, verdict: "dismissed", dismissed: true },
];

/** Every verdict as a face, with what it says, the way the timeline, the pickers and the inbox draw them. */
function render(): HTMLElement {
  const list = el("ul");
  list.style.cssText = "display:grid;gap:10px;margin:0;padding:0;list-style:none";
  for (const review of REVIEWS) {
    const row = el("li");
    row.style.cssText = "display:flex;align-items:center;gap:10px";
    const said = `${review.login} ${VERDICT_LOOK[review.verdict].said}${review.dismissed && review.verdict !== "dismissed" ? ", since dismissed" : ""}`;
    row.append(verdictFace(review), el("span", {}, said));
    list.append(row);
  }
  const host = inShadow(list);
  host.shadowRoot!.prepend(el("style", {}, FACE_STYLES));
  return host;
}

const meta = {
  title: "Stack/Verdict faces",
  tags: ["autodocs"],
  render,
  parameters: {
    docs: {
      description: {
        component:
          "A reviewer's face with their verdict on its corner, in the reviewer rows' colours: a green check for an approval, a yellow page for a change request, a grey bubble for a comment. A review since dismissed keeps its verdict's icon and colour while its face greys out; one whose verdict the timeline no longer knows shows the slash.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every verdict, and the dismissed ones. */
export const Gallery: Story = {};
