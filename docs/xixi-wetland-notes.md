# 西溪湿地当前配置

当前西溪湿地手绘地图使用的覆盖范围：

```json
{
  "west": 120.043168,
  "south": 30.246442,
  "east": 120.091978,
  "north": 30.281192
}
```

坐标系：`GCJ02`，来源为高德地图。

对应配置文件：

- `config/xixi-wetland.viewport.json`

对应输出文件：

- `data/xixi-wetland.osm.geojson`
- `output/xixi-wetland-handdrawn.svg`
- `output/xixi-wetland-overlay.json`

## 当前调整

- 已扩大西溪湿地显示范围。
- 已关闭 OSM POI 抓取。
- 已移除手绘地图上的 POI 点和文字标签图层。
- 已按高德 `GCJ02` bounds 重新生成；OSM 数据仍以 `WGS84` 拉取，渲染时转换到 `GCJ02` 后再叠加。

## 如果还是不完整

你只需要给我目标范围的两个角坐标即可：

```json
{
  "southWest": [120.0200, 30.2400],
  "northEast": [120.1000, 30.2900]
}
```

格式说明：

- `southWest` 是左下角：`[最小经度, 最小纬度]`
- `northEast` 是右上角：`[最大经度, 最大纬度]`
- 坐标系最好说明一下：`WGS84`、`GCJ02` 或 `BD09`

如果不知道坐标系，告诉我坐标来源，比如“高德地图拾取器”“百度地图拾取器”“OSM”，我来判断。
