import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

type Message = { type: string; payload?: unknown };

type VideoStateRequestBus = {
  listen: (_listener: (_message: Message) => void) => () => void;
};

type VideoStateRequester = {
  broadcastVideoStateForRequest: (_playbackId?: string) => void;
};

/** Connects projection reopen requests to the active media snapshot producer. */
export function listenForVideoStateRequests(
  broadcast: VideoStateRequestBus,
  media: VideoStateRequester
): () => void {
  return broadcast.listen((message) => {
    if (message.type !== BROADCAST_TYPE.REQUEST_VIDEO_STATE) return;
    const payload = message.payload;
    const playbackId =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>).playback_id
        : undefined;
    media.broadcastVideoStateForRequest(typeof playbackId === "string" ? playbackId : undefined);
  });
}
