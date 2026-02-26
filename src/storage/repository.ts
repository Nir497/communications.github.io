import type {
  AttachmentMeta,
  AttachmentWithBlob,
  Chat,
  ChatId,
  ChatListItem,
  ChatMembership,
  CreateGroupInput,
  FileLimitConfig,
  Message,
  MessageWithAttachments,
  Profile,
  ProfileId,
  SendMessageInput,
  SyncEvent,
  ValidationResult,
} from "../types";
import { createPasswordRecord, verifyPassword } from "../auth";
import { createId, isImageMime, pickAvatarColor } from "../utils";
import { SyncBus } from "./syncBus";

const DB_NAME = "local-texting-app";
const DB_VERSION = 1;

const STORE_PROFILES = "profiles";
const STORE_CHATS = "chats";
const STORE_MEMBERSHIPS = "memberships";
const STORE_MESSAGES = "messages";
const STORE_ATTACH_META = "attachmentsMeta";
const STORE_ATTACH_BLOB = "attachmentsBlob";
const STORE_KV = "kv";

const PREF_ACTIVE_PROFILE = "ltx:activeProfileId";
const PREF_SELECTED_BY_PROFILE = "ltx:selectedChatByProfile";
const PREF_SEEDED = "ltx:hasSeededDemoData";
const PREF_AUTH_PROFILE = "ltx:authProfileId";

export interface AppPreferences {
  activeProfileId: string | null;
  selectedChatByProfile: Record<string, string | null>;
  hasSeededDemoData: boolean;
}

export class ChatRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private syncBus: SyncBus;
  readonly limits: FileLimitConfig = {
    maxFileBytes: 10 * 1024 * 1024,
    maxTotalBytes: 100 * 1024 * 1024,
  };

  constructor(syncBus: SyncBus) {
    this.syncBus = syncBus;
  }

  init(): Promise<void> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase();
    }
    return this.dbPromise.then(() => undefined);
  }

  getPreferences(): AppPreferences {
    let selectedChatByProfile: Record<string, string | null> = {};
    try {
      const raw = localStorage.getItem(PREF_SELECTED_BY_PROFILE);
      if (raw) selectedChatByProfile = JSON.parse(raw);
    } catch {
      selectedChatByProfile = {};
    }
    return {
      activeProfileId: localStorage.getItem(PREF_ACTIVE_PROFILE),
      selectedChatByProfile,
      hasSeededDemoData: localStorage.getItem(PREF_SEEDED) === "true",
    };
  }

  setActiveProfileId(profileId: string | null): void {
    if (profileId) {
      localStorage.setItem(PREF_ACTIVE_PROFILE, profileId);
    } else {
      localStorage.removeItem(PREF_ACTIVE_PROFILE);
    }
  }

  getAuthenticatedProfileId(): string | null {
    return localStorage.getItem(PREF_AUTH_PROFILE);
  }

  setAuthenticatedProfileId(profileId: string | null): void {
    if (profileId) localStorage.setItem(PREF_AUTH_PROFILE, profileId);
    else localStorage.removeItem(PREF_AUTH_PROFILE);
  }

  setSelectedChatForProfile(profileId: string, chatId: string | null): void {
    const prefs = this.getPreferences();
    prefs.selectedChatByProfile[profileId] = chatId;
    localStorage.setItem(PREF_SELECTED_BY_PROFILE, JSON.stringify(prefs.selectedChatByProfile));
  }

  getSelectedChatForProfile(profileId: string): string | null {
    return this.getPreferences().selectedChatByProfile[profileId] ?? null;
  }

  async getProfiles(): Promise<Profile[]> {
    const db = await this.getDb();
    const profiles = (await getAll<Profile>(db, STORE_PROFILES)).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
    return profiles;
  }

  async createProfile(displayName: string): Promise<Profile> {
    const now = Date.now();
    const profile: Profile = {
      id: createId("profile"),
      displayName: displayName.trim(),
      avatarColor: pickAvatarColor(displayName),
      createdAt: now,
      updatedAt: now,
    };
    const db = await this.getDb();
    await runTransaction(db, [STORE_PROFILES], "readwrite", async (tx) => {
      tx.objectStore(STORE_PROFILES).put(profile);
    });
    this.publish("profiles.changed");
    return profile;
  }

  async upsertProfile(profile: Profile): Promise<void> {
    const db = await this.getDb();
    await runTransaction(db, [STORE_PROFILES], "readwrite", async (tx) => {
      tx.objectStore(STORE_PROFILES).put(profile);
    });
    this.publish("profiles.changed");
  }

  async upsertProfiles(profiles: Profile[]): Promise<void> {
    if (profiles.length === 0) return;
    const db = await this.getDb();
    await runTransaction(db, [STORE_PROFILES], "readwrite", async (tx) => {
      const store = tx.objectStore(STORE_PROFILES);
      profiles.forEach((profile) => store.put(profile));
    });
    this.publish("profiles.changed");
  }

  async signUpLocalAccount(displayName: string, password: string): Promise<Profile> {
    const existing = await this.getProfiles();
    if (existing.length > 0) {
      throw new Error("This browser already has an account. Sign in instead.");
    }
    const now = Date.now();
    const auth = await createPasswordRecord(password);
    const profile: Profile = {
      id: createId("profile"),
      displayName: displayName.trim(),
      avatarColor: pickAvatarColor(displayName),
      passwordSalt: auth.salt,
      passwordHash: auth.hash,
      passwordIterations: auth.iterations,
      createdAt: now,
      updatedAt: now,
    };
    const db = await this.getDb();
    await runTransaction(db, [STORE_PROFILES], "readwrite", async (tx) => {
      tx.objectStore(STORE_PROFILES).put(profile);
    });
    this.setActiveProfileId(profile.id);
    this.setAuthenticatedProfileId(profile.id);
    this.publish("profiles.changed");
    return profile;
  }

  async signInLocalAccount(password: string): Promise<Profile> {
    const profiles = await this.getProfiles();
    const profile = profiles[0];
    if (!profile) {
      throw new Error("No account found in this browser. Sign up first.");
    }
    if (!profile.passwordHash || !profile.passwordSalt || !profile.passwordIterations) {
      throw new Error("This local account has no password set.");
    }
    const ok = await verifyPassword(password, {
      salt: profile.passwordSalt,
      hash: profile.passwordHash,
      iterations: profile.passwordIterations,
    });
    if (!ok) throw new Error("Incorrect password");
    this.setActiveProfileId(profile.id);
    this.setAuthenticatedProfileId(profile.id);
    return profile;
  }

  async setPasswordForExistingLocalAccount(password: string): Promise<Profile> {
    const profiles = await this.getProfiles();
    const profile = profiles[0];
    if (!profile) {
      throw new Error("No local account found.");
    }
    const auth = await createPasswordRecord(password);
    const updated: Profile = {
      ...profile,
      passwordSalt: auth.salt,
      passwordHash: auth.hash,
      passwordIterations: auth.iterations,
      updatedAt: Date.now(),
    };
    const db = await this.getDb();
    await runTransaction(db, [STORE_PROFILES], "readwrite", async (tx) => {
      tx.objectStore(STORE_PROFILES).put(updated);
    });
    this.setActiveProfileId(updated.id);
    this.setAuthenticatedProfileId(updated.id);
    this.publish("profiles.changed");
    return updated;
  }

  signOut(): void {
    this.setAuthenticatedProfileId(null);
  }

  async getProfileById(profileId: ProfileId): Promise<Profile | null> {
    const db = await this.getDb();
    return (await getByKey<Profile>(db, STORE_PROFILES, profileId)) ?? null;
  }

  async createDm(activeProfileId: ProfileId, otherProfileId: ProfileId): Promise<Chat> {
    const db = await this.getDb();
    const existing = await this.findExistingDm(activeProfileId, otherProfileId);
    if (existing) return existing;

    const now = Date.now();
    const chat: Chat = {
      id: createId("chat"),
      type: "dm",
      title: null,
      createdByProfileId: activeProfileId,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: null,
    };
    const memberships: ChatMembership[] = [activeProfileId, otherProfileId].map((profileId, index) => ({
      id: createId("membership"),
      chatId: chat.id,
      profileId,
      role: index === 0 ? "owner" : "member",
      joinedAt: now,
      leftAt: null,
    }));

    await runTransaction(db, [STORE_CHATS, STORE_MEMBERSHIPS], "readwrite", async (tx) => {
      tx.objectStore(STORE_CHATS).put(chat);
      const store = tx.objectStore(STORE_MEMBERSHIPS);
      memberships.forEach((membership) => store.put(membership));
    });
    this.publish("chats.changed");
    this.publish("memberships.changed");
    return chat;
  }

  async createGroup(input: CreateGroupInput): Promise<Chat> {
    const now = Date.now();
    const uniqueMembers = [...new Set([input.ownerProfileId, ...input.memberProfileIds])];
    const chat: Chat = {
      id: createId("chat"),
      type: "group",
      title: input.title.trim() || "Untitled Group",
      createdByProfileId: input.ownerProfileId,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    };

    const memberships: ChatMembership[] = uniqueMembers.map((profileId) => ({
      id: createId("membership"),
      chatId: chat.id,
      profileId,
      role: profileId === input.ownerProfileId ? "owner" : "member",
      joinedAt: now,
      leftAt: null,
    }));

    const systemMessage: Message = {
      id: createId("msg"),
      chatId: chat.id,
      senderProfileId: input.ownerProfileId,
      type: "system",
      text: "Group created",
      attachmentIds: [],
      createdAt: now,
    };

    const db = await this.getDb();
    await runTransaction(db, [STORE_CHATS, STORE_MEMBERSHIPS, STORE_MESSAGES], "readwrite", async (tx) => {
      tx.objectStore(STORE_CHATS).put(chat);
      const membershipsStore = tx.objectStore(STORE_MEMBERSHIPS);
      memberships.forEach((membership) => membershipsStore.put(membership));
      tx.objectStore(STORE_MESSAGES).put(systemMessage);
    });
    this.publish("chats.changed");
    this.publish("memberships.changed");
    this.publish("messages.changed");
    return chat;
  }

  async addGroupMembers(chatId: ChatId, actorProfileId: ProfileId, profileIds: ProfileId[]): Promise<void> {
    const ids = [...new Set(profileIds)];
    if (ids.length === 0) return;
    const db = await this.getDb();
    const now = Date.now();
    const currentMemberships = await this.getMembershipsByChat(chatId);
    const existingChat = await this.getChat(chatId);
    const activeMemberSet = new Set(currentMemberships.filter((m) => m.leftAt === null).map((m) => m.profileId));
    const existingProfiles = await this.getProfiles();
    const namesById = new Map(existingProfiles.map((p) => [p.id, p.displayName]));

    await runTransaction(db, [STORE_MEMBERSHIPS, STORE_MESSAGES, STORE_CHATS], "readwrite", async (tx) => {
      const membershipStore = tx.objectStore(STORE_MEMBERSHIPS);
      const messageStore = tx.objectStore(STORE_MESSAGES);
      for (const profileId of ids) {
        if (activeMemberSet.has(profileId)) continue;
        const membership: ChatMembership = {
          id: createId("membership"),
          chatId,
          profileId,
          role: "member",
          joinedAt: now,
          leftAt: null,
        };
        membershipStore.put(membership);
        messageStore.put({
          id: createId("msg"),
          chatId,
          senderProfileId: actorProfileId,
          type: "system",
          text: `${namesById.get(profileId) ?? "User"} was added to the group`,
          attachmentIds: [],
          createdAt: now,
        } satisfies Message);
      }
      if (existingChat) {
        tx.objectStore(STORE_CHATS).put({
          ...existingChat,
          updatedAt: now,
          lastMessageAt: now,
        } satisfies Chat);
      }
    });
    this.publish("memberships.changed");
    this.publish("messages.changed");
    this.publish("chats.changed");
  }

  async leaveGroup(chatId: ChatId, profileId: ProfileId): Promise<void> {
    const db = await this.getDb();
    const memberships = await this.getMembershipsByChat(chatId);
    const active = memberships.find((m) => m.profileId === profileId && m.leftAt === null);
    if (!active) return;
    const profile = await this.getProfileById(profileId);
    const existingChat = await this.getChat(chatId);
    const now = Date.now();
    await runTransaction(db, [STORE_MEMBERSHIPS, STORE_MESSAGES, STORE_CHATS], "readwrite", async (tx) => {
      active.leftAt = now;
      tx.objectStore(STORE_MEMBERSHIPS).put(active);
      tx.objectStore(STORE_MESSAGES).put({
        id: createId("msg"),
        chatId,
        senderProfileId: profileId,
        type: "system",
        text: `${profile?.displayName ?? "User"} left the group`,
        attachmentIds: [],
        createdAt: now,
      } satisfies Message);
      if (existingChat) {
        tx.objectStore(STORE_CHATS).put({
          ...existingChat,
          updatedAt: now,
          lastMessageAt: now,
        } satisfies Chat);
      }
    });
    this.publish("memberships.changed");
    this.publish("messages.changed");
    this.publish("chats.changed");
  }

  async getChat(chatId: ChatId): Promise<Chat | null> {
    const db = await this.getDb();
    return (await getByKey<Chat>(db, STORE_CHATS, chatId)) ?? null;
  }

  async getChatMembers(chatId: ChatId): Promise<Profile[]> {
    const memberships = await this.getMembershipsByChat(chatId);
    const activeIds = memberships.filter((m) => m.leftAt === null).map((m) => m.profileId);
    if (activeIds.length === 0) return [];
    const profiles = await this.getProfiles();
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return activeIds.map((id) => byId.get(id)).filter(Boolean) as Profile[];
  }

  async getVisibleChatsForProfile(profileId: ProfileId): Promise<ChatListItem[]> {
    const [chats, memberships, messages, profiles] = await Promise.all([
      this.getAllChats(),
      this.getAllMemberships(),
      this.getAllMessages(),
      this.getProfiles(),
    ]);
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    const activeMemberships = memberships.filter((m) => m.leftAt === null);
    const visibleChatIds = new Set(activeMemberships.filter((m) => m.profileId === profileId).map((m) => m.chatId));
    const membershipByChat = groupBy(activeMemberships, (m) => m.chatId);
    const messagesByChat = groupBy(messages, (m) => m.chatId);

    return chats
      .filter((chat) => visibleChatIds.has(chat.id))
      .map((chat) => {
        const chatMembers = membershipByChat.get(chat.id) ?? [];
        const chatMessages = (messagesByChat.get(chat.id) ?? []).sort((a, b) => a.createdAt - b.createdAt);
        const lastMessage = chatMessages[chatMessages.length - 1];

        let title = chat.title ?? "DM";
        if (chat.type === "dm") {
          const other = chatMembers.find((m) => m.profileId !== profileId);
          title = other ? profilesById.get(other.profileId)?.displayName ?? "Unknown" : "DM";
        }

        let subtitle = "No messages yet";
        if (lastMessage) {
          subtitle =
            lastMessage.type === "system"
              ? lastMessage.text ?? "System"
              : lastMessage.text?.trim() ||
                (lastMessage.attachmentIds.length > 0 ? "Attachment" : "Message");
        }

        return {
          chat,
          title,
          subtitle,
          lastMessageAt: chat.lastMessageAt,
          memberCount: chatMembers.length,
        } satisfies ChatListItem;
      })
      .sort((a, b) => (b.lastMessageAt ?? b.chat.updatedAt) - (a.lastMessageAt ?? a.chat.updatedAt));
  }

  async getMessages(chatId: ChatId): Promise<MessageWithAttachments[]> {
    const [messages, metas] = await Promise.all([this.getAllMessages(), this.getAllAttachmentMeta()]);
    const db = await this.getDb();
    const inChat = messages.filter((message) => message.chatId === chatId).sort((a, b) => a.createdAt - b.createdAt);
    const metaByMessage = groupBy(metas.filter((meta) => meta.chatId === chatId), (meta) => meta.messageId);

    const result: MessageWithAttachments[] = [];
    for (const message of inChat) {
      const attachmentsMeta = metaByMessage.get(message.id) ?? [];
      const attachments: AttachmentWithBlob[] = [];
      for (const meta of attachmentsMeta) {
        const blob = await getByKey<Blob>(db, STORE_ATTACH_BLOB, meta.blobKey);
        if (blob) attachments.push({ ...meta, blob });
      }
      result.push({ ...message, attachments });
    }
    return result;
  }

  async sendMessage(input: SendMessageInput): Promise<Message> {
    const text = input.text.trim();
    if (!text && input.files.length === 0) {
      throw new Error("Cannot send an empty message");
    }

    for (const file of input.files) {
      const validation = await this.validateFile(file);
      if (!validation.ok) throw new Error(validation.reason ?? "Invalid file");
    }
    const totalAttachmentBytes = input.files.reduce((sum, file) => sum + file.size, 0);
    const totalStored = await this.getTotalAttachmentBytes();
    if (totalStored + totalAttachmentBytes > this.limits.maxTotalBytes) {
      throw new Error("Attachment storage limit reached. Delete data or use smaller files.");
    }

    const now = Date.now();
    const messageId = createId("msg");
    const attachmentIds: string[] = [];
    const messageType = deriveMessageType(text, input.files);

    const message: Message = {
      id: messageId,
      chatId: input.chatId,
      senderProfileId: input.senderProfileId,
      type: messageType,
      text: text || null,
      attachmentIds,
      createdAt: now,
    };

    const db = await this.getDb();
    const existingChat = await this.getChat(input.chatId);
    await runTransaction(
      db,
      [STORE_MESSAGES, STORE_ATTACH_META, STORE_ATTACH_BLOB, STORE_CHATS],
      "readwrite",
      async (tx) => {
        const metaStore = tx.objectStore(STORE_ATTACH_META);
        const blobStore = tx.objectStore(STORE_ATTACH_BLOB);

        for (const file of input.files) {
          const attachmentId = createId("att");
          const blobKey = `blob_${attachmentId}`;
          attachmentIds.push(attachmentId);
          const meta: AttachmentMeta = {
            id: attachmentId,
            messageId,
            chatId: input.chatId,
            kind: isImageMime(file.type) ? "image" : "file",
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            blobKey,
            createdAt: now,
          };
          metaStore.put(meta);
          blobStore.put(file, blobKey);
        }

        tx.objectStore(STORE_MESSAGES).put(message);
        if (existingChat) {
          tx.objectStore(STORE_CHATS).put({
            ...existingChat,
            updatedAt: now,
            lastMessageAt: now,
          } satisfies Chat);
        }
      },
    );

    this.publish("messages.changed");
    this.publish("chats.changed");
    return message;
  }

  async validateFile(file: File): Promise<ValidationResult> {
    if (file.size > this.limits.maxFileBytes) {
      return {
        ok: false,
        reason: `File "${file.name}" is larger than 10 MB.`,
      };
    }
    return { ok: true };
  }

  async getTotalAttachmentBytes(): Promise<number> {
    const metas = await this.getAllAttachmentMeta();
    return metas.reduce((sum, meta) => sum + meta.sizeBytes, 0);
  }

  async seedDemoDataIfNeeded(): Promise<void> {
    const prefs = this.getPreferences();
    if (prefs.hasSeededDemoData) return;

    const db = await this.getDb();
    const existingProfiles = await this.getProfiles();
    if (existingProfiles.length > 0) {
      localStorage.setItem(PREF_SEEDED, "true");
      return;
    }

    const now = Date.now();
    const names = ["Alex", "Sam", "Jordan", "Casey"];
    const profiles: Profile[] = names.map((displayName, index) => ({
      id: createId("profile"),
      displayName,
      avatarColor: pickAvatarColor(displayName),
      createdAt: now - (index + 1) * 1000,
      updatedAt: now - (index + 1) * 1000,
    }));

    const [alex, sam, jordan, casey] = profiles;
    const dm1 = makeChat("dm", null, alex.id, now - 600_000);
    const dm2 = makeChat("dm", null, alex.id, now - 500_000);
    const group = makeChat("group", "Weekend Plans", alex.id, now - 400_000);
    const chats = [dm1, dm2, group];

    const memberships: ChatMembership[] = [
      [dm1.id, alex.id, "owner"],
      [dm1.id, sam.id, "member"],
      [dm2.id, alex.id, "owner"],
      [dm2.id, jordan.id, "member"],
      [group.id, alex.id, "owner"],
      [group.id, sam.id, "member"],
      [group.id, casey.id, "member"],
    ].map(([chatId, profileId, role], index) => ({
      id: createId("membership"),
      chatId: chatId as string,
      profileId: profileId as string,
      role: role as "owner" | "member",
      joinedAt: now - 390_000 + index * 1000,
      leftAt: null,
    }));

    const messages: Message[] = [
      {
        id: createId("msg"),
        chatId: dm1.id,
        senderProfileId: sam.id,
        type: "text",
        text: "Hey Alex, did you see the draft?",
        attachmentIds: [],
        createdAt: now - 590_000,
      },
      {
        id: createId("msg"),
        chatId: dm1.id,
        senderProfileId: alex.id,
        type: "text",
        text: "Yes, looks good. I left comments.",
        attachmentIds: [],
        createdAt: now - 580_000,
      },
      {
        id: createId("msg"),
        chatId: dm2.id,
        senderProfileId: jordan.id,
        type: "text",
        text: "Sending the checklist in a sec.",
        attachmentIds: [],
        createdAt: now - 490_000,
      },
      {
        id: createId("msg"),
        chatId: group.id,
        senderProfileId: alex.id,
        type: "system",
        text: "Group created",
        attachmentIds: [],
        createdAt: now - 390_000,
      },
      {
        id: createId("msg"),
        chatId: group.id,
        senderProfileId: casey.id,
        type: "text",
        text: "Saturday works for me.",
        attachmentIds: [],
        createdAt: now - 380_000,
      },
    ];

    const imageMsg: Message = {
      id: createId("msg"),
      chatId: group.id,
      senderProfileId: sam.id,
      type: "image",
      text: "Mockup preview",
      attachmentIds: [],
      createdAt: now - 370_000,
    };
    const fileMsg: Message = {
      id: createId("msg"),
      chatId: group.id,
      senderProfileId: alex.id,
      type: "file",
      text: null,
      attachmentIds: [],
      createdAt: now - 360_000,
    };
    messages.push(imageMsg, fileMsg);

    const svgBlob = new Blob(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
          <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#93c5fd"/><stop offset="1" stop-color="#10b981"/></linearGradient></defs>
          <rect width="200" height="120" fill="url(#g)"/>
          <circle cx="42" cy="42" r="22" fill="#fff" opacity="0.85"/>
          <rect x="76" y="28" width="90" height="12" rx="6" fill="#fff" opacity="0.85"/>
          <rect x="76" y="48" width="64" height="10" rx="5" fill="#fff" opacity="0.7"/>
          <rect x="18" y="80" width="164" height="22" rx="8" fill="#fff" opacity="0.85"/>
        </svg>`,
      ],
      { type: "image/svg+xml" },
    );
    const textBlob = new Blob(["Weekend checklist\n- Snacks\n- Speakers\n- Charger\n"], {
      type: "text/plain",
    });

    const imageAttId = createId("att");
    const fileAttId = createId("att");
    imageMsg.attachmentIds.push(imageAttId);
    fileMsg.attachmentIds.push(fileAttId);

    const imageMeta: AttachmentMeta = {
      id: imageAttId,
      messageId: imageMsg.id,
      chatId: group.id,
      kind: "image",
      fileName: "mockup-preview.svg",
      mimeType: "image/svg+xml",
      sizeBytes: svgBlob.size,
      blobKey: `blob_${imageAttId}`,
      createdAt: imageMsg.createdAt,
    };
    const fileMeta: AttachmentMeta = {
      id: fileAttId,
      messageId: fileMsg.id,
      chatId: group.id,
      kind: "file",
      fileName: "weekend-checklist.txt",
      mimeType: "text/plain",
      sizeBytes: textBlob.size,
      blobKey: `blob_${fileAttId}`,
      createdAt: fileMsg.createdAt,
    };

    dm1.lastMessageAt = now - 580_000;
    dm1.updatedAt = now - 580_000;
    dm2.lastMessageAt = now - 490_000;
    dm2.updatedAt = now - 490_000;
    group.lastMessageAt = now - 360_000;
    group.updatedAt = now - 360_000;

    await runTransaction(
      db,
      [
        STORE_PROFILES,
        STORE_CHATS,
        STORE_MEMBERSHIPS,
        STORE_MESSAGES,
        STORE_ATTACH_META,
        STORE_ATTACH_BLOB,
        STORE_KV,
      ],
      "readwrite",
      async (tx) => {
        profiles.forEach((profile) => tx.objectStore(STORE_PROFILES).put(profile));
        chats.forEach((chat) => tx.objectStore(STORE_CHATS).put(chat));
        memberships.forEach((membership) => tx.objectStore(STORE_MEMBERSHIPS).put(membership));
        messages.forEach((message) => tx.objectStore(STORE_MESSAGES).put(message));
        tx.objectStore(STORE_ATTACH_META).put(imageMeta);
        tx.objectStore(STORE_ATTACH_META).put(fileMeta);
        tx.objectStore(STORE_ATTACH_BLOB).put(svgBlob, imageMeta.blobKey);
        tx.objectStore(STORE_ATTACH_BLOB).put(textBlob, fileMeta.blobKey);
      },
    );

    localStorage.setItem(PREF_ACTIVE_PROFILE, alex.id);
    localStorage.setItem(PREF_SEEDED, "true");
    localStorage.setItem(PREF_SELECTED_BY_PROFILE, JSON.stringify({ [alex.id]: group.id }));
    this.publish("seed.completed");
    this.publish("profiles.changed");
    this.publish("chats.changed");
    this.publish("memberships.changed");
    this.publish("messages.changed");
  }

  async canProfileAccessChat(profileId: ProfileId, chatId: ChatId): Promise<boolean> {
    const memberships = await this.getMembershipsByChat(chatId);
    return memberships.some((m) => m.profileId === profileId && m.leftAt === null);
  }

  async getCandidateProfilesForGroupAdd(chatId: ChatId): Promise<Profile[]> {
    const [profiles, members] = await Promise.all([this.getProfiles(), this.getChatMembers(chatId)]);
    const memberIds = new Set(members.map((p) => p.id));
    return profiles.filter((profile) => !memberIds.has(profile.id));
  }

  private async getMembershipsByChat(chatId: ChatId): Promise<ChatMembership[]> {
    const memberships = await this.getAllMemberships();
    return memberships.filter((membership) => membership.chatId === chatId);
  }

  private async findExistingDm(a: ProfileId, b: ProfileId): Promise<Chat | null> {
    const [chats, memberships] = await Promise.all([this.getAllChats(), this.getAllMemberships()]);
    const active = memberships.filter((m) => m.leftAt === null);
    const membersByChat = groupBy(active, (m) => m.chatId);
    for (const chat of chats) {
      if (chat.type !== "dm") continue;
      const members = membersByChat.get(chat.id) ?? [];
      const ids = members.map((m) => m.profileId).sort();
      if (ids.length === 2 && ids[0] === [a, b].sort()[0] && ids[1] === [a, b].sort()[1]) {
        return chat;
      }
    }
    return null;
  }

  private async getAllChats(): Promise<Chat[]> {
    const db = await this.getDb();
    return getAll<Chat>(db, STORE_CHATS);
  }

  private async getAllMemberships(): Promise<ChatMembership[]> {
    const db = await this.getDb();
    return getAll<ChatMembership>(db, STORE_MEMBERSHIPS);
  }

  private async getAllMessages(): Promise<Message[]> {
    const db = await this.getDb();
    return getAll<Message>(db, STORE_MESSAGES);
  }

  private async getAllAttachmentMeta(): Promise<AttachmentMeta[]> {
    const db = await this.getDb();
    return getAll<AttachmentMeta>(db, STORE_ATTACH_META);
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase();
    }
    return this.dbPromise;
  }

  private publish(type: SyncEvent["type"]): void {
    this.syncBus.publish({ type, at: Date.now() });
  }
}

function deriveMessageType(text: string, files: File[]): Message["type"] {
  if (files.length === 0) return "text";
  if (files.length === 1 && !text) {
    return isImageMime(files[0].type) ? "image" : "file";
  }
  return "mixed";
}

function makeChat(type: Chat["type"], title: string | null, createdByProfileId: string, at: number): Chat {
  return {
    id: createId("chat"),
    type,
    title,
    createdByProfileId,
    createdAt: at,
    updatedAt: at,
    lastMessageAt: at,
  };
}

function groupBy<T, K>(items: T[], keySelector: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keySelector(item);
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROFILES)) {
        db.createObjectStore(STORE_PROFILES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_CHATS)) {
        const store = db.createObjectStore(STORE_CHATS, { keyPath: "id" });
        store.createIndex("byUpdatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MEMBERSHIPS)) {
        const store = db.createObjectStore(STORE_MEMBERSHIPS, { keyPath: "id" });
        store.createIndex("byChatId", "chatId", { unique: false });
        store.createIndex("byProfileId", "profileId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const store = db.createObjectStore(STORE_MESSAGES, { keyPath: "id" });
        store.createIndex("byChatId", "chatId", { unique: false });
        store.createIndex("byChatIdAndCreatedAt", ["chatId", "createdAt"], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ATTACH_META)) {
        const store = db.createObjectStore(STORE_ATTACH_META, { keyPath: "id" });
        store.createIndex("byMessageId", "messageId", { unique: false });
        store.createIndex("byChatId", "chatId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ATTACH_BLOB)) {
        db.createObjectStore(STORE_ATTACH_BLOB);
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function getByKey<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const tx = db.transaction(storeName, "readonly");
  return requestAsPromise<T | undefined>(tx.objectStore(storeName).get(key));
}

async function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  const tx = db.transaction(storeName, "readonly");
  return requestAsPromise<T[]>(tx.objectStore(storeName).getAll());
}

async function runTransaction(
  db: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => Promise<void> | void,
): Promise<void> {
  const tx = db.transaction(storeNames, mode);
  try {
    await action(tx);
  } catch (error) {
    tx.abort();
    throw error;
  }
  await new Promise<void>((resolve, reject) => {
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.oncomplete = () => resolve();
  });
}
