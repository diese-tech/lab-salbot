import type { SupabaseClient } from "@salbot/db";

const BUCKET = "match-screenshots";
// Keep this at or below the canonical Supabase bucket limit. Raising it is a
// sal-database release decision, not a bot-only configuration change.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type ScouterAttachment = {
  id: string;
  url: string;
  name: string | null;
  contentType: string | null;
  size: number;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type UploadOptions = {
  matchScopeId: string;
  gameOrdinal: number;
  kind: "scoreboard" | "details";
  fetchImpl?: (url: string) => Promise<FetchResponse>;
};

export type UploadedScouterImage = {
  path: string;
  publicUrl: string;
  fileName: string;
};

export async function uploadScouterImage(
  db: SupabaseClient,
  attachment: ScouterAttachment,
  options: UploadOptions,
): Promise<UploadedScouterImage> {
  const contentType = attachment.contentType?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(
      `${options.kind === "scoreboard" ? "Scoreboard" : "Details"} attachment must be an image.`,
    );
  }
  if (attachment.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `${options.kind === "scoreboard" ? "Scoreboard" : "Details"} image must be 10 MB or smaller.`,
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(attachment.url);
  if (!response.ok) {
    throw new Error(
      `Could not download ${options.kind} image from Discord: HTTP ${response.status}.`,
    );
  }

  const extension = imageExtension(contentType, attachment.name);
  const safeScope = options.matchScopeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeAttachmentId = attachment.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const path = `scouters/${safeScope}/game-${options.gameOrdinal}/${options.kind}-${safeAttachmentId}.${extension}`;
  const bytes = await response.arrayBuffer();
  const bucket = db.storage.from(BUCKET);
  const { error } = await bucket.upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error)
    throw new Error(`Could not store ${options.kind} image: ${error.message}`);

  return {
    path,
    publicUrl: bucket.getPublicUrl(path).data.publicUrl,
    fileName: `game-${options.gameOrdinal}-${options.kind}.${extension}`,
  };
}

export function getScouterImagePublicUrl(
  db: SupabaseClient,
  path: string,
): string {
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function imageExtension(contentType: string, fileName: string | null) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/jpeg" || contentType === "image/jpg") return "jpg";
  const extension = fileName?.split(".").at(-1)?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "jpg";
}
