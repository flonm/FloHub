import { el } from "./dom";

/** One tooltip per bar, for every element with a data-tip, shown on hover after a beat and on focus at once. */
export class Tooltip {
  readonly element = el("div", { class: "tooltip", role: "tooltip", "aria-hidden": "true" });
  private target: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** @param root The shadow root whose elements it explains. */
  watch(root: ShadowRoot): void {
    root.addEventListener("pointerover", (event) => this.enter(event.target, 250));
    root.addEventListener("pointerout", (event) => {
      const next = (event as PointerEvent).relatedTarget;
      if (!(next instanceof Node) || !this.target?.contains(next)) this.hide();
    });
    root.addEventListener("focusin", (event) => this.enter(event.target, 0));
    root.addEventListener("focusout", () => this.hide());
    root.addEventListener("pointerdown", () => this.hide());
  }

  hide(): void {
    clearTimeout(this.timer);
    this.target = null;
    this.element.classList.remove("shown");
  }

  private enter(from: EventTarget | null, delay: number): void {
    const target = from instanceof Element ? from.closest<HTMLElement>("[data-tip]") : null;
    if (!target || target === this.target) return;
    this.hide();
    this.target = target;
    this.timer = setTimeout(() => this.show(target), delay);
  }

  private show(target: HTMLElement): void {
    if (!target.isConnected || this.target !== target) return;
    this.element.textContent = target.dataset.tip ?? "";
    const box = target.getBoundingClientRect();
    this.element.classList.add("shown");
    const tip = this.element.getBoundingClientRect();
    const left = Math.min(Math.max(8, box.left + box.width / 2 - tip.width / 2), innerWidth - tip.width - 8);
    const above = box.top - tip.height - 6;
    this.element.style.left = `${left}px`;
    this.element.style.top = `${above > 8 ? above : box.bottom + 6}px`;
  }
}
