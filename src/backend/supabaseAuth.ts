import type { Profile } from "../types";
import { pickAvatarColor } from "../utils";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

export interface SupabaseAuthIdentity {
  profile: Profile;
  email: string;
}

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  return supabase;
}

function mapProfileRow(row: {
  id: string;
  display_name: string;
  avatar_color: string | null;
  created_at: string;
  updated_at: string;
}): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarColor: row.avatar_color ?? pickAvatarColor(row.display_name),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

async function ensureProfile(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }) {
  const client = assertSupabase();
  const displayName =
    (typeof user.user_metadata?.display_name === "string" && user.user_metadata.display_name.trim()) ||
    user.email?.split("@")[0] ||
    "User";
  const avatarColor = pickAvatarColor(displayName);

  const { error: upsertError } = await client.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      display_name: displayName,
      avatar_color: avatarColor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (upsertError) throw upsertError;

  const { data, error } = await client
    .from("profiles")
    .select("id, display_name, avatar_color, created_at, updated_at, email")
    .eq("id", user.id)
    .single();
  if (error) throw error;

  return {
    profile: mapProfileRow(data),
    email: data.email ?? user.email ?? "",
  } satisfies SupabaseAuthIdentity;
}

export async function getSupabaseSessionIdentity(): Promise<SupabaseAuthIdentity | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const client = assertSupabase();
  const {
    data: { session },
    error,
  } = await client.auth.getSession();
  if (error) throw error;
  if (!session?.user) return null;
  return ensureProfile(session.user);
}

export async function supabaseSignUp(email: string, password: string, displayName: string): Promise<SupabaseAuthIdentity> {
  const client = assertSupabase();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
      },
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error("Sign-up failed");
  return ensureProfile(data.user);
}

export async function supabaseSignIn(email: string, password: string): Promise<SupabaseAuthIdentity> {
  const client = assertSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error("Sign-in failed");
  return ensureProfile(data.user);
}

export async function supabaseSignOut(): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const client = assertSupabase();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function listSupabaseProfiles(): Promise<Profile[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("profiles")
    .select("id, display_name, avatar_color, created_at, updated_at")
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapProfileRow);
}
