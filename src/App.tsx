import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getSupabaseSessionIdentity,
  supabaseSignIn,
  supabaseSignOut,
  supabaseSignUp,
} from "./backend/supabaseAuth";
import { isSupabaseConfigured } from "./backend/supabaseClient";
import { ChatRepository } from "./storage/repository";
import { SyncBus } from "./storage/syncBus";
import type { Chat, ChatListItem, MessageWithAttachments, Profile } from "./types";
import { formatBytes, formatDateTime, formatTime, navigateHome, navigateToChat, readHash } from "./utils";

type DialogKind = null | "createProfile" | "createDm" | "createGroup" | "addMembers" | "viewMembers";

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}

const syncBus = new SyncBus();
const repo = new ChatRepository(syncBus);

export default function App() {
  const [ready, setReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [chatItems, setChatItems] = useState<ChatListItem[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chatMembers, setChatMembers] = useState<Profile[]>([]);
  const [messages, setMessages] = useState<MessageWithAttachments[]>([]);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [toasts, setToasts] = useState<Array<{ id: string; text: string; tone?: "error" | "info" }>>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        await repo.init();
        if (isSupabaseConfigured) {
          const identity = await getSupabaseSessionIdentity();
          if (identity) {
            repo.setActiveProfileId(identity.profile.id);
            repo.setAuthenticatedProfileId(identity.profile.id);
          } else {
            repo.setAuthenticatedProfileId(null);
          }
        }
        const prefs = repo.getPreferences();
        if (cancelled) return;
        setActiveProfileId(repo.getAuthenticatedProfileId() ?? prefs.activeProfileId);
        setIsAuthenticated(Boolean(repo.getAuthenticatedProfileId()));
        setReady(true);
      } catch (e) {
        setError(toMessage(e, "Failed to initialize app"));
      }
    }
    void boot();

    const onHash = () => setRefreshTick((v) => v + 1);
    const unsubscribe = syncBus.subscribe(() => setRefreshTick((v) => v + 1));
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    async function loadShell() {
      try {
        const nextProfiles = await repo.getProfiles();
        if (cancelled) return;
        setProfiles(nextProfiles);

        // Local mode uses one browser account; Supabase mode keeps the authenticated account id.
        let currentProfileId = isSupabaseConfigured
          ? nextProfiles.some((p) => p.id === activeProfileId)
            ? activeProfileId
            : nextProfiles[0]?.id ?? null
          : nextProfiles[0]?.id ?? null;
        if (currentProfileId && currentProfileId !== activeProfileId) {
          repo.setActiveProfileId(currentProfileId);
          setActiveProfileId(currentProfileId);
        }
        if (!currentProfileId) {
          setChatItems([]);
          setSelectedChatId(null);
          setSelectedChat(null);
          setMessages([]);
          setChatMembers([]);
          return;
        }

        if (!isAuthenticated) {
          setChatItems([]);
          setSelectedChatId(null);
          setSelectedChat(null);
          setMessages([]);
          setChatMembers([]);
          return;
        }

        const visible = await repo.getVisibleChatsForProfile(currentProfileId);
        if (cancelled) return;
        setChatItems(visible);

        const route = readHash();
        let nextChatId: string | null = null;
        if (route.route === "chat" && route.chatId) {
          const canAccess = await repo.canProfileAccessChat(currentProfileId, route.chatId);
          if (canAccess) nextChatId = route.chatId;
        }
        if (!nextChatId) {
          nextChatId = repo.getSelectedChatForProfile(currentProfileId);
          if (nextChatId) {
            const canAccess = await repo.canProfileAccessChat(currentProfileId, nextChatId);
            if (!canAccess) nextChatId = null;
          }
        }

        const visibleIds = new Set(visible.map((item) => item.chat.id));
        if (nextChatId && !visibleIds.has(nextChatId)) {
          nextChatId = null;
        }
        setSelectedChatId(nextChatId);
        if (!nextChatId) {
          setSelectedChat(null);
          setMessages([]);
          setChatMembers([]);
          if (window.location.hash && readHash().route === "chat") navigateHome();
          return;
        }

        repo.setSelectedChatForProfile(currentProfileId, nextChatId);
        if (readHash().route !== "chat" || readHash().chatId !== nextChatId) {
          navigateToChat(nextChatId);
        }

        const [chat, members, msgs] = await Promise.all([
          repo.getChat(nextChatId),
          repo.getChatMembers(nextChatId),
          repo.getMessages(nextChatId),
        ]);
        if (cancelled) return;
        setSelectedChat(chat);
        setChatMembers(members);
        setMessages(msgs);
      } catch (e) {
        if (!cancelled) {
          setError(toMessage(e, "Failed to load data"));
        }
      }
    }

    void loadShell();
    return () => {
      cancelled = true;
    };
  }, [ready, activeProfileId, isAuthenticated, refreshTick]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    if (!ready || !isAuthenticated || !isSupabaseConfigured) return;
    const timer = window.setInterval(() => {
      setRefreshTick((v) => v + 1);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [ready, isAuthenticated]);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;
  const dmItems = chatItems.filter((item) => item.chat.type === "dm");
  const groupItems = chatItems.filter((item) => item.chat.type === "group");
  const profileNameById = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p.displayName])),
    [profiles],
  );

  function toast(text: string, tone: "error" | "info" = "info") {
    setToasts((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, text, tone }]);
  }

  function handleSelectChat(chatId: string) {
    if (!activeProfileId) return;
    repo.setSelectedChatForProfile(activeProfileId, chatId);
    setSelectedChatId(chatId);
    navigateToChat(chatId);
    setRefreshTick((v) => v + 1);
  }

  async function handleCreateProfile(name: string) {
    try {
      if (profiles.length > 0) {
        toast("This build supports one local account per device.", "error");
        return;
      }
      const profile = await repo.createProfile(name);
      repo.setActiveProfileId(profile.id);
      setActiveProfileId(profile.id);
      setDialog(null);
      toast(`Profile "${profile.displayName}" created`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to create profile", "error");
    }
  }

  async function handleSignUp(name: string, password: string) {
    try {
      let profile: Profile;
      if (isSupabaseConfigured) {
        throw new Error("Email is required for Supabase sign up");
      } else {
        profile = await repo.signUpLocalAccount(name, password);
      }
      setActiveProfileId(profile.id);
      setIsAuthenticated(true);
      setRefreshTick((v) => v + 1);
      toast(`Account "${profile.displayName}" created`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to sign up", "error");
      throw e;
    }
  }

  async function handleSignUpWithEmail(name: string, email: string, password: string) {
    try {
      if (!isSupabaseConfigured) {
        throw new Error("Supabase is not configured in this build.");
      }
      const result = await supabaseSignUp(email, password, name);
      if (result.requiresEmailConfirmation || !result.identity) {
        toast("Sign-up successful. Check your email to confirm, then sign in.", "info");
        return;
      }
      repo.setActiveProfileId(result.identity.profile.id);
      repo.setAuthenticatedProfileId(result.identity.profile.id);
      const profile = result.identity.profile;
      setActiveProfileId(profile.id);
      setIsAuthenticated(true);
      setRefreshTick((v) => v + 1);
      toast(`Account "${profile.displayName}" created`);
    } catch (e) {
      toast(toMessage(e, "Failed to sign up"), "error");
      throw e;
    }
  }

  async function handleSignIn(password: string) {
    try {
      let profile: Profile;
      if (isSupabaseConfigured) {
        throw new Error("Email is required for Supabase sign in");
      } else {
        profile = await repo.signInLocalAccount(password);
      }
      setActiveProfileId(profile.id);
      setIsAuthenticated(true);
      setRefreshTick((v) => v + 1);
      toast(`Signed in as ${profile.displayName}`);
    } catch (e) {
      toast(toMessage(e, "Failed to sign in"), "error");
      throw e;
    }
  }

  async function handleSignInWithEmail(email: string, password: string) {
    try {
      if (!isSupabaseConfigured) {
        throw new Error("Supabase is not configured in this build.");
      }
      const identity = await supabaseSignIn(email, password);
      repo.setActiveProfileId(identity.profile.id);
      repo.setAuthenticatedProfileId(identity.profile.id);
      const profile = identity.profile;
      setActiveProfileId(profile.id);
      setIsAuthenticated(true);
      setRefreshTick((v) => v + 1);
      toast(`Signed in as ${profile.displayName}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to sign in", "error");
      throw e;
    }
  }

  async function handleSetPassword(password: string) {
    try {
      const profile = await repo.setPasswordForExistingLocalAccount(password);
      setActiveProfileId(profile.id);
      setIsAuthenticated(true);
      setRefreshTick((v) => v + 1);
      toast("Password set. You are signed in.");
    } catch (e) {
      toast(toMessage(e, "Failed to set password"), "error");
      throw e;
    }
  }

  function handleSignOut() {
    const run = async () => {
      if (isSupabaseConfigured) {
        await supabaseSignOut();
      }
      repo.signOut();
      setIsAuthenticated(false);
      setSelectedChatId(null);
      setSelectedChat(null);
      setMessages([]);
      setChatMembers([]);
      navigateHome();
      toast("Signed out");
    };
    void run().catch((e) => {
      toast(e instanceof Error ? e.message : "Sign out failed", "error");
    });
  }

  async function handleCreateDm(otherProfileId: string) {
    if (!activeProfileId) return;
    try {
      const chat = await repo.createDm(activeProfileId, otherProfileId);
      setDialog(null);
      handleSelectChat(chat.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to create DM", "error");
    }
  }

  async function handleCreateGroup(title: string, memberIds: string[]) {
    if (!activeProfileId) return;
    try {
      const chat = await repo.createGroup({
        title,
        ownerProfileId: activeProfileId,
        memberProfileIds: memberIds,
      });
      setDialog(null);
      handleSelectChat(chat.id);
      toast("Group created");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to create group", "error");
    }
  }

  async function handleAddMembers(memberIds: string[]) {
    if (!selectedChat || !activeProfileId) return;
    try {
      await repo.addGroupMembers(selectedChat.id, activeProfileId, memberIds);
      setDialog(null);
      toast("Members added");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to add members", "error");
    }
  }

  async function handleLeaveGroup() {
    if (!selectedChat || selectedChat.type !== "group" || !activeProfileId) return;
    try {
      await repo.leaveGroup(selectedChat.id, activeProfileId);
      repo.setSelectedChatForProfile(activeProfileId, null);
      setSelectedChatId(null);
      setSelectedChat(null);
      setMessages([]);
      setChatMembers([]);
      navigateHome();
      toast("You left the group");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to leave group", "error");
    }
  }

  async function handleSendMessage(text: string, files: File[]) {
    if (!selectedChat || !activeProfileId) return;
    try {
      await repo.sendMessage({
        chatId: selectedChat.id,
        senderProfileId: activeProfileId,
        text,
        files,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to send message", "error");
      throw e;
    }
  }

  if (error) {
    const looksLikeStorageIssue =
      /indexeddb|localstorage|quota|storage/i.test(error);
    return (
      <div className="app-error">
        <h1>{looksLikeStorageIssue ? "Storage Error" : "Initialization Error"}</h1>
        <p>{error}</p>
        {looksLikeStorageIssue ? (
          <p>This app requires browser storage (IndexedDB/localStorage) to be enabled.</p>
        ) : isSupabaseConfigured ? (
          <p>
            If you are using Supabase, verify you ran <code>supabase/schema.sql</code> and created the
            <code> chat-files </code> storage bucket.
          </p>
        ) : null}
      </div>
    );
  }

  if (!ready) {
    return <div className="loading-screen">Loading local chats...</div>;
  }

  if (!isAuthenticated) {
    return (
      <>
        <AuthGate
          existingProfile={profiles[0] ?? null}
          onSignUp={handleSignUp}
          onSignUpWithEmail={handleSignUpWithEmail}
          onSignIn={handleSignIn}
          onSignInWithEmail={handleSignInWithEmail}
          onSetPassword={handleSetPassword}
          useSupabaseAuth={isSupabaseConfigured}
        />
        <div className="toast-stack" aria-live="polite">
          {toasts.map((item) => (
            <div key={item.id} className={`toast ${item.tone === "error" ? "toast-error" : ""}`}>
              {item.text}
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <div className="brand">Local Texting</div>
            <div className="brand-subtle">Frontend + storage only</div>
          </div>
          <button className="ghost-btn" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>

        <div className="profile-card">
          <label className="label">Account</label>
          {activeProfile ? (
            <div className="member-row">
              <span className="avatar-dot" style={{ backgroundColor: activeProfile.avatarColor }} />
              <div>
                <div>{activeProfile.displayName}</div>
                <div className="brand-subtle">This device account</div>
              </div>
            </div>
          ) : (
            <div className="sidebar-empty">
              No authenticated account.
            </div>
          )}
        </div>

        <SidebarSection
          title="DMs"
          emptyText="No DMs yet"
          items={dmItems}
          selectedChatId={selectedChatId}
          onSelectChat={handleSelectChat}
          onCreate={() => setDialog("createDm")}
        />
        <SidebarSection
          title="Groups"
          emptyText="No group chats yet"
          items={groupItems}
          selectedChatId={selectedChatId}
          onSelectChat={handleSelectChat}
          onCreate={() => setDialog("createGroup")}
        />
      </aside>

      <main className="main-panel">
        {!selectedChat || !activeProfile ? (
          <div className="empty-state">
            <h2>No chat selected</h2>
            <p>
              {activeProfile
                ? "Select a DM or group from the sidebar to start messaging."
                : "Create an account on this device to start."}
            </p>
          </div>
        ) : (
          <ChatView
            chat={selectedChat}
            members={chatMembers}
            messages={messages}
            activeProfileId={activeProfile.id}
            activeProfileName={activeProfile.displayName}
            profileNameById={profileNameById}
            onSend={handleSendMessage}
            onViewMembers={() => setDialog("viewMembers")}
            onAddMembers={() => setDialog("addMembers")}
            onLeaveGroup={handleLeaveGroup}
            quotaInfo={repo.limits}
          />
        )}
      </main>

      {dialog === "createDm" && activeProfileId && (
        <CreateDmDialog
          profiles={profiles.filter((p) => p.id !== activeProfileId)}
          onClose={() => setDialog(null)}
          onSubmit={handleCreateDm}
        />
      )}
      {dialog === "createGroup" && activeProfileId && (
        <CreateGroupDialog
          profiles={profiles.filter((p) => p.id !== activeProfileId)}
          onClose={() => setDialog(null)}
          onSubmit={handleCreateGroup}
        />
      )}
      {dialog === "addMembers" && selectedChat?.type === "group" && (
        <AddMembersDialog chatId={selectedChat.id} onClose={() => setDialog(null)} onSubmit={handleAddMembers} />
      )}
      {dialog === "viewMembers" && selectedChat?.type === "group" && (
        <MembersDialog members={chatMembers} onClose={() => setDialog(null)} />
      )}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.tone === "error" ? "toast-error" : ""}`}>
            {item.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthGate(props: {
  existingProfile: Profile | null;
  onSignUp: (name: string, password: string) => Promise<void>;
  onSignUpWithEmail: (name: string, email: string, password: string) => Promise<void>;
  onSignIn: (password: string) => Promise<void>;
  onSignInWithEmail: (email: string, password: string) => Promise<void>;
  onSetPassword: (password: string) => Promise<void>;
  useSupabaseAuth: boolean;
}) {
  const hasAccount = Boolean(props.existingProfile);
  const hasLocalAccount = Boolean(props.existingProfile);
  const needsPasswordSetup = Boolean(!props.useSupabaseAuth && props.existingProfile && !props.existingProfile.passwordHash);
  const [mode, setMode] = useState<"signup" | "signin" | "setup">(
    props.useSupabaseAuth ? "signin" : !hasLocalAccount ? "signup" : needsPasswordSetup ? "setup" : "signin",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setMode(
      props.useSupabaseAuth
        ? "signin"
        : !props.existingProfile
          ? "signup"
          : !props.existingProfile.passwordHash
            ? "setup"
            : "signin",
    );
  }, [props.existingProfile, props.useSupabaseAuth]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      if (mode === "signup") {
        if (!name.trim()) throw new Error("Enter an account name");
        if (password.length < 6) throw new Error("Password must be at least 6 characters");
        if (password !== confirmPassword) throw new Error("Passwords do not match");
        if (props.useSupabaseAuth) {
          if (!email.trim()) throw new Error("Enter your email");
          await props.onSignUpWithEmail(name, email.trim(), password);
        } else {
          await props.onSignUp(name, password);
        }
      } else if (mode === "setup") {
        if (password.length < 6) throw new Error("Password must be at least 6 characters");
        if (password !== confirmPassword) throw new Error("Passwords do not match");
        await props.onSetPassword(password);
      } else {
        if (!password) throw new Error("Enter your password");
        if (props.useSupabaseAuth) {
          if (!email.trim()) throw new Error("Enter your email");
          await props.onSignInWithEmail(email.trim(), password);
        } else {
          await props.onSignIn(password);
        }
      }
    } catch (error) {
      setLocalError(toMessage(error, "Authentication failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <div className="brand">Local Texting</div>
          <p className="brand-subtle">
            {props.useSupabaseAuth
              ? "Sign in or sign up with your Supabase account"
              : hasAccount
                ? needsPasswordSetup
                  ? `Set a password for ${props.existingProfile?.displayName}`
                  : `Sign in to ${props.existingProfile?.displayName}`
                : "Create an account for this browser/device"}
          </p>
        </div>

        {props.useSupabaseAuth ? (
          <div className="auth-tabs">
            <button
              className={`ghost-btn ${mode === "signup" ? "active-tab" : ""}`}
              onClick={() => setMode("signup")}
              type="button"
            >
              Sign Up
            </button>
            <button
              className={`ghost-btn ${mode === "signin" ? "active-tab" : ""}`}
              onClick={() => setMode("signin")}
              type="button"
            >
              Sign In
            </button>
          </div>
        ) : !hasLocalAccount ? (
          <div className="auth-tabs auth-single-tab">
            <button className="ghost-btn active-tab" type="button">
              Sign Up
            </button>
          </div>
        ) : !needsPasswordSetup ? (
          <div className="auth-tabs auth-single-tab">
            <button className="ghost-btn active-tab" type="button">
              Sign In
            </button>
          </div>
        ) : null}

        <form onSubmit={(e) => void submit(e)} className="auth-form">
          {mode === "signup" ? (
            <>
              <label className="label">Account name</label>
              <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
              {props.useSupabaseAuth && (
                <>
                  <label className="label">Email</label>
                  <input
                    className="text-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </>
              )}
              <label className="label">Password</label>
              <input
                className="text-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <label className="label">Confirm password</label>
              <input
                className="text-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </>
          ) : mode === "setup" ? (
            <>
              <label className="label">Account</label>
              <div className="member-row">
                <span
                  className="avatar-dot"
                  style={{ backgroundColor: props.existingProfile?.avatarColor ?? "#0ea5e9" }}
                />
                {props.existingProfile?.displayName ?? "Local Account"}
              </div>
              <label className="label">New password</label>
              <input
                className="text-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <label className="label">Confirm password</label>
              <input
                className="text-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </>
          ) : props.useSupabaseAuth ? (
            <>
              <label className="label">Email</label>
              <input
                className="text-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <label className="label">Password</label>
              <input
                className="text-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </>
          ) : (
            <>
              <label className="label">Account</label>
              <div className="member-row">
                <span
                  className="avatar-dot"
                  style={{ backgroundColor: props.existingProfile?.avatarColor ?? "#0ea5e9" }}
                />
                {props.existingProfile?.displayName ?? "Local Account"}
              </div>
              <label className="label">Password</label>
              <input
                className="text-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </>
          )}
          <button className="send-btn auth-submit" type="submit" disabled={submitting}>
            {submitting
              ? "Please wait..."
              : mode === "signup"
                ? "Create Account"
                : mode === "setup"
                  ? "Set Password"
                  : "Sign In"}
          </button>
          {localError && <div className="auth-error">{localError}</div>}
          <p className="auth-note">
            {props.useSupabaseAuth
              ? "Supabase auth is enabled. Profiles can be shared across browsers/devices."
              : "GitHub Pages can host this frontend, but real cross-device messaging/accounts require a backend service."}
          </p>
        </form>
      </div>
    </div>
  );
}

function SidebarSection(props: {
  title: string;
  emptyText: string;
  items: ChatListItem[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onCreate: () => void;
}) {
  const { title, emptyText, items, selectedChatId, onSelectChat, onCreate } = props;
  return (
    <section className="sidebar-section">
      <div className="sidebar-section-header">
        <h3>{title}</h3>
        <button className="ghost-btn small" onClick={onCreate}>
          + New
        </button>
      </div>
      {items.length === 0 ? (
        <div className="sidebar-empty">{emptyText}</div>
      ) : (
        <ul className="chat-list">
          {items.map((item) => (
            <li key={item.chat.id}>
              <button
                className={`chat-row ${selectedChatId === item.chat.id ? "active" : ""}`}
                onClick={() => onSelectChat(item.chat.id)}
              >
                <div className="chat-row-title">{item.title}</div>
                <div className="chat-row-subtitle">{item.subtitle}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChatView(props: {
  chat: Chat;
  members: Profile[];
  messages: MessageWithAttachments[];
  activeProfileId: string;
  activeProfileName: string;
  profileNameById: Record<string, string>;
  onSend: (text: string, files: File[]) => Promise<void>;
  onViewMembers: () => void;
  onAddMembers: () => void;
  onLeaveGroup: () => void;
  quotaInfo: { maxFileBytes: number; maxTotalBytes: number };
}) {
  const {
    chat,
    members,
    messages,
    activeProfileId,
    profileNameById,
    onSend,
    onViewMembers,
    onAddMembers,
    onLeaveGroup,
    quotaInfo,
  } = props;
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const title = useMemo(() => {
    if (chat.type === "group") return chat.title ?? "Group";
    const other = members.find((m) => m.id !== activeProfileId);
    return other?.displayName ?? "DM";
  }, [chat, members, activeProfileId]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [messages.length, chat.id]);

  return (
    <div className="chat-view">
      <header className="chat-header">
        <div>
          <h2>{title}</h2>
          <p>
            {chat.type === "group"
              ? `${members.length} member${members.length === 1 ? "" : "s"}`
              : "Direct message"}
          </p>
        </div>
        {chat.type === "group" && (
          <div className="header-actions">
            <button className="ghost-btn" onClick={onViewMembers}>
              Members
            </button>
            <button className="ghost-btn" onClick={onAddMembers}>
              Add People
            </button>
            <button className="ghost-btn danger" onClick={onLeaveGroup}>
              Leave
            </button>
          </div>
        )}
      </header>

      <div className="message-list" ref={scrollerRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">No messages yet.</div>
        ) : (
          messages.map((message) =>
            message.type === "system" ? (
              <div key={message.id} className="system-message">
                {message.text}
              </div>
            ) : (
              <MessageBubble
                key={message.id}
                message={message}
                mine={message.senderProfileId === activeProfileId}
                senderName={profileNameById[message.senderProfileId] ?? "Unknown"}
              />
            ),
          )
        )}
      </div>

      <Composer onSend={onSend} quotaInfo={quotaInfo} />
    </div>
  );
}

function MessageBubble(props: {
  message: MessageWithAttachments;
  mine: boolean;
  senderName: string;
}) {
  const { message, mine, senderName } = props;
  return (
    <div className={`message-row ${mine ? "mine" : ""}`}>
      <div className="message-bubble">
        {!mine && <div className="message-sender">{senderName}</div>}
        {message.text && <div className="message-text">{message.text}</div>}
        {message.attachments.length > 0 && (
          <div className="attachment-list">
            {message.attachments.map((attachment) => (
              <AttachmentPreview key={attachment.id} attachment={attachment} />
            ))}
          </div>
        )}
        <div className="message-time" title={formatDateTime(message.createdAt)}>
          {formatTime(message.createdAt)}
        </div>
      </div>
    </div>
  );
}

function AttachmentPreview(props: { attachment: MessageWithAttachments["attachments"][number] }) {
  const { attachment } = props;
  const [blobUrl, setBlobUrl] = useState<string>("");

  useEffect(() => {
    const url = URL.createObjectURL(attachment.blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment.blob]);

  const download = () => {
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = attachment.fileName;
    link.click();
  };

  if (attachment.kind === "image") {
    return (
      <div className="attachment-image-wrap">
        {blobUrl && <img src={blobUrl} alt={attachment.fileName} className="attachment-image" />}
        <button className="link-btn" onClick={download}>
          Download
        </button>
      </div>
    );
  }

  return (
    <div className="attachment-file">
      <div className="attachment-file-meta">
        <strong>{attachment.fileName}</strong>
        <span>{formatBytes(attachment.sizeBytes)}</span>
      </div>
      <button className="ghost-btn small" onClick={download}>
        Download
      </button>
    </div>
  );
}

function Composer(props: {
  onSend: (text: string, files: File[]) => Promise<void>;
  quotaInfo: { maxFileBytes: number; maxTotalBytes: number };
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (sending) return;
    try {
      setSending(true);
      await props.onSend(text, files);
      setText("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="composer" onSubmit={(e) => void submit(e)}>
      <div className="composer-top">
        <textarea
          className="composer-input"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
        />
      </div>
      <div className="composer-bottom">
        <label className="attach-btn">
          Attach
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        <div className="composer-files">
          {files.length > 0 ? files.map((file) => <span key={file.name + file.size}>{file.name}</span>) : "No files"}
        </div>
        <div className="composer-hint">Max file: {formatBytes(props.quotaInfo.maxFileBytes)}</div>
        <button className="send-btn" disabled={sending || (!text.trim() && files.length === 0)} type="submit">
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </form>
  );
}

function CreateProfileDialog(props: { onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  return (
    <Modal title="Create Account" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void props.onSubmit(name);
        }}
      >
        <label className="label">Account name</label>
        <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="dialog-actions">
          <button type="button" className="ghost-btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="send-btn" type="submit" disabled={!name.trim()}>
            Create Account
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateDmDialog(props: {
  profiles: Profile[];
  onClose: () => void;
  onSubmit: (otherProfileId: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState(props.profiles[0]?.id ?? "");
  return (
    <Modal title="New DM" onClose={props.onClose}>
      {props.profiles.length === 0 ? (
        <p>Create another profile first.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!selected) return;
            void props.onSubmit(selected);
          }}
        >
          <label className="label">Message with</label>
          <select className="select" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {props.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.displayName}
              </option>
            ))}
          </select>
          <div className="dialog-actions">
            <button type="button" className="ghost-btn" onClick={props.onClose}>
              Cancel
            </button>
            <button className="send-btn" type="submit" disabled={!selected}>
              Open DM
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function CreateGroupDialog(props: {
  profiles: Profile[];
  onClose: () => void;
  onSubmit: (title: string, memberIds: string[]) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  return (
    <Modal title="Create Group Chat" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void props.onSubmit(title, selectedIds);
        }}
      >
        <label className="label">Group name</label>
        <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Team chat" />
        <label className="label">Add members</label>
        <div className="checkbox-list">
          {props.profiles.map((profile) => (
            <label key={profile.id} className="checkbox-item">
              <input type="checkbox" checked={selectedIds.includes(profile.id)} onChange={() => toggle(profile.id)} />
              {profile.displayName}
            </label>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="ghost-btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="send-btn" type="submit">
            Create Group
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddMembersDialog(props: {
  chatId: string;
  onClose: () => void;
  onSubmit: (memberIds: string[]) => Promise<void>;
}) {
  const [candidates, setCandidates] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void repo.getCandidateProfilesForGroupAdd(props.chatId).then((list) => {
      if (!cancelled) {
        setCandidates(list);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.chatId]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  return (
    <Modal title="Add People" onClose={props.onClose}>
      {loading ? (
        <p>Loading...</p>
      ) : candidates.length === 0 ? (
        <p>Everyone is already in the group.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void props.onSubmit(selected);
          }}
        >
          <div className="checkbox-list">
            {candidates.map((profile) => (
              <label key={profile.id} className="checkbox-item">
                <input type="checkbox" checked={selected.includes(profile.id)} onChange={() => toggle(profile.id)} />
                {profile.displayName}
              </label>
            ))}
          </div>
          <div className="dialog-actions">
            <button type="button" className="ghost-btn" onClick={props.onClose}>
              Cancel
            </button>
            <button className="send-btn" type="submit" disabled={selected.length === 0}>
              Add
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function MembersDialog(props: { members: Profile[]; onClose: () => void }) {
  return (
    <Modal title="Group Members" onClose={props.onClose}>
      <ul className="member-list">
        {props.members.map((member) => (
          <li key={member.id} className="member-row">
            <span className="avatar-dot" style={{ backgroundColor: member.avatarColor }} />
            {member.displayName}
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="button" className="ghost-btn" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{props.title}</h3>
          <button className="ghost-btn small" onClick={props.onClose}>
            Close
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}
