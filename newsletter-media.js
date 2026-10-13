const sharp = require("sharp");
function safeUrl(value) {
  const u = new URL(value);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw Error("Use a normal http or https link.");
  return u.href;
}
async function normalise(input) {
  const links = input.links || [],
    images = input.images || [];
  if (
    !Array.isArray(links) ||
    links.length > 8 ||
    !Array.isArray(images) ||
    images.length > 3
  )
    throw Error("Use up to 8 links and 3 images per subject.");
  const result = {
    links: links.map((l) => ({
      label: String(l.label || "Open link")
        .trim()
        .slice(0, 120),
      url: safeUrl(String(l.url || "").slice(0, 2048)),
    })),
    images: [],
  };
  for (const i of images) {
    if (
      typeof i.data !== "string" ||
      i.data.length > 1400000 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(i.data)
    )
      throw Error("Choose a PNG, JPEG or WebP image under 1 MB.");
    const bytes = await sharp(Buffer.from(i.data.split(",")[1], "base64"), {
      limitInputPixels: 16000000,
    })
      .rotate()
      .resize({
        width: 1200,
        height: 900,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 75 })
      .toBuffer();
    if (bytes.length > 400000) throw Error("Please choose a smaller image.");
    result.images.push({
      data: "data:image/jpeg;base64," + bytes.toString("base64"),
      caption: String(i.caption || "")
        .trim()
        .slice(0, 300),
    });
  }
  return result;
}
function draw(doc, entry, x, y, width, bottom, newPage) {
  for (const l of entry.links || []) {
    let url;
    try {
      url = safeUrl(l.url);
    } catch {
      continue;
    }
    doc.font("Regular").fontSize(10);
    const label = l.label + " — " + url;
    const h = doc.heightOfString(label, { width }) + 10;
    if (y + h > bottom) y = newPage();
    doc
      .fillColor("#204581")
      .text(label, x, y, { width, link: url, underline: true });
    y = doc.y + 10;
  }
  for (const i of entry.images || []) {
    doc.font("Regular").fontSize(9);
    const needed =
      188 + (i.caption ? doc.heightOfString(i.caption, { width }) + 12 : 0);
    if (y + needed > bottom) y = newPage();
    doc.image(Buffer.from(i.data.split(",")[1], "base64"), x, y, {
      fit: [width, 180],
    });
    y += 188;
    if (i.caption) {
      doc
        .font("Regular")
        .fontSize(9)
        .fillColor("#203b49")
        .text(i.caption, x, y, { width });
      y = doc.y + 12;
    }
  }
  return y;
}
module.exports = { normalise, safeUrl, draw };

// Keep image bytes outside versioned newsletter JSON; snapshots retain immutable IDs.
const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
function pack(workspace, root) {
  const copy = structuredClone(workspace);
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.images))
      value.images = value.images.map((i) => {
        if (!i.data) return i;
        const bytes = Buffer.from(i.data.split(",")[1], "base64"),
          assetId = crypto.createHash("sha256").update(bytes).digest("hex");
        fs.mkdirSync(root, { recursive: true });
        const file = path.join(root, assetId + ".jpg");
        if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: "wx" });
        return { assetId, caption: i.caption || "" };
      });
    for (const child of Object.values(value)) walk(child);
  }
  walk(copy);
  return copy;
}
function hydrate(workspace, root) {
  const copy = structuredClone(workspace);
  function entries(list) {
    for (const e of list || [])
      e.images = (e.images || []).map((i) => {
        if (i.data) return i;
        if (!/^[a-f0-9]{64}$/.test(i.assetId || "")) return i;
        return {
          ...i,
          data:
            "data:image/jpeg;base64," +
            fs
              .readFileSync(path.join(root, i.assetId + ".jpg"))
              .toString("base64"),
        };
      });
  }
  for (const r of copy.reports || []) {
    entries(r.entries);
    entries(r.approved?.entries);
    entries(r.publication?.content?.entries);
  }
  return copy;
}
module.exports.pack = pack;
module.exports.hydrate = hydrate;
