# Models

Live2D Cubism 4 model assets bundled with HandheldMaid. Each model lives under
`models/<name>/runtime/` with its `*.model3.json` as the entry point, plus a
`ReadMe.txt` from the model's creator.

## Directory layout

```
assets/models/<name>/
├── ReadMe.txt            # Creator's readme (original language, preserved verbatim)
└── runtime/
    ├── <name>.model3.json  # Entry point (referenced by the renderer)
    ├── <name>.moc3
    ├── <name>.physics3.json
    ├── <name>.cdi3.json
    ├── <name>.<size>/      # textures
    ├── expressions/        # *.exp3.json
    └── motion/             # *.motion3.json
```

## Bundled models

### wanko

- **Source**: Live2D official sample model 「わんころもち PRO版」
- **License**: Free for commercial use by general users and small businesses
  upon agreement to the terms; mid/large businesses may use for non-public
  testing only. See `models/wanko/ReadMe.txt` (Japanese) for full terms.
- **Converted**: Originally authored in Cubism 2.1, converted to Cubism 4
  format for use with Cubism Viewer 4 and compatible software.
- **Motions**: `Idle`, `Shake`, `Tap` (see `wanko_touch.model3.json`).

### miku (初音未来)

- **Character**: Hatsune Miku (初音未来)
- **Character art (人物绘制)**: 玄宝酱
- **Modeling (人物建模)**: 怂怂koe
- **Contents**: 5 action buttons (拿葱 / 唱歌 / 比心 / 大小变 / 前倾) and
  3 expression buttons (圈圈 / 哭哭 / 脸红), plus additional expressions
  (QQ人 / 唱歌 / 水印 / 葱 / 前倾).
- **License / usage terms** (per creator, see `models/miku/ReadMe.txt`):
  - Free to use as a desktop pet or VTS face-capture model.
  - **No redistribution, no modification (不可二传二改).**
  - **No commercial use.** No monetized streaming. No illegal use.
    The user bears all legal responsibility for any commercial or illegal
    use; the creators are not liable.
  - When publishing non-commercial videos using this model, credit the
    source.
- **Note**: The original `miku.model3.json` from VTube Studio omitted the
  `Expressions` and `Motions` references. HandheldMaid adds them
  (`expressions/*.exp3.json`, `motion/Scene1.motion3.json`) so the model
  loads expressions and an idle motion in the desktop-pet runtime. The model
  files themselves are **not modified** — only the manifest references.

## Credits & thanks

Many thanks to the creators and the open-source community:

- **玄宝酱** (character art) and **怂怂koe** (modeling) for the Miku model.
- **Live2D Inc.** for the official wanko sample model and the Cubism SDK
  (`live2dcubismcore.min.js`, redistributed under Live2D's Redistributable
  Code license).
- The **pixi-live2d-display** and **pixi.js** maintainers for the rendering
  libraries that make displaying these models possible.

If you add a new model, please:

1. Keep the creator's `ReadMe.txt` / license verbatim.
2. Add an entry to this file crediting the source and license.
3. Respect each model's redistribution and commercial-use terms — when in
   doubt, do not redistribute.
