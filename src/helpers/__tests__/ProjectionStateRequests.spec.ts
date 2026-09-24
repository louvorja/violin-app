import { describe, expect, it, vi } from "vitest";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { handleProjectionStateRequest } from "@/helpers/ProjectionStateRequests";

function harness(cached: Record<string, unknown> = {}) {
  return {
    getLastPayload: vi.fn((type: string) => cached[type]),
    send: vi.fn(),
  };
}

describe("handleProjectionStateRequest", () => {
  it.each([
    [BROADCAST_TYPE.REQUEST_BIBLE_STATE, BROADCAST_TYPE.BIBLE_VERSE],
    [BROADCAST_TYPE.REQUEST_SLIDE_STATE, BROADCAST_TYPE.SLIDE_CHANGE],
    [BROADCAST_TYPE.REQUEST_LIBRAS_STATE, BROADCAST_TYPE.LIBRAS_TOGGLE],
  ])("reemit cached state for %s", (requestType, responseType) => {
    const payload = { active: true };
    const broadcast = harness({ [responseType]: payload });

    expect(handleProjectionStateRequest({ type: requestType }, broadcast)).toBe(true);
    expect(broadcast.getLastPayload).toHaveBeenCalledWith(responseType);
    expect(broadcast.send).toHaveBeenCalledWith(responseType, payload);
  });

  it("does not emit when the requested state has not been observed", () => {
    const broadcast = harness();

    expect(
      handleProjectionStateRequest(
        { type: BROADCAST_TYPE.REQUEST_LIBRAS_STATE },
        broadcast
      )
    ).toBe(true);
    expect(broadcast.send).not.toHaveBeenCalled();
  });

  it("leaves unrelated messages for other handlers", () => {
    const broadcast = harness();

    expect(handleProjectionStateRequest({ type: BROADCAST_TYPE.REQUEST_MODULE_STATE }, broadcast)).toBe(
      false
    );
    expect(broadcast.getLastPayload).not.toHaveBeenCalled();
  });
});
