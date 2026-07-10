# 麻糬捏捏

可以用滑鼠或手指捏臉頰的麻糬果凍互動頭像。

## 功能

- 桌機用滑鼠拖曳臉頰
- 手機用手指拖曳
- 最多支援兩指同時拉左右臉頰
- 放開後會用彈簧物理彈回原位
- 整個畫板都可以互動：沒有碰到麻糬時，麻糬會微微朝滑鼠或點擊方向偏過去
- Canvas 2D 網格變形，不依賴 WebGL，直接打開 `index.html` 也比較不容易遇到圖片載入問題

## 使用方式

直接打開：

```bash
index.html
```

或使用 Vite：

```bash
npm install
npm run dev
```

## 部署到 GitHub Pages

1. 把專案推到 GitHub repository。
2. 進入 `Settings` → `Pages`。
3. Source 選 `Deploy from a branch`。
4. Branch 選 `main`，資料夾選 `/root`。
5. 儲存後等待 GitHub Pages 產生網址。

## 更換圖片

把你的圖片覆蓋到：

```text
assets/avatar.png
```

建議使用正方形圖片，效果會最好。
