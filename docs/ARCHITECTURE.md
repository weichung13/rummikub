# 架構與維護

## 現有結構

| 位置 | 目前責任 |
| --- | --- |
| `web/src/App.tsx` | 入口、牌桌、操作列、Socket 訂閱、本地草稿及提示；目前仍集中在單一元件 |
| `web/src/App.css`、`index.css` | 功能樣式、響應式版面、全域主題 |
| `web/src/game.ts` | 共享型別、牌組合法性／排序／點數、牌堆建立 |
| `web/server/index.ts` | Express 靜態網站、Socket 事件、記憶體房間、玩家身分、狀態推進與個別廣播 |
| `web/server/validation.ts` | 未知網路輸入的形狀與大小驗證 |
| `web/server/turn.ts` | 純函式出牌驗證：牌的來源、保留、重複、首次門檻 |
| `web/tests/game.test.ts` | 規則及輸入驗證的自動化測試 |
| `web/tests/server.test.ts` | 真實 Socket 的身分、重連、離開、交接與空房清理整合測試 |
| `render.yaml` | 單一 Node Web Service 建置與啟動設定 |

## 資料與責任邊界

使用者操作 → 前端本地草稿 → Socket 請求 → 輸入與目前玩家驗證 → 規則驗證 → 伺服器修改牌局 → 個別 `GameView` → 前端更新。

伺服器保留完整房間；`GameView` 只包含觀看者自己的手牌。客戶端傳来的牌面數值不可信，伺服器用牌 ID 找回自己的實體牌。`validateTurn` 不修改房間，由 handler 在驗證成功後集中套用結果。

`revision` 表示已提交牌局版本，不等於任何房間資料的更新次數。前端以房號與 revision 決定是否重設草稿；新增狀態時必須判斷它是否真的會令目前草稿失效。

## Socket 協定摘要

| 方向／事件 | 資料與效果 |
| --- | --- |
| 客戶端 `room:create` | `{ name }`；建立房間與私密座位 |
| 客戶端 `room:join` | `{ name, code, token?, reconnect? }`；新加入或恢復座位 |
| 客戶端 `room:leave` | 無參數；移除座位、必要時交接或結束牌局 |
| 客戶端 `game:start` | 無參數；只有房主可開始或在結束後重開，需至少兩人且全部在線；重建牌局並遞增 revision |
| 客戶端 `game:play` | 牌組陣列；每張牌至少有 `id`；服務端重新取得權威牌面 |
| 客戶端 `game:draw` | 無參數；摸牌或牌堆空時略過 |
| 伺服器 `room:seat` | 私密 `{ playerId, token, code, name }`，僅傳本人 |
| 伺服器 `room:update` | 觀看者專屬 `GameView` |
| 伺服器 `room:left` | 離開處理完成後，前端清除保存座位 |
| 伺服器 `room:error` | 目前是顯示用字串；不是結構化錯誤碼 |
| 伺服器 `game:drawn` | 本人摸到的牌，用於動畫 |

現行請求沒有 request ID 或正式 acknowledgement；前端以狀態事件解鎖，10 秒等待逾時顯示提示。逾時不代表伺服器沒有執行，增加自動重試前需先設計去重及請求識別。

## 漸進改善方向（尚未完成）

1. 涉及入口、牌桌或回合控制的新功能，按需抽取 `EntryScreen`、`GameTable`、`HandRack`、`TurnControls` 等呈現元件；純畫面接收 props 與 callbacks。
2. 將 Socket 訂閱／重連收斂到專用 hook，將草稿操作整理為 reducer 或純函式，減少元件內交錯副作用。
3. 將房間生命週期與狀態轉移抽離 transport handler，透過明確函式驗證轉移前置條件。
4. 共享事件型別與結構化錯誤碼，避免依錯誤文字前綴控制畫面。修改時同步遷移兩端。
5. 整理 CSS 重複覆蓋；必要時按元件分檔。這些是維護方向，不要求一次重寫或新增狀態管理框架。

每次抽取維持對外行為，先用相關測試保護目前規則，再改模組邊界。新增可設定規則前，先定義預設值、房間建立時機與協定表示方式。

## 開發與部署

- 從 `web/` 執行 `npm run dev` 同時啟動 Vite 與後端。Vite 代理 `/socket.io` 到 3001；後端使用 `PORT` 或預設 3001。
- 前端支援開發熱更新；目前後端用 `tsx server/index.ts`，修改後需重啟。
- `npm run build` 檢查前端、後端、測試的 TypeScript，再建置前端。`npm run lint` 執行 oxlint，`npm test` 執行 Node 測試。
- 整合測試啟動隨機連接埠的子程序；需要本機監聽權限。測試須等待對應玩家的事件，不能把其他廣播誤當操作完成。
- 部署設定由 `web/` 執行 `npm ci --include=dev && npm run build`，再 `npm run server`；同一服務提供 `dist` 與 Socket，健康檢查為 `/healthz`。
- 房間記憶體狀態無法跨程序保存；重啟與協定升級需在發布說明中交代對現有玩家的影響。

## 最低驗收情境

變更涉及哪個部分，就覆蓋該部分成功與失敗情境：首次不足／達到 30 點、鬼牌重組、桌面牌不可遺失、非法輸入、私密資料隔離、舊連線失效、重連草稿保留、房主離開、最後一人離開、主動離開結束牌局。UI 另驗證邀請入口、單一送出行為、3 秒提醒、固定操作列與長牌組捲動。

目前沒有自動化瀏覽器測試套件；UI 人工或瀏覽器工具驗證需另行記錄，不能以 `npm test` 通過取代。
