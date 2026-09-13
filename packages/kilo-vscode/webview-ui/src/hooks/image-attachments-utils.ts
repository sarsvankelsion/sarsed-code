export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

export const ACCEPTED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "video/avi",
  "video/x-msvideo",
  "video/3gpp",
  "video/ogg",
]

export const ACCEPTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/m4a",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/webm",
]

/** All accepted media types (images + videos + audio). */
export const ACCEPTED_MEDIA_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES, ...ACCEPTED_AUDIO_TYPES]

/** Returns true if the given MIME type is an accepted image type. */
export function isAcceptedImageType(mimeType: string): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(mimeType)
}

/** Returns true if the given MIME type is an accepted video type. */
export function isAcceptedVideoType(mimeType: string): boolean {
  return mimeType.startsWith("video/")
}

/** Returns true if the given MIME type is an accepted audio type. */
export function isAcceptedAudioType(mimeType: string): boolean {
  return mimeType.startsWith("audio/")
}

/** Returns true if the given MIME type is any accepted media type (image, video, or audio). */
export function isAcceptedMediaType(mimeType: string): boolean {
  return (
    isAcceptedImageType(mimeType) || isAcceptedVideoType(mimeType) || isAcceptedAudioType(mimeType)
  )
}

/**
 * Check if a drag-leave event is leaving the component (not just entering a child).
 * Returns true if dragging has actually left the component boundary.
 */
export function isDragLeavingComponent(relatedTarget: EventTarget | null, currentTarget: HTMLElement): boolean {
  if (!relatedTarget) return true
  return !currentTarget.contains(relatedTarget as Node)
}

