# 手绘地图 1:1 覆盖工作流

这个仓库实现的是一条 **几何锁定 + 程序化手绘渲染 + 可覆盖输出** 的工作流。

核心原则：不要让 AI 负责地图坐标。AI 可以做纸纹、树、建筑小插画、图标等美术素材，但道路、水系、绿地、建筑轮廓、POI 坐标必须由地图引擎/矢量数据确定性渲染。

## 当前 MVP 能做什么

- 输入地图视口参数：截图宽高、中心点、缩放级别、设备像素比、瓦片尺寸、坐标系。
- 输入同一范围的 GeoJSON 矢量数据。
- 输出同尺寸 SVG 手绘地图：精确几何为主体，叠加低强度手绘描边、纸纹和纹理。
- 输出 overlay manifest：包含尺寸、中心点、缩放、地理 bounds，方便叠回原生地图。
- 提供尺寸校验脚本，避免生成图和截图尺寸不一致。

## 快速运行

```bash
npm run render
npm run validate
```

输出文件：

- `output/example-handdrawn.svg`
- `output/example-overlay.json`

## 生成西溪湿地手绘地图

当前仓库已经配置了西溪湿地的 MVP 流程：

```bash
npm run fetch:xixi
npm run render:xixi
npm run validate:xixi
```

输出文件：

- `data/xixi-wetland.osm.geojson`
- `output/xixi-wetland-handdrawn.svg`
- `output/xixi-wetland-overlay.json`

说明：

- `fetch:xixi` 会联网访问 Overpass API，按 `config/xixi-wetland.viewport.json` 的范围拉取 OSM 矢量数据。
- `render:xixi` 会把 OSM 数据转换后的 GeoJSON 渲染成同尺寸手绘 SVG。
- `validate:xixi` 会校验 SVG 尺寸和 overlay manifest 是否一致。

## 切换风格

西溪湿地已经内置多套风格：

```bash
npm run render:xixi:watercolor
npm run render:xixi:ink
npm run render:xixi:storybook
```

也可以一次生成全部：

```bash
npm run render:xixi:styles
npm run validate:xixi:styles
```

详细说明见 `docs/style-switching.md`。

## 输入文件

### `config/viewport.example.json`

这里记录截图当时的地图视口。要达到 1:1 覆盖，这些参数必须来自真实地图实例，而不是手填猜测。

关键字段：

- `width` / `height`：截图真实像素尺寸，不是 CSS 尺寸。
- `center`：地图中心点，经纬度数组 `[lng, lat]`。
- `zoom`：地图缩放级别。
- `tileSize`：地图引擎使用的世界像素基准。Mapbox/MapLibre 通常是 `512`，Leaflet/OSM slippy tile 常见是 `256`。
- `coordinateSystem`：截图地图使用的坐标系。常见值：`WGS84`、`GCJ02`、`BD09`。
- `bearing` / `pitch`：当前 MVP 只支持 `0`。如果截图有旋转或倾斜，需要接入对应地图引擎的相机矩阵。

浏览器端采集模板见 `snippets/collect-viewport.js`。截图时一定要同步采集 viewport，否则后面无法保证 1:1 覆盖。

### `data/example-map.geojson`

示例矢量地图数据。生产中建议来源是：

- 自有测绘数据。
- 地图服务返回的矢量瓦片。
- OSM/POI/建筑数据清洗后的 GeoJSON。
- 人工校准后的景区道路、水系、设施数据。

注意：数据坐标系必须在配置里声明。比如数据是 WGS84，但底图来自高德/腾讯，渲染前需要转成 GCJ02，否则会整体偏移。

### `styles/handdrawn.example.json`

手绘样式配置。样式只影响视觉，不应该改变主体几何。

## 推荐生产链路

1. 从原生地图实例拿到截图和视口参数。
2. 用同一 bounds 拉取矢量数据。
3. 将数据坐标系转换到原生地图使用的坐标系。
4. 使用本工作流渲染同尺寸手绘图。
5. 将 SVG/PNG 作为 image overlay 或瓦片 overlay 叠回原生地图。
6. 用截图尺寸、道路中心线误差、mask IoU 做自动验收。

## 为什么不直接用 AI 重画整图

通用图像生成模型会重构道路、边界、文字和建筑，它可以“看起来像”，但不会承诺像素级位置一致。适合生产的方式是：程序锁定几何，AI 只参与纹理、图标、局部装饰和风格化素材。

## 下一步扩展

- 接入 MapLibre/Mapbox/高德/腾讯地图的真实视口采集。
- 从矢量瓦片自动提取道路、水系、绿地、建筑和 POI。
- 输出 PNG/WebP 瓦片：`z/x/y` 切片，支持地图缩放移动。
- 引入 AI 纹理库，但通过 polygon mask 裁剪，禁止 AI 改动几何。
- 增加截图差异检测：道路中心线偏差、绿地/水体 mask IoU、POI 锚点偏差。
