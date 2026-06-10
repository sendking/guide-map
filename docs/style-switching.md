# 手绘地图风格切换

风格切换通过 `styles/*.json` 完成。渲染器会保持同一份 GeoJSON、同一个 viewport/bounds，只替换视觉样式，因此不会影响 1:1 覆盖精度。

## 已内置风格

### `styles/handdrawn.example.json`

默认手绘风格。颜色偏自然，适合做通用底图。

```bash
npm run render:xixi
```

输出：

- `output/xixi-wetland-handdrawn.svg`
- `output/xixi-wetland-overlay.json`

### `styles/watercolor.json`

水彩风。颜色柔和，纸纹更明显，适合景区导览和文旅宣传。

```bash
npm run render:xixi:watercolor
```

输出：

- `output/styles/xixi-watercolor.svg`
- `output/styles/xixi-watercolor-overlay.json`

### `styles/ink.json`

墨线风。边界更克制，线条更像钢笔/版画，适合需要更高识别度的地图。

```bash
npm run render:xixi:ink
```

输出：

- `output/styles/xixi-ink.svg`
- `output/styles/xixi-ink-overlay.json`

### `styles/storybook.json`

绘本风。颜色更明快，适合亲子、乐园、景区活动地图。

```bash
npm run render:xixi:storybook
```

输出：

- `output/styles/xixi-storybook.svg`
- `output/styles/xixi-storybook-overlay.json`

### `styles/path-emphasis.json`

小路增强风。用于诊断或强调景区内部步道、栈桥、游线。它会给小路和道路增加更明显的浅色外描边。

```bash
npm run render:xixi:path-emphasis
```

输出：

- `output/styles/xixi-path-emphasis.svg`
- `output/styles/xixi-path-emphasis-overlay.json`

### `styles/jiangnan-guide.json`

江南导览插画风。参考高德手绘导览图的浅绿湿地、浅蓝水系、橙色游线、白墙黛瓦建筑和柔和水彩纸感。

```bash
npm run render:xixi:jiangnan
```

输出：

- `output/styles/xixi-jiangnan-guide.svg`
- `output/styles/xixi-jiangnan-guide-overlay.json`

## 一次生成全部风格

```bash
npm run render:xixi:styles
npm run validate:xixi:styles
```

## 小路看不见怎么办

常见原因有两类：

- 数据源缺失：高德地图有景区内部私有小路，但 OSM 没有。这种情况需要额外补充数据，可以从景区测绘、人工描线或截图识别获得。
- 样式太弱：OSM 里有小路，但线段很短、线宽太细、虚线间隔太大，叠在绿地/水体上视觉上会消失。这种情况优先使用 `styles/path-emphasis.json` 或提高 `path.casing.strokeWidth`。

西溪当前数据里道路/步道总量较多，其中很多是 2-3 个点组成的短线段，因此不建议把步道画成大间隔虚线。

## 新增一种风格

1. 复制一个现有样式文件：

```bash
cp styles/watercolor.json styles/my-style.json
```

2. 修改颜色、线宽、纹理、抖动参数。

3. 运行：

```bash
node scripts/render-handdrawn-map.js \
  --config config/xixi-wetland.viewport.json \
  --data data/xixi-wetland.osm.geojson \
  --style styles/my-style.json \
  --out output/styles/xixi-my-style.svg \
  --manifest output/styles/xixi-my-style-overlay.json
```

## 样式字段说明

- `background`：整张图的底色。
- `paper.enabled` / `paper.opacity`：纸纹开关和强度。
- `layers[].match.kind`：匹配 GeoJSON 的 `properties.kind`。
- `fill`：面填充色。
- `stroke`：线条颜色。
- `strokeWidth`：线条宽度。
- `casing`：道路外描边，常用于让道路从绿地/水体里浮出来。
- `texture`：内置纹理，目前有 `waves`、`leaf-dots`、`hatch`。
- `sketch.copies`：手绘重复描边次数。
- `sketch.jitter`：手绘抖动强度。
- `sketch.opacity`：手绘描边透明度。

## 安全调参与风险

安全可调：

- 颜色。
- 线宽。
- 填充。
- 纹理。
- 抖动强度。
- 图层显示/隐藏。

需要谨慎：

- 大幅增加 `sketch.jitter`。它不会改变主体精确几何，但会让视觉边缘看起来偏出。
- 大幅增加道路 `strokeWidth`。道路会更醒目，但可能遮住细水系。
- 恢复 POI/文字图层。现在西溪版本刻意关闭了 POI。

不要在风格层做：

- 坐标平移。
- 坐标缩放。
- 几何简化。
- bounds 修改。

这些属于地图几何层，应该留在 `config/*.viewport.json` 和数据处理脚本里。
