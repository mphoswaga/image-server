# LessonCope — Architecture Plan

*"Gamma for teachers": type a topic, get a finished PowerPoint with matching images.*

---

## 1. The vision in one line

A teacher enters a **subject + topic** (e.g. "Maths → Fractions"), and the app generates a complete, editable PowerPoint deck — slide text written for them, and every slide illustrated with a relevant image pulled from a local teaching-image library.

---

## 2. Where you are today

Your existing `image-agent` is the **image supply layer** of this bigger system — and it already works:

- `agent.js` — downloads up to 50 Unsplash education photos per topic, organized as `subject/topic/`.
- `image-server.js` — a small Express server that serves the `public/` folder.
- `public/` — already holds the full library: ICT, Maths, English × all topics × 50 images each (~950 images).
- `.env` holds the Unsplash key; the repo is already wired for Railway deployment.

So of the four big pieces needed, **one is done**. The plan below adds the other three: content generation, image matching, and PowerPoint assembly — plus a simple interface to tie them together.

---

## 3. The four core components

### A. Image Library (have it — needs a small upgrade)
The collection of downloaded images plus a lightweight **index** describing what each image is, so slides can find the right picture fast.

- *Now:* images live in folders by topic. Matching = "pick from the right folder."
- *Upgrade:* add an index file (`library.json`) listing each image's subject, topic, filename, and any tags. This makes selection scriptable and lets you grow toward smart matching later.

### B. Content Generator (new — the "brain")
Turns a topic into structured slide content using an LLM (the Claude API fits cleanly into your Node stack).

- **Input:** subject, topic, grade level, desired slide count, tone.
- **Output:** a strict JSON object — one entry per slide with a `title`, `bullets`, `speakerNotes`, and an `imageQuery` (keywords describing the ideal picture for that slide).
- This JSON is the **contract** that the rest of the app builds on. Everything downstream just reads it.

### C. Image Matcher (new — connects A and B)
For each slide, picks the best image from the library using the slide's `imageQuery`.

- *V1 (simple, reliable):* map subject+topic to the right folder, pick an unused image, avoid repeats within a deck.
- *V2 (smart, later):* score images by keyword/semantic similarity to `imageQuery`; fall back to an on-demand Unsplash fetch when the library has no good match.

### D. PowerPoint Assembler (new — the output)
Builds the real `.pptx` from the slide JSON + chosen images, using `pptxgenjs` (pure Node, no Office install needed).

- Applies a consistent **template/theme** (fonts, colors, layout) so decks look intentional.
- Produces a downloadable, fully editable file — teachers can tweak it in PowerPoint/Keynote/Google Slides afterward.

### + Interface (new — the front door)
One simple screen: pick subject, type topic, set grade + slide count, click **Generate**, watch progress, download the deck. Your existing Express server becomes the backend that orchestrates A→B→C→D.

---

## 4. How a request flows

```
Teacher fills form
        │  POST /generate { subject, topic, grade, slideCount }
        ▼
[Backend / Express]  orchestrates the pipeline
        │
        ├─► [Content Generator]  topic ──► slide JSON (titles, bullets, notes, imageQuery)
        │
        ├─► [Image Matcher]      for each slide, imageQuery ──► best library image
        │                         (falls back to Unsplash fetch if missing)
        │
        ├─► [PPTX Assembler]     slide JSON + images ──► themed .pptx file
        │
        ▼
Download link returned ──► teacher downloads the deck
```

---

## 5. Tech choices (stay in your current stack)

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js | Already your stack |
| Web/API | Express | Already in the project |
| Content gen | Claude API (or any LLM) | Structured JSON output, slots into Node |
| PPTX build | `pptxgenjs` | Mature Node library, no Office needed |
| Image source | Local library + Unsplash fallback | You already have this working |
| Image index | `library.json` | Simple, no database needed yet |
| Deploy | Railway | Already configured |

No database is required for the MVP — the filesystem + a JSON index is enough. Add one later only if you want saved decks, accounts, or history.

---

## 6. Build order (phased — each phase is usable)

**Phase 1 — Prove the pipeline (CLI, no AI yet).**
`node generate.js maths fractions` → produces a real `.pptx` using placeholder slide text + library images. Proves matching + assembly end-to-end. *This is the fastest way to see the whole thing work.*

**Phase 2 — Add the brain.**
Replace placeholder text with LLM-generated slide JSON. Now the content is real and topic-aware.

**Phase 3 — Add the interface.**
A web form on your Express server: type a topic, click generate, download the deck. This is the moment it "feels like Gamma."

**Phase 4 — Make it good.**
Smarter image matching, a polished template/theme, grade-level tuning, avoid duplicate images per deck, on-demand image fetch for gaps.

**Phase 5 — Ship it.**
Deploy on Railway, optional accounts + saved decks, attribution tracking for Unsplash images.

---

## 7. Decisions & risks to keep in mind

- **Image relevance is the hard quality problem.** Folder-level matching is coarse — a "fractions" slide about pizza vs. about number lines both pull from the same folder. V1 is fine to launch; semantic matching (Phase 4) is where quality jumps.
- **Unify the image location.** Today `agent.js` downloads to `~/Downloads/teaching-images` but the server serves `public/`. Pick one canonical library path so generation and serving read the same place.
- **LLM cost & latency.** Each generation is one API call — cheap, but worth caching results per (topic, grade) so repeats are instant and free.
- **Attribution.** Unsplash images are free to use but ask for credit; store photographer info in `library.json` so a credits slide can be auto-added.
- **Editability over perfection.** The goal is a strong *first draft* the teacher refines — not a final deck. That keeps quality expectations realistic and the product genuinely useful.

---

## 8. Suggested next step

Phase 1 is the highest-leverage move: a small `generate.js` that takes a subject + topic and outputs a real PowerPoint from your existing images, with simple placeholder text. It proves the matching + assembly works and gives you something to click. Then Phase 2 swaps in the AI-written content.
