# Rumi Club

手機優先的多人線上拉密，支援 2–6 人即時同桌。

## 開始遊戲

```sh
cd web
npm install
npm run dev
```

在房主電腦開啟終端輸出的網址。朋友連上同一個 Wi-Fi 後，使用終端顯示的 Network 網址開啟遊戲，輸入房間代碼加入。

## 專案文件

- [產品規格](docs/PRODUCT_SPEC.md)：目前功能、遊戲規則、UI 行為與已知限制。
- [功能變更紀錄](CHANGELOG.md)：新增、調整與修正，區分未發布與已推送基準。
- [開發守則](AGENTS.md)：每次開發必須遵循的維護、文件與驗證流程。
- [架構與維護](docs/ARCHITECTURE.md)：模組責任、Socket 協定與漸進重構方向。
- [功能紀錄範本](docs/FEATURE_TEMPLATE.md)：較複雜需求的設計與驗收紀錄。

產品行為以產品規格為主要文件；新增功能時同步更新規格與變更紀錄，避免同一規則散落多份文件。

## 部署到 Render

專案根目錄的 `render.yaml` 已設定免費 Node Web Service。先將專案提交並推送到 GitHub，接著在 Render 選擇 **New → Blueprint**，連結 `weichung13/rummikub` 並部署。Render 會依 Blueprint 從 `web/` 安裝依賴、建置前端，再用同一個服務提供網站與即時遊戲連線。

免費服務閒置後會休眠，重新連線時需要等待喚醒；伺服器重啟會清除記憶體中的房間。Render 部署完成後會提供 `https://...onrender.com` 網址，可分享給朋友。

牌局結束後可留在原房間，由房主按「再來一場」重新洗牌發牌；至少兩人且所有玩家在線才能開始。

## 開發檢查

```sh
cd web
npm run build
npm run lint
npm test
```

建置涵蓋前端、後端與測試的 TypeScript 檢查。測試包含牌組規則、首次 30 點、桌面牌保留、非法輸入與真實 Socket 重連；整合測試會啟動使用隨機連接埠的本機伺服器。
