Clock Templates Structure

- Each template lives under `data/clock/templates/<id>/`.
- Required files:
  - `meta.json`: metadata for listing and future dynamic loading.
  - `index.html`: self-contained template preview/implementation (can include inline CSS/JS).

Example fields in `meta.json`:

{
  "id": "basic",
  "name": "Basic Digital Clock",
  "description": "Clean HH:MM:SS with themeable colors",
  "preview": "preview.png",
  "version": 1
}

Note: The current UI lists templates and wires a starter "Use" action. Future work can dynamically fetch these assets and render/apply themes to the panel.

