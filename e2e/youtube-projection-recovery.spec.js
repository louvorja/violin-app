import { test, expect } from "@playwright/test";

const youtubeUrl = (id) => `https://www.youtube.com/embed/${id}?autoplay=1`;

test("embedded YouTube ignores an old API load and recovers paused playback on reopen", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await context.route("**/__youtube-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body>producer</body>" })
  );
  await context.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "/* controlled by test */" })
  );
  try {
    const producer = await context.newPage();
    await producer.goto("/__youtube-fixture");
    await producer.evaluate(() => {
      const channel = new BroadcastChannel("louvorja");
      window.__ytSend = (type, payload) => channel.postMessage({ type, payload });
      channel.addEventListener("message", (event) => {
        if (event.data?.type !== "request_video_state") return;
        const id = event.data.payload?.playback_id;
        if (id !== "playback-b") return;
        channel.postMessage({
          type: "video_state",
          payload: {
            playback_id: id,
            revision: 1,
            currentTime: 42,
            duration: 120,
            isPaused: true,
            sampledAt: Date.now(),
          },
        });
      });
      localStorage.setItem(
        "lj_youtube_projection",
        JSON.stringify({
          url: "https://www.youtube.com/embed/AAAAAAAAAAA?autoplay=1",
          type: "youtube",
          playback_id: "playback-a",
          stage_epoch: 100,
          title: "Old",
        })
      );
    });

    const stage = await context.newPage();
    await stage.goto("/projection/file");
    await expect
      .poll(() => stage.evaluate(() => !!document.querySelector('script[src*="iframe_api"]')))
      .toBe(true);
    await producer.evaluate((url) => {
      localStorage.setItem(
        "lj_youtube_projection",
        JSON.stringify({
          url,
          type: "youtube",
          playback_id: "playback-b",
          stage_epoch: 101,
          title: "New",
        })
      );
      window.__ytSend("online_video_projection", {
        url,
        type: "youtube",
        playback_id: "playback-b",
        stage_epoch: 101,
        title: "New",
      });
    }, youtubeUrl("BBBBBBBBBBB"));
    await stage.evaluate(() => {
      window.__ytPlayers = [];
      window.YT = {
        PlayerState: { PLAYING: 1 },
        Player: class {
          constructor(_container, options) {
            this.videoId = options.videoId;
            this.time = 0;
            this.state = 1;
            this.options = options;
            window.__ytPlayers.push(this);
            setTimeout(() => options.events.onReady(), 0);
          }
          playVideo() {
            this.state = 1;
          }
          pauseVideo() {
            this.state = 2;
          }
          seekTo(time) {
            this.time = time;
          }
          getCurrentTime() {
            return this.time;
          }
          getDuration() {
            return 120;
          }
          getPlayerState() {
            return this.state;
          }
          setVolume() {}
          unMute() {}
          destroy() {
            this.destroyed = true;
          }
        },
      };
      window.onYouTubeIframeAPIReady();
    });
    await expect.poll(() => stage.evaluate(() => window.__ytPlayers?.length)).toBe(1);
    await expect
      .poll(() =>
        stage.evaluate(() => {
          const player = window.__ytPlayers[0];
          return { id: player.videoId, time: player.time, state: player.state };
        })
      )
      .toEqual({ id: "BBBBBBBBBBB", time: 42, state: 2 });
    await producer.evaluate(() =>
      window.__ytSend("youtube_control", {
        action: "play",
        playback_id: "playback-a",
      })
    );
    await expect.poll(() => stage.evaluate(() => window.__ytPlayers[0].state)).toBe(2);

    await stage.close();
    const reopened = await context.newPage();
    await reopened.addInitScript(() => {
      window.__ytPlayers = [];
      window.YT = {
        PlayerState: { PLAYING: 1 },
        Player: class {
          constructor(_container, options) {
            this.videoId = options.videoId;
            this.time = 0;
            this.state = 1;
            window.__ytPlayers.push(this);
            setTimeout(() => options.events.onReady(), 0);
          }
          playVideo() {
            this.state = 1;
          }
          pauseVideo() {
            this.state = 2;
          }
          seekTo(time) {
            this.time = time;
          }
          getCurrentTime() {
            return this.time;
          }
          getDuration() {
            return 120;
          }
          getPlayerState() {
            return this.state;
          }
          setVolume() {}
          unMute() {}
          destroy() {}
        },
      };
    });
    await reopened.goto("/projection/file");
    await expect
      .poll(() =>
        reopened.evaluate(() => {
          const player = window.__ytPlayers?.[0];
          return player ? { id: player.videoId, time: player.time, state: player.state } : null;
        })
      )
      .toEqual({ id: "BBBBBBBBBBB", time: 42, state: 2 });
  } finally {
    await context.close();
  }
});
