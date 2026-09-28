# Appliance bosses — concept provenance

- Date: 2026-09-27.
- Selected asset: `overload-recovered-v1.png`, 1536×1024 RGB PNG (opaque concept board), 1,997,516 bytes.
- SHA-256: `ca548601a561ecd040799238968dd49b54796c067d697a51c23d7d9d846c1af9`.
- Creator/tool: OpenAI built-in image generation, directed and reviewed by Codex for this project.
- Input: original text description based on the user's appliance-boss idea and the repository's casual scrap-appliance art direction. No external image, product photo, logo, franchise character or purchased asset was supplied.
- First generation: four columns of toaster, desk fan, microwave and video projector; overload boss above, repaired ally below; consistent 3/4 view; shared-looking basic body and removable boss accessories.
- Revision: used that generated sheet as the sole image input; replaced the dark backdrop with light ivory and made the headings/captions legible. Character design and pairing were kept.
- Inspection: all eight subjects present, four appliance silhouettes, boss/ally accessory distinction, captions legible after revision, full bodies within frame. This is a 2D visual concept, not a test of shared sprite data.
- Usage status: concept-only, **not shipped in Unity Resources or loaded by the web game**. No sprite slicing, animation, transparent cutout or runtime integration is claimed.
- Rights record: generated for this project; no third-party image pack imported. No CC0, public-domain or legal-clearance claim is made.
- Technical references and production plan: `docs/design/APPLIANCE_BOSSES.md`.

Prompt intent: a light casual mobile tower-defense design sheet, exactly eight appliance creatures in a 4×2 grid, appliance bodies rather than humanoids carrying products, matching base shells across each pair, bosses differentiated by detachable overload hardware and warning shapes, original rounded 2D cel-shaded style, no brands or copied game characters.

The concept is stored outside `client/Assets` and `playtest/assets` so the comparison board is not itself a runtime art dependency. Production assets require shared source parts, pivot alignment, state animation and actual size/device validation.
