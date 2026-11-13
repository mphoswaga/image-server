const { test, mock, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-classroom-images-"));
process.env.DATA_DIR = dataDir;
process.env.OPENAI_API_KEY = "test-key-not-sent";
process.env.OPENAI_IMAGE_MODEL = "gpt-image-1";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let requests = [],
  response = { data: [{ b64_json: PNG }] };
mock.method(require("../ai-client"), "client", () => ({
  images: {
    generate: async (request) => {
      requests.push(request);
      return response;
    },
  },
}));
const { generateImage, model } = require("../ai-image");
after(() => {
  mock.restoreAll();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("retired image configuration migrates and the illustration survives in persistent media", async () => {
  const image = await generateImage({
    subject: "ICT",
    topic: "Algorithms",
    concept: "A child beside a messy bedroom.",
    grade: "Grade 3",
    presetId: "primary-discovery",
  });
  assert.equal(model, "gpt-image-2.5-flare");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].output_format, "png");
  assert.equal(requests[0].response_format, undefined);
  assert.match(requests[0].prompt, /gouache/);
  assert.equal(image.source, "ai-generated");
  assert.deepEqual(
    fs.readFileSync(require("../media").resolveMedia(image.relpath)),
    Buffer.from(PNG, "base64"),
  );
});

test("an empty image response fails clearly instead of invoking a retired fallback", async () => {
  response = { data: [] };
  const before = requests.length;
  await assert.rejects(
    generateImage({
      subject: "ICT",
      topic: "Algorithms",
      concept: "A tidy bedroom.",
    }),
    /returned no image/,
  );
  assert.equal(requests.length, before + 1);
});

test("a relevant teacher picture takes priority over buying new artwork", async () => {
  const { selectImages } = require("../generate"),
    { mediaWriteDir } = require("../media");
  fs.writeFileSync(
    path.join(mediaWriteDir("test-art"), "room.png"),
    Buffer.from(PNG, "base64"),
  );
  const before = requests.length;
  const images = await selectImages(
    [
      {
        type: "title",
        title: "Tidy the bedroom",
        imageQuery: "toys scattered bedroom",
      },
    ],
    "ICT",
    "Algorithms",
    [{ relpath: "test-art/room.png", caption: "toys scattered bedroom" }],
    require("../slide-presets").getPreset("primary-discovery"),
    { grade: "Grade 3" },
  );
  assert.equal(images[0].relpath, "test-art/room.png");
  assert.equal(requests.length, before);
});

test("image cost uses reported text and image tokens", () => {
  const { costFor } = require("../usage");
  assert.equal(
    costFor("gpt-4.1", { promptTokens: 1000, completionTokens: 1000 }),
    0.01,
  );
  assert.equal(
    costFor("gpt-image-2.5-flare", {
      images: 1,
      imageUsage: {
        input_tokens_details: { text_tokens: 100, image_tokens: 50 },
        output_tokens: 2000,
      },
    }),
    0.0609,
  );
});
