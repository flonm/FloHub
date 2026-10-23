import { el, icon } from "./dom";

/** One choice of a picker. */
export interface PickerOption {
  value: string;
  /** The choice in words, for screen readers and for the button once picked. */
  label: string;
  /** Draws the choice in the list: anything richer than its label. */
  content: () => Node[];
  /** Leaves the choice out of reach. */
  disabled?: boolean;
}

/**
 * A dropdown whose choices can show more than text, such as a version's reviewers and their verdicts: a button
 * that names the picked choice, and a list under it that opens on a click, Enter, Space or the down arrow. In the
 * list the arrows, Home and End move, Enter or Space picks, and Escape or Tab closes it.
 */
export class Picker {
  readonly element: HTMLElement;
  readonly button: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly face: HTMLElement;
  private options: PickerOption[] = [];
  private picked = "";
  private release: (() => void) | null = null;

  /**
   * @param name What it picks, e.g. "From", which names the button.
   * @param onChange Called with the value the viewer picked.
   * @param show Draws the picked choice on the button.
   */
  constructor(
    private readonly name: string,
    private readonly onChange: (value: string) => void,
    private readonly show: (option: PickerOption | undefined) => Node[],
  ) {
    this.element = el("span", { class: "picker", "data-picker": name });
    this.button = el("button", { type: "button", class: "version-pick", "aria-haspopup": "listbox", "aria-expanded": "false" });
    this.face = el("span", { class: "pick-words" });
    this.button.append(el("span", { class: "pick-name", "aria-hidden": "true" }, name), this.face, icon("chevron"));
    this.list = el("ul", { class: "picker-list", role: "listbox", "aria-label": name, tabindex: "-1", hidden: "" });
    this.element.append(this.button, this.list);
    this.button.addEventListener("click", () => this.toggle(!this.isOpen));
    this.button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      this.toggle(true);
    });
    this.list.addEventListener("keydown", (event) => this.onKey(event));
  }

  /** @returns Whether the list is showing. */
  get isOpen(): boolean {
    return this.list.hidden === false;
  }

  /** @returns The picked value. */
  get value(): string {
    return this.picked;
  }

  /** @param value The value to show as picked, without telling onChange. */
  set value(value: string) {
    this.picked = value;
    this.draw();
    for (const item of this.items()) item.setAttribute("aria-selected", String(item.dataset.value === value));
  }

  /**
   * @param options The choices, in order.
   * @param value The one picked.
   */
  setOptions(options: PickerOption[], value: string): void {
    this.options = options;
    this.value = value;
    this.fill();
  }

  /** @param disabled Whether each choice is out of reach, by its value. */
  disable(disabled: (value: string) => boolean): void {
    for (const option of this.options) option.disabled = disabled(option.value);
    this.fill();
  }

  /** Closes the list, leaving the focus where it is. */
  close(): void {
    if (!this.isOpen) return;
    this.list.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    this.release?.();
    this.release = null;
  }

  private draw(): void {
    const option = this.options.find((entry) => entry.value === this.picked);
    this.face.replaceChildren(...this.show(option));
    this.button.dataset.value = this.picked;
    this.button.setAttribute("aria-label", `${this.name}: ${option?.label ?? ""}`);
  }

  private toggle(open: boolean): void {
    if (!open) {
      this.close();
      return;
    }
    this.fill();
    this.list.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.place();
    const outside = (event: Event) => {
      if (!event.composedPath().includes(this.element)) this.close();
    };
    const away = (event: Event) => {
      // The list scrolls itself when it is long; any other scroll moves the button from under it.
      if (!event.composedPath().includes(this.list)) this.close();
    };
    addEventListener("pointerdown", outside, true);
    addEventListener("scroll", away, true);
    addEventListener("resize", away);
    this.release = () => {
      removeEventListener("pointerdown", outside, true);
      removeEventListener("scroll", away, true);
      removeEventListener("resize", away);
    };
    (this.items().find((item) => item.getAttribute("aria-selected") === "true") ?? this.enabled()[0])?.focus();
  }

  private fill(): void {
    this.list.replaceChildren(
      ...this.options.map((option) => {
        const item = el("li", {
          role: "option",
          tabindex: "-1",
          "data-value": option.value,
          "aria-selected": String(option.value === this.picked),
          "aria-label": option.label,
        });
        if (option.disabled) item.setAttribute("aria-disabled", "true");
        item.append(...option.content());
        item.addEventListener("click", () => this.choose(option));
        return item;
      }),
    );
  }

  /** Puts the list under the button, or above it when the window has no room below, and inside the window. */
  private place(): void {
    const box = this.button.getBoundingClientRect();
    const height = Math.min(this.list.scrollHeight, 360);
    const below = innerHeight - box.bottom - 8;
    this.list.style.maxHeight = `${Math.max(160, Math.min(360, below >= height || below >= box.top ? below : box.top - 8))}px`;
    const top = below >= height || below >= box.top ? box.bottom + 4 : box.top - 4 - Math.min(height, box.top - 8);
    this.list.style.top = `${top}px`;
    this.list.style.left = `${Math.max(8, Math.min(box.left, innerWidth - this.list.offsetWidth - 8))}px`;
  }

  private choose(option: PickerOption): void {
    if (option.disabled) return;
    this.close();
    this.button.focus();
    if (option.value === this.picked) return;
    this.value = option.value;
    this.onChange(option.value);
  }

  private onKey(event: KeyboardEvent): void {
    const enabled = this.enabled();
    const at = enabled.indexOf(event.target as HTMLElement);
    const move = (index: number) => enabled[Math.max(0, Math.min(enabled.length - 1, index))]?.focus();
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) event.preventDefault();
    switch (event.key) {
      case "ArrowDown": {
        move(at + 1);
        return;
      }
      case "ArrowUp": {
        move(at - 1);
        return;
      }
      case "Home": {
        move(0);
        return;
      }
      case "End": {
        move(enabled.length - 1);
        return;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        const option = this.options.find((entry) => entry.value === (event.target as HTMLElement).dataset.value);
        if (option) this.choose(option);
        return;
      }
      case "Escape": {
        // The view closes on an Escape nobody handled, so this one stops here.
        event.preventDefault();
        this.close();
        this.button.focus();
        return;
      }
      case "Tab": {
        this.close();
        break;
      }
      default:
    }
  }

  private items(): HTMLElement[] {
    return [...this.list.querySelectorAll<HTMLElement>("[role=option]")];
  }

  private enabled(): HTMLElement[] {
    return this.items().filter((item) => item.getAttribute("aria-disabled") !== "true");
  }
}
