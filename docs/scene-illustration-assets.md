# 景点插画层需要的材料

当前只有一张高德手绘导览截图时，可以可靠提取：

- 整体色盘：浅绿湿地、浅蓝水系、橙色游线、米白建筑。
- 表现手法：水彩晕染、柔和描边、白墙黛瓦、树丛和水岸的松散边缘。
- 视觉层级：道路和景点建筑更醒目，水系/绿地作为底。

已经基于这张参考图新增：

- `styles/jiangnan-guide.json`
- `output/styles/xixi-jiangnan-guide.svg`

已经基于“西溪湿地观光氦气球”照片新增：

- `data/attractions/xixi-attractions.json`
- `scripts/render-attractions-overlay.js`
- `output/attractions/xixi-attractions-overlay.svg`
- `output/attractions/xixi-jiangnan-with-attractions.svg`

## 仅靠这一张图做不到什么

它不能可靠生成“现实中每个景点相似”的插画，因为缺少：

- 景点的精确坐标。
- 景点真实外观照片。
- 景点名称和优先级。
- 建筑朝向和适合放在地图上的简化角度。

如果只用这一张图硬生成景点，很容易得到“江南建筑味道有，但不像西溪具体景点”的结果。

## 最小可行材料

如果要开始做景点插画层，最少给这些就够：

```csv
name,longitude,latitude,priority,notes
高庄,120.xxxxxx,30.xxxxxx,1,白墙黛瓦园林建筑
河渚街,120.xxxxxx,30.xxxxxx,1,水乡街区
深潭口,120.xxxxxx,30.xxxxxx,1,码头和水面
中国湿地博物馆,120.xxxxxx,30.xxxxxx,2,现代建筑
```

每个一级景点最好提供 `1-3` 张照片。照片不必很专业，但要能看出主体轮廓。

## 推荐实现方式

景点插画不要直接揉进底图。更稳的是新增一个独立 overlay：

1. 保持当前 1:1 SVG 底图不动。
2. 为每个景点生成独立小插画 PNG/SVG。
3. 根据 `longitude/latitude` 投影到像素坐标。
4. 自动避让道路、水体和边缘。
5. 输出 `xixi-attractions-overlay.svg` 或 `xixi-attractions-overlay.png`。

这样景点插画可以反复换风格、调位置，不会破坏底图对齐。

## 当前景点 Overlay 命令

生成透明景点图层：

```bash
npm run render:xixi:attractions
```

生成带江南底图的合成预览：

```bash
npm run compose:xixi:attractions
```

输出：

- `output/attractions/xixi-attractions-overlay.svg`
- `output/attractions/xixi-attractions-overlay.json`
- `output/attractions/xixi-jiangnan-with-attractions.svg`

## 新增景点格式

继续在 `data/attractions/xixi-attractions.json` 里添加：

```json
{
  "id": "unique-id",
  "name": "景点名称",
  "type": "helium-balloon",
  "priority": "high",
  "coordinate": [120.069696, 30.274025],
  "size": 150,
  "label": {
    "enabled": true,
    "text": "短标签",
    "dx": 52,
    "dy": 66
  },
  "references": [
    "/absolute/path/to/photo.jpg"
  ],
  "notes": "景点外观特征"
}
```

如果是新的景点类型，比如亭、桥、码头、博物馆，需要在 `scripts/render-attractions-overlay.js` 里加一个对应的 `renderXxx` 模板。
