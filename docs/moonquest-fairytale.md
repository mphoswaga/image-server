# MoonQuest: a story shaped by the class

New automatic sessions use narrative version 2. Earlier sessions retain their saved timing and choices.

- A 24-second illustrated opening shows the festival, the moon spirit scattering the light, and rabbits rescuing a spark. The teacher can skip it.
- Story votes follow learning milestones. Each crew chooses separately in duels. The final prepared question offers a celebration choice if fewer than three checkpoints have run.
- Nine-second action scenes have three beats: encounter the obstacle, build the chosen solution, then use it. Skip scene is teacher-owned. Pause and reload preserve the scene clock.
- Bridge versus stepping stars changes the route and the rabbits' motion. Kite versus tower changes how mist clears. Mooncakes versus parade changes the return-home scene.
- Saved choices produce persistent landmarks at Vinschool and a personal crew story journal in the finale. Lighting and duel points still derive only from answers; story votes never change assessment scores. Early endings do not claim the mission was completed.
- Optional browser narration is off by default and teacher/board only. Music and sound effects remain independently controlled. Captions work without audio; reduced-motion mode shows the same story beats without travelling animations.
- Learner question diagrams are unchanged. No new student identifiers are sent to external services.

## Artwork

Generated with the built-in image_gen tool. Final project asset: `public/moonquest-art/moon-garden-river.webp` (1672 x 941, approximately 386 KB). The existing Vinschool illustration remains the opening/return-home setting. Rabbit characters, props, movement, mist, camera and sound cues extend the existing code-native SVG/CSS/Web Audio assets.

Final image-generation prompt:

> Use case: illustration-story. Create one polished wide 16:9 landscape background painting for a children's Moon Festival fairy-tale game. A magical Vietnamese-inspired moon garden at blue hour, deep indigo and jade foliage, peach blossoms on framing trees, tiny fireflies, warm crimson and gold lanterns hanging among branches at the outer edges, luminous soft moonlight. A small shimmering turquoise river curves horizontally across the lower middle of the image, two mossy banks with open paths suitable for rabbit characters to cross. The central foreground must be uncluttered stage space for animated characters and a bridge added by the game. In the distance a winding path leads between trees toward a warmly glowing festival courtyard, subtle atmospheric depth. Charming hand-painted animated-film quality, soft rich brushwork and dimensional lighting, friendly magical wonder, sophisticated harmonious colors, no scary elements. No people, rabbits, bridge, tower, kite, lettering, logos, interface, split panels or captions. The bridge and characters will be animated separately. Landscape production-ready game backdrop.

## Verification

Tests cover distinct crew outcomes, persistent world state across reload, pause/resume, skip ownership, final choice and unchanged assessment totals. Browser journeys exercise the opening and all three decisions, pause/reload within scenes, chosen-route finale, reduced motion, and learner layouts.
