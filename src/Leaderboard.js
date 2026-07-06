import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://ipsihdoyxuiifbrccayv.supabase.co";
const SUPABASE_KEY = "sb_publishable_Dn_QxDEuCOXV8zHWKg9L6g_zRu9gPGY";

const NAME_KEY = "beatpress:playerName";

export class Leaderboard {
  constructor() {
    try {
      this.client = createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (err) {
      console.warn("Leaderboard disabled:", err);
      this.client = null;
    }
  }

  getName() {
    let name = null;
    try {
      name = localStorage.getItem(NAME_KEY);
    } catch {}
    if (!name) {
      name = (window.prompt("Enter a name for the global leaderboard:", "") || "Anon").trim().slice(0, 24) || "Anon";
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch {}
    }
    return name;
  }

  async submit(result) {
    if (!this.client || !result?.completed) return;
    try {
      await this.client.from("scores").insert({
        player_name: this.getName(),
        level_id: String(result.levelId),
        level_title: result.levelTitle || null,
        accuracy: typeof result.accuracy === "number" ? result.accuracy : null,
        grade: result.grade || null,
        max_combo: result.maxCombo ?? null,
      });
    } catch (err) {
      console.warn("Score submit failed:", err);
    }
  }

  async top(levelId, limit = 5) {
    if (!this.client) return [];
    try {
      const { data, error } = await this.client
        .from("scores")
        .select("player_name, accuracy, grade, max_combo")
        .eq("level_id", String(levelId))
        .order("accuracy", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.warn("Leaderboard fetch failed:", err);
      return [];
    }
  }
}
