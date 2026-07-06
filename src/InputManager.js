export class InputManager {
  constructor(onKeyInput) {
    this.onKeyInput = onKeyInput;
    this.enabled = false;
    this.keyHandler = this.#handleKeyDown.bind(this);
    this.pointerHandler = this.#handlePointerDown.bind(this);
  }

  start() {
    if (this.enabled) return;
    this.enabled = true;
    window.addEventListener("keydown", this.keyHandler, true);
    window.addEventListener("pointerdown", this.pointerHandler, true);
  }

  stop() {
    if (!this.enabled) return;
    this.enabled = false;
    window.removeEventListener("keydown", this.keyHandler, true);
    window.removeEventListener("pointerdown", this.pointerHandler, true);
  }

  #handleKeyDown(event) {
    if (event.repeat) return;
    const target = event.target;
    const isFormControl =
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement;
    if (isFormControl) return;
    event.preventDefault();
    this.onKeyInput(event);
  }

  #handlePointerDown(event) {
    if (event.button && event.button !== 0) return;
    const target = event.target;
    const isControl =
      target instanceof HTMLButtonElement ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      target?.closest?.("button, input, select, textarea, label");
    if (isControl) return;
    event.preventDefault();
    this.onKeyInput({ key: "Pointer", pointerType: event.pointerType || "mouse", preventDefault() {} });
  }
}
