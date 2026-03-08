import type { Context } from "hono";
import { sessions } from "../manager/SessionManager";

/** GET /latest-photo — metadata for the most recent photo */
export function getLatestPhoto(c: Context) {
  const userId = c.req.query("userId");

  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.get(userId);
  if (!user) return c.json({ error: "No photos available for this user" }, 404);

  const photos = user.photo.getAll();
  if (photos.length === 0) {
    return c.json({ error: "No photos available for this user" }, 404);
  }

  const latest = photos[0];
  return c.json({
    requestId: latest.requestId,
    timestamp: latest.timestamp.getTime(),
    userId: latest.userId,
    hasPhoto: true,
  });
}

/** GET /photo/:requestId — raw photo image data */
export function getPhotoData(c: Context) {
  const requestId = c.req.param("requestId");
  const userId = c.req.query("userId");

  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.get(userId);
  const photo = user?.photo.getPhoto(requestId);
  if (!photo) return c.json({ error: "Photo not found" }, 404);
  if (photo.userId !== userId) {
    return c.json(
      { error: "Access denied: photo belongs to different user" },
      403,
    );
  }

  return new Response(new Uint8Array(photo.buffer), {
    headers: {
      "Content-Type": photo.mimeType,
      "Cache-Control": "no-cache",
    },
  });
}

/** GET /photo-base64/:requestId — photo as base64 JSON */
export function getPhotoBase64(c: Context) {
  const requestId = c.req.param("requestId");
  const userId = c.req.query("userId");

  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.get(userId);
  const photo = user?.photo.getPhoto(requestId);
  if (!photo) return c.json({ error: "Photo not found" }, 404);
  if (photo.userId !== userId) {
    return c.json(
      { error: "Access denied: photo belongs to different user" },
      403,
    );
  }

  const base64Data = photo.buffer.toString("base64");
  return c.json({
    requestId: photo.requestId,
    timestamp: photo.timestamp.getTime(),
    mimeType: photo.mimeType,
    filename: photo.filename,
    size: photo.size,
    userId: photo.userId,
    base64: base64Data,
    dataUrl: `data:${photo.mimeType};base64,${base64Data}`,
  });
}

/** POST /capture-photo — capture a fresh photo and return it as data URL */
export async function capturePhoto(c: Context) {
  const body = await c.req.json().catch(() => ({}));
  const userId = typeof body?.userId === "string" ? body.userId : "";

  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.get(userId);
  if (!user) return c.json({ error: `No active session for ${userId}` }, 404);

  try {
    await user.photo.takePhoto();
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to capture photo from glasses",
      },
      500,
    );
  }

  const latest = user.photo.getAll()[0];
  if (!latest) {
    return c.json({ error: "Photo capture completed but no frame was stored" }, 500);
  }

  const base64 = latest.buffer.toString("base64");
  return c.json({
    requestId: latest.requestId,
    timestamp: latest.timestamp.getTime(),
    mimeType: latest.mimeType,
    userId: latest.userId,
    imageDataUrl: `data:${latest.mimeType};base64,${base64}`,
  });
}
