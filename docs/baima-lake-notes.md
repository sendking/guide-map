# 杭州滨江区白马湖配置

当前白马湖手绘地图使用的覆盖范围：

```json
{
  "west": 120.199731,
  "south": 30.157279,
  "east": 120.213047,
  "north": 30.164914
}
```

坐标系：`GCJ02`，按高德地图坐标处理。

## 命令

```bash
npm run fetch:baima
npm run render:baima
npm run validate:baima
```

输出：

- `data/baima-lake.osm.geojson`
- `output/baima-lake-jiangnan.svg`
- `output/baima-lake-overlay.json`

## 说明

- 抓取 OSM 数据时，会把高德 `GCJ02` bounds 转成 `WGS84`。
- 渲染时，会把 OSM `WGS84` 几何转回 `GCJ02`。
- 输出 overlay bounds 保持高德坐标不变，方便叠回高德地图。
