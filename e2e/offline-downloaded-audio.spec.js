import { test, expect, devices } from "@playwright/test";
import { Buffer } from "node:buffer";

test.use({ serviceWorkers: "block" });

const wav = Buffer.alloc(44 + 8000 * 10, 128);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(8000, 28);
wav.writeUInt16LE(1, 32);
wav.writeUInt16LE(8, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);

const android = { ...devices["Pixel 7"] };
delete android.defaultBrowserType;
for (const [device, options] of [
  ["desktop", {}],
  ["Android", android],
]) {
  test.describe(device, () => {
    test.use(options);
    for (const legacy of [false, true]) {
      test(`áudio baixado toca offline sem depender do SW (${legacy ? "endereço antigo" : "endereço atual"})`, async ({
        page,
        context,
      }) => {
        await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
        await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
        await page.goto("/");
        await page.getByTestId("modules-ready").waitFor({ state: "attached" });
        const stored = await page.evaluate(
          async ({ bytes, legacy }) => {
            const [
              { default: database },
              { default: media },
              { default: appdata },
              { default: userdata },
              { KEYS },
              audio,
              storage,
              api,
            ] = await Promise.all([
              import("/src/helpers/Database.ts"),
              import("/src/composables/useMedia.ts"),
              import("/src/helpers/AppData.ts"),
              import("/src/helpers/UserData.ts"),
              import("/src/constants/UserDataKeys.ts"),
              import("/src/composables/useAudioPlayback.ts"),
              import("/src/helpers/WebFileStore.ts"),
              import("/src/config/Api.ts"),
            ]);
            const path = "/musics/pt/doxology/Permaneça Em Mim.wav";
            const current = new URL(api.MEDIA_URL + path).href;
            const cached = new URL((legacy ? api.LEGACY_MEDIA_PREFIXES[0] : api.MEDIA_URL) + path)
              .href;
            await (
              await caches.open(storage.AUDIO_CACHE)
            ).put(
              cached,
              new Response(new Uint8Array(bytes), { headers: { "Content-Type": "audio/wav" } })
            );
            await database.seed("music_1407", {
              id_music: 1407,
              name: "Permaneça Em Mim",
              url_music: current,
              lyric: [],
            });
            appdata.set(KEYS.SHELL.IS_ONLINE, true);
            userdata.set(KEYS.MODULES.MEDIA.LAZY_LOAD, true);
            window.__offlineAudioTest = { media, audio: audio.useAudioPlayback() };
            return (await storage.webStorage.checkLocal([path]))[path];
          },
          { bytes: [...wav], legacy }
        );
        expect(stored).toBe("own");
        await context.setOffline(true);
        await page.evaluate(() => window.__offlineAudioTest.media.openAudio(1407));
        await expect
          .poll(
            () =>
              page.evaluate(() => {
                const element = window.__offlineAudioTest.audio.getElement();
                return element.readyState >= 2 && !element.paused && element.currentTime > 0;
              }),
            { timeout: 8000 }
          )
          .toBe(true);
        expect(await page.evaluate(() => window.__offlineAudioTest.audio.getElement().src)).toMatch(
          /^blob:/
        );
        await expect(
          page.getByText("Não foi possível baixar este áudio.", { exact: false })
        ).toHaveCount(0);
      });
    }
  });
}
