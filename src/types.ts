export type Id = string;
export type ProfileId = Id;
export type ChatId = Id;
export type MembershipId = Id;
export type MessageId = Id;
export type AttachmentId = Id;

export interface Profile {
  id: ProfileId;
  displayName: string;
  avatarColor: string;
  createdAt: number;
  updatedAt: number;
}

export type ChatType = "dm" | "group";

export interface Chat {
  id: ChatId;
  type: ChatType;
  title: string | null;
  createdByProfileId: ProfileId;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number | null;
}

export type MembershipRole = "owner" | "member";

export interface ChatMembership {
  id: MembershipId;
  chatId: ChatId;
  profileId: ProfileId;
  role: MembershipRole;
  joinedAt: number;
  leftAt: number | null;
}

export type MessageType = "text" | "system" | "file" | "image" | "mixed";

export interface Message {
  id: MessageId;
  chatId: ChatId;
  senderProfileId: ProfileId;
  type: MessageType;
  text: string | null;
  attachmentIds: AttachmentId[];
  createdAt: number;
}

export type AttachmentKind = "image" | "file";

export interface AttachmentMeta {
  id: AttachmentId;
  messageId: MessageId;
  chatId: ChatId;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  blobKey: string;
  createdAt: number;
}

export interface AttachmentWithBlob extends AttachmentMeta {
  blob: Blob;
}

export interface MessageWithAttachments extends Message {
  attachments: AttachmentWithBlob[];
}

export interface ChatListItem {
  chat: Chat;
  title: string;
  subtitle: string;
  lastMessageAt: number | null;
  memberCount: number;
}

export interface SendMessageInput {
  chatId: ChatId;
  senderProfileId: ProfileId;
  text: string;
  files: File[];
}

export interface CreateGroupInput {
  title: string;
  ownerProfileId: ProfileId;
  memberProfileIds: ProfileId[];
}

export interface AppPreferences {
  activeProfileId: ProfileId | null;
  selectedChatByProfile: Record<string, string | null>;
  hasSeededDemoData: boolean;
}

export interface SyncEvent {
  type:
    | "profiles.changed"
    | "chats.changed"
    | "messages.changed"
    | "memberships.changed"
    | "seed.completed";
  at: number;
}

export interface FileLimitConfig {
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}
