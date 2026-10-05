import assert from "node:assert/strict";
import test from "node:test";
import { fetchImage, shrinkImage } from "../src/images.js";

// Náhrada bindingu Cloudflare Images: info vrátí rozměry, výstup je pevný počet bajtů.
function fakeImages({ width = 4000, height = 3000, outBytes = 1000, fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async info() {
      if (fail) throw new Error("9422");
      return { format: "image/jpeg", width, height };
    },
    input() {
      return {
        transform(options) {
          calls.push(options);
          return this;
        },
        async output(options) {
          calls.push(options);
          return { response: () => new Response(new Uint8Array(outBytes)) };
        },
      };
    },
  };
}

const jpeg = (size) => ({ bytes: new Uint8Array(size).buffer, type: "image/jpeg" });

test("velký obrázek se zmenší na WEBP do 2400 px", async () => {
  const IMAGES = fakeImages();
  const image = await shrinkImage({ IMAGES }, jpeg(3_000_000));
  assert.equal(image.type, "image/webp");
  assert.equal(image.bytes.byteLength, 1000);
  assert.deepEqual(IMAGES.calls[0], { width: 2400, height: 2400, fit: "scale-down" });
});

test("malý obrázek, GIF, chyba a obrázek bez bindingu zůstanou", async () => {
  const small = jpeg(100_000);
  assert.equal(await shrinkImage({ IMAGES: fakeImages({ width: 800, height: 600 }) }, small), small);
  const gif = { ...jpeg(3_000_000), type: "image/gif" };
  assert.equal(await shrinkImage({ IMAGES: fakeImages() }, gif), gif);
  const big = jpeg(3_000_000);
  assert.equal(await shrinkImage({ IMAGES: fakeImages({ fail: true }) }, big), big);
  assert.equal(await shrinkImage({}, big), big);
});

test("zmenšení, které nic neušetří, nechá originál (když není moc velký rozměrem)", async () => {
  const image = jpeg(600_000);
  assert.equal(await shrinkImage({ IMAGES: fakeImages({ width: 1200, height: 900, outBytes: 700_000 }) }, image), image);
});

test("stažený obrázek nad 4 MB projde jen zmenšený", async () => {
  const fetchImpl = async () => new Response(new Uint8Array(8_000_000), { headers: { "content-type": "image/jpeg" } });
  assert.equal(await fetchImage({}, "https://example.cz/a.jpg", { fetchImpl }), null);
  const image = await fetchImage({ IMAGES: fakeImages() }, "https://example.cz/a.jpg", { fetchImpl });
  assert.equal(image.type, "image/webp");
});
