import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://ipsihdoyxuiifbrccayv.supabase.co";
const SUPABASE_KEY = "sb_publishable_Dn_QxDEuCOXV8zHWKg9L6g_zRu9gPGY";
const SESSION_KEY = "beatpress:account:v1";

// Casual account system: username + password are only a login handle (no
// security hardening by design), and a unique display name is what shows on
// the global leaderboards. All three must be globally unique.
export class Account {
  constructor() {
    try {
      this.client = createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (err) {
      console.warn("Account backend disabled:", err);
      this.client = null;
    }
    this.player = this.#loadSession();
    this.listeners = new Set();
  }

  get isLoggedIn() {
    return Boolean(this.player);
  }

  get displayName() {
    return this.player?.display_name || null;
  }

  get playerId() {
    return this.player?.id || null;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.listeners) {
      try {
        listener(this.player);
      } catch (err) {
        console.warn("Account listener failed:", err);
      }
    }
  }

  #loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  #saveSession() {
    try {
      if (this.player) localStorage.setItem(SESSION_KEY, JSON.stringify(this.player));
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  logout() {
    this.player = null;
    this.#saveSession();
    this.#emit();
  }

  // --- Sign up -------------------------------------------------------------
  // Step 1 validates + reserves username/password; the display name is asked
  // for immediately after and finalized in #finishSignup.
  async signup({ username, password, displayName }) {
    if (!this.client) return { ok: false, error: "Backend unavailable. Try again later." };
    username = String(username || "").trim();
    password = String(password || "").trim();
    displayName = String(displayName || "").trim();
    if (username.length < 3) return { ok: false, error: "Username must be at least 3 characters." };
    if (password.length < 3) return { ok: false, error: "Password must be at least 3 characters." };
    if (displayName.length < 2) return { ok: false, error: "Display name must be at least 2 characters." };
    if (displayName.length > 24) return { ok: false, error: "Display name must be 24 characters or fewer." };

    // Pre-check the three unique fields so we can give a specific message.
    try {
      const { data: clashes, error } = await this.client
        .from("players")
        .select("username, password, display_name")
        .or(
          `username.eq.${username},password.eq.${password},display_name.eq.${displayName}`,
        );
      if (error) throw error;
      for (const row of clashes || []) {
        if (row.username === username) return { ok: false, error: "That username is already taken." };
        if (row.password === password) return { ok: false, error: "That password is already in use. Pick another." };
        if (row.display_name === displayName) return { ok: false, error: "That display name is already taken." };
      }
    } catch (err) {
      console.warn("Signup precheck failed:", err);
      return { ok: false, error: "Could not reach the account server." };
    }

    try {
      const { data, error } = await this.client
        .from("players")
        .insert({ username, password, display_name: displayName })
        .select("id, username, display_name")
        .single();
      if (error) throw error;
      this.player = data;
      this.#saveSession();
      this.#emit();
      return { ok: true, player: data };
    } catch (err) {
      // Unique-violation race fallback.
      const message = String(err?.message || "").toLowerCase();
      if (message.includes("display_name")) return { ok: false, error: "That display name is already taken." };
      if (message.includes("password")) return { ok: false, error: "That password is already in use. Pick another." };
      if (message.includes("username")) return { ok: false, error: "That username is already taken." };
      console.warn("Signup failed:", err);
      return { ok: false, error: "Sign up failed. Try again." };
    }
  }

  // --- Log in --------------------------------------------------------------
  async login({ username, password }) {
    if (!this.client) return { ok: false, error: "Backend unavailable. Try again later." };
    username = String(username || "").trim();
    password = String(password || "").trim();
    if (!username || !password) return { ok: false, error: "Enter your username and password." };
    try {
      const { data, error } = await this.client
        .from("players")
        .select("id, username, display_name")
        .eq("username", username)
        .eq("password", password)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { ok: false, error: "Wrong username or password." };
      this.player = data;
      this.#saveSession();
      this.#emit();
      return { ok: true, player: data };
    } catch (err) {
      console.warn("Login failed:", err);
      return { ok: false, error: "Could not reach the account server." };
    }
  }

  // --- Progress ------------------------------------------------------------
  // Count an attempt for the logged-in player on a level (tries++).
  async recordTry(levelId) {
    if (!this.client || !this.player) return;
    try {
      await this.client.rpc("bump_tries", { p_player: this.player.id, p_level: String(levelId) });
    } catch (err) {
      console.warn("recordTry failed:", err);
    }
  }

  // Upsert a completed run's best accuracy for the logged-in player.
  async recordResult(levelId, result) {
    if (!this.client || !this.player || !result?.completed) return;
    try {
      await this.client.rpc("record_best", {
        p_player: this.player.id,
        p_level: String(levelId),
        p_accuracy: typeof result.accuracy === "number" ? result.accuracy : 0,
        p_grade: result.grade || null,
        p_combo: result.maxCombo ?? 0,
      });
    } catch (err) {
      console.warn("recordResult failed:", err);
    }
  }

  // This player's best accuracy + tries for a single level.
  async myProgress(levelId) {
    if (!this.client || !this.player) return null;
    try {
      const { data, error } = await this.client
        .from("progress")
        .select("best_accuracy, best_grade, best_combo, tries")
        .eq("player_id", this.player.id)
        .eq("level_id", String(levelId))
        .maybeSingle();
      if (error) throw error;
      return data || null;
    } catch (err) {
      console.warn("myProgress failed:", err);
      return null;
    }
  }

  // Global top-N by accuracy for a level.
  async topScores(levelId, limit = 5) {
    if (!this.client) return [];
    try {
      const { data, error } = await this.client.rpc("top_scores", {
        p_level: String(levelId),
        p_limit: limit,
      });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.warn("topScores failed:", err);
      return [];
    }
  }
}
