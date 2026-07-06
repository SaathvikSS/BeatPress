// Drives the login / sign-up modal and the account status bar. Sign-up is a
// two-step flow: username + password first, then a unique display-name prompt.
export class AuthUI {
  constructor(account) {
    this.account = account;
    this.pending = null; // { username, password } captured on signup step 1

    this.el = {
      overlay: document.getElementById("authOverlay"),
      close: document.getElementById("authCloseButton"),
      title: document.getElementById("authTitle"),
      error: document.getElementById("authError"),

      loginForm: document.getElementById("loginForm"),
      loginUser: document.getElementById("loginUser"),
      loginPass: document.getElementById("loginPass"),
      toSignup: document.getElementById("toSignupButton"),

      signupForm: document.getElementById("signupForm"),
      signupUser: document.getElementById("signupUser"),
      signupPass: document.getElementById("signupPass"),
      toLogin: document.getElementById("toLoginButton"),

      displayForm: document.getElementById("displayNameForm"),
      signupDisplay: document.getElementById("signupDisplay"),
      backToSignup: document.getElementById("backToSignupButton"),

      status: document.getElementById("accountStatus"),
      loginButton: document.getElementById("accountLoginButton"),
      logoutButton: document.getElementById("accountLogoutButton"),
    };

    this.#bind();
    this.account.onChange(() => this.#renderStatus());
    this.#renderStatus();
  }

  #bind() {
    this.el.loginButton?.addEventListener("click", () => this.open("login"));
    this.el.logoutButton?.addEventListener("click", () => this.account.logout());
    this.el.close?.addEventListener("click", () => this.close());
    this.el.overlay?.addEventListener("click", (event) => {
      if (event.target === this.el.overlay) this.close();
    });

    this.el.toSignup?.addEventListener("click", () => this.#showPanel("signup"));
    this.el.toLogin?.addEventListener("click", () => this.#showPanel("login"));
    this.el.backToSignup?.addEventListener("click", () => this.#showPanel("signup"));

    this.el.loginForm?.addEventListener("submit", (e) => this.#onLogin(e));
    this.el.signupForm?.addEventListener("submit", (e) => this.#onSignupStep1(e));
    this.el.displayForm?.addEventListener("submit", (e) => this.#onSignupFinish(e));
  }

  open(panel = "login") {
    this.pending = null;
    this.#setError("");
    this.#showPanel(panel);
    this.el.overlay.classList.remove("is-hidden");
    (panel === "login" ? this.el.loginUser : this.el.signupUser)?.focus();
  }

  close() {
    this.el.overlay.classList.add("is-hidden");
    this.#setError("");
  }

  #showPanel(panel) {
    this.#setError("");
    this.el.loginForm.classList.toggle("is-hidden", panel !== "login");
    this.el.signupForm.classList.toggle("is-hidden", panel !== "signup");
    this.el.displayForm.classList.toggle("is-hidden", panel !== "display");
    this.el.title.textContent =
      panel === "login" ? "Log in" : panel === "signup" ? "Sign up" : "Choose a display name";
    if (panel === "display") this.el.signupDisplay?.focus();
  }

  async #onLogin(event) {
    event.preventDefault();
    this.#busy(true);
    const res = await this.account.login({
      username: this.el.loginUser.value,
      password: this.el.loginPass.value,
    });
    this.#busy(false);
    if (res.ok) {
      this.el.loginForm.reset();
      this.close();
    } else {
      this.#setError(res.error);
    }
  }

  // Step 1: hold the username/password locally, then ask for a display name.
  #onSignupStep1(event) {
    event.preventDefault();
    const username = this.el.signupUser.value.trim();
    const password = this.el.signupPass.value.trim();
    if (username.length < 3) return this.#setError("Username must be at least 3 characters.");
    if (password.length < 3) return this.#setError("Password must be at least 3 characters.");
    this.pending = { username, password };
    this.#showPanel("display");
  }

  async #onSignupFinish(event) {
    event.preventDefault();
    if (!this.pending) return this.#showPanel("signup");
    this.#busy(true);
    const res = await this.account.signup({
      username: this.pending.username,
      password: this.pending.password,
      displayName: this.el.signupDisplay.value,
    });
    this.#busy(false);
    if (res.ok) {
      this.el.signupForm.reset();
      this.el.displayForm.reset();
      this.pending = null;
      this.close();
    } else {
      this.#setError(res.error);
      // Display-name clashes should keep the player on the name step.
      if (!/display name/i.test(res.error)) this.#showPanel("signup");
    }
  }

  #busy(isBusy) {
    for (const form of [this.el.loginForm, this.el.signupForm, this.el.displayForm]) {
      form?.querySelectorAll("button, input").forEach((node) => (node.disabled = isBusy));
    }
  }

  #setError(message) {
    if (this.el.error) this.el.error.textContent = message || "";
  }

  #renderStatus() {
    const name = this.account.displayName;
    if (name) {
      this.el.status.textContent = `Playing as ${name}`;
      this.el.loginButton.classList.add("is-hidden");
      this.el.logoutButton.classList.remove("is-hidden");
    } else {
      this.el.status.textContent = "Guest — scores saved on this device only";
      this.el.loginButton.classList.remove("is-hidden");
      this.el.logoutButton.classList.add("is-hidden");
    }
  }
}
