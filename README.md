# 堯順工程行智慧儀表板

> 內部管理工具：訂單建立、出貨追蹤、收款管理、本月營運分析、AI 智慧顧問。
> 後端用 Firebase Firestore 即時同步，可由 LINE Bot / 多個前端裝置同步寫入。

---

## 技術棧

| 分類 | 選用 |
|---|---|
| 前端框架 | React 19 + TypeScript |
| 建置工具 | Vite 8 |
| UI 系統 | Tailwind CSS v4 + shadcn/ui (Base UI) |
| 圖示 | Lucide |
| 雲端資料 | Firebase Firestore (即時訂閱) |
| AI 顧問 | Google Gemini 2.5 Flash（可選），規則引擎 fallback |
| 資料匯出 | xlsx (SheetJS) + 原生 Blob / `window.print()` |
| 字體 | Geist Variable |

---

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 設定 Firebase

到 [Firebase Console](https://console.firebase.google.com) 建立專案後：

1. **加入 Web App**：專案首頁 → 「+ 新增應用程式」→ 選 Web (`</>`)
2. **複製 firebaseConfig**：註冊完會出現一段 JS 設定，6 個值要保留
3. **啟用 Firestore**：左側選單 → Firestore Database → 「建立資料庫」→ 選 `asia-east1` → 選**測試模式**

### 3. （可選）設定 Gemini AI

到 [Google AI Studio](https://aistudio.google.com/apikey) 建立 API key（免費額度每天 1500+ 次）。

⚠️ `VITE_*` 變數會被打包進前端 bundle = **公開資訊**。上線前請去 Google AI Studio / Cloud Console 把 key 鎖定 HTTP referrer 和 API 範圍。

### 4. 環境變數

複製 `.env.example` 為 `.env.local`，填入設定值：

```env
# Firebase（必填）
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=1:...:web:...

# Gemini AI（可選，留空會自動 fallback 到本地規則引擎）
VITE_GEMINI_API_KEY=AIzaSy...
VITE_GEMINI_MODEL=gemini-2.5-flash

# 範例資料寫入（本機 only；正式 build 請保持 false）
VITE_ENABLE_SEED=false
```

| 變數 | 必填 | 說明 |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | ✓ | Firebase Web app key |
| `VITE_FIREBASE_AUTH_DOMAIN` | ✓ | `your-project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | ✓ | Firebase project id |
| `VITE_FIREBASE_STORAGE_BUCKET` | ✓ | `your-project.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | ✓ | FCM sender id |
| `VITE_FIREBASE_APP_ID` | ✓ | Firebase Web app id |
| `VITE_GEMINI_API_KEY` | | 留空會自動 fallback 到本地規則引擎 |
| `VITE_GEMINI_MODEL` | | 預設 `gemini-2.5-flash` |
| `VITE_ENABLE_SEED` | | `true` 才會啟用「寫入/清除範例資料」按鈕與 `seedSampleData()`；正式 build 請保持 `false`，避免不小心把 `SEED_*` 文件寫到正式 Firestore |

> `.env.local` 已被 `.gitignore` 排除，不會推上 GitHub。

### 5. 啟動開發伺服器

```bash
npm run dev
```

打開 http://localhost:5173 即可看到儀表板。

> 修改 `.env.local` 後一定要 **重啟** dev server，Vite 只在啟動時讀 env。

### 6. 灌範例資料（首次啟動建議）

兩種方式擇一：

**方式 A（CLI，最快）：**
```bash
npm run seed
```

**方式 B（瀏覽器）：** 打開儀表板 → Header 右上角點「**寫入範例資料**」按鈕

任一方式都會寫入 17 筆範例資料：7 個使用者、5 個產品、5 筆訂單。

---

## 範例資料管理

所有範例資料的 document ID 都帶 `SEED_` 前綴，方便辨識與清除。

### 寫入

```bash
npm run seed
```

或在儀表板 Header 點「補充範例」。

### 清除

```bash
npm run seed:clear
```

或在儀表板 Header 點「清除範例」（資料量不為空時才出現）。

清除動作只會刪除 ID 以 `SEED_` 開頭的文件，**手動建立的訂單不會受影響**。

### 在 Firebase Console 直接管理

到 [Firestore 資料頁](https://console.firebase.google.com/project/_/firestore/data) 也可以直接看 / 編輯 / 刪單筆。

---

## 資料庫 Schema

### Users

文件 ID：使用者的 LINE User ID（例：`U1234567890abcdef`）

| 欄位 | 型態 | 必填 | 說明 |
|---|---|---|---|
| `role` | string | ✓ | `boss` / `customer`（系統只有兩種角色；送達是由 boss 在 dashboard 上回報，沒有 driver 角色） |
| `displayName` | string | ✓ | 顯示名稱 |
| `phone` | string | | 聯絡電話 |
| `createdAt` | Timestamp | ✓ | 加入時間 |
| `notes` | string | | 備註 |

### Products

文件 ID：自動產生

| 欄位 | 型態 | 必填 | 說明 |
|---|---|---|---|
| `productName` | string | ✓ | 產品名稱 |
| `spec` | string | ✓ | 規格 |
| `price` | number | ✓ | 單價 |
| `isActive` | boolean | ✓ | 是否上架 |

### Orders

文件 ID：自動產生

| 欄位 | 型態 | 必填 | 說明 |
|---|---|---|---|
| `customerId` | string | | 下單客戶 LINE ID；dashboard 手動新增、尚未綁定 LINE 的店家可留空字串 |
| `customerName` | string | ✓ | 客戶名稱（反正規化欄位） |
| `driverId` | string \| null | ✓ | **送貨人員的自由文字標籤**（例如 "阿明"、車號）。**不是** Users 的 foreign key。`null` ＝**尚未指派**（系統永遠不會寫字串 `"尚未指派"`）。dashboard 從「標記送達」對話框寫入 |
| `items` | array | ✓ | 訂單品項陣列（見下） |
| `totalAmount` | number | ✓ | 訂單總金額 ＝ Σ `items[].subtotal` |
| `paymentStatus` | string | ✓ | `unpaid` / `paid` / **`pending_confirmation`**（客戶在 LINE 回報已付款，但老闆尚未確認入帳） |
| `paymentMethod` | string \| null | | `cash` / `transfer` / `check`。**狀態不是 `paid` 時固定為 `null`** |
| `orderDate` | Timestamp | ✓ | 下單時間 |
| `deliveryDate` | Timestamp \| null | | **只由 boss 在 dashboard 的「標記送達」對話框寫入**（透過 `markOrderDelivered` 用 `serverTimestamp()`）；其他狀態維持 `null` |
| `paidAt` | Timestamp \| null | | **只在轉換成 `paid` 時設**（dashboard 與 bot 一律用 `serverTimestamp()`，避免使用者本機時鐘不準） |
| `createdAt` | Timestamp | ✓ | 建單時的伺服器時間（`serverTimestamp()`） |

`items` 陣列每筆物件結構：

```ts
{
  productName: string
  spec: string
  quantity: number
  unitPrice: number
  subtotal: number  // = quantity * unitPrice
}
```

> **設計備註**：`customerName` 採反正規化（從 Users 複製），避免出報表時對 Users 做二次查詢，以空間換查詢效能。

> **遷移備註**：在這個 PR 落地之前建立的舊訂單可能沒有 `paidAt` 欄位，已結清訂單會以 `paidAt = null` 顯示；無需 migration script。
>
> **角色遷移備註**：舊 `Users` 文件如果 `role === "driver"`，dashboard 讀取時會自動 coerce 成 `"customer"` 並 `console.warn` 一次（含 doc ID 方便清理）。等順便在 Firebase Console 把這些舊文件的 `role` 欄位改成 `"customer"` 即可，沒有 hard requirement。

---

## 專案架構

```
src/
├── App.tsx                       # 主畫面：sidebar + 5 個視圖切換
├── main.tsx                      # entry，包 PreferencesProvider
├── index.css                     # Tailwind v4 + 主題 token
├── components/
│   ├── AIAdvisorPanel.tsx        # AI 智慧建議面板（含 24h 快取）
│   ├── SettingsDialog.tsx        # 個人資料 / 外觀 / 偏好設定
│   └── ui/                       # shadcn 基礎元件
├── hooks/
│   └── usePreferences.tsx        # 偏好設定 (主題/字體/強調色) + Provider
├── lib/
│   ├── aiAdvisor.ts              # AI 顧問：Gemini call + 規則引擎 + 快取
│   ├── firebase.ts               # Firebase init (env 驅動)
│   ├── firestore.ts              # collection 訂閱、CRUD、type converter
│   ├── seed.ts                   # 範例資料寫入 / 清除（瀏覽器版）
│   └── utils.ts                  # cn() helper
scripts/
└── seed.mjs                      # 範例資料寫入 / 清除（CLI 版）
```

### 視圖（左側 sidebar 對應）

| 視圖 | 內容 |
|---|---|
| 總覽 | 8 顆 KPI、付款方式圓環圖、近期訂單（客戶名可點開歷史）、智慧提醒、訂單狀態統計 |
| 填寫資料 | 訂單表單，支援多品項陣列、Products 下拉自動帶入價格（**規格隨產品名顯示，避免同名 SKU 混淆**）。送出後**留在頁面**並清空表單，方便連續建單 |
| 訂單作業 | **合併原本的「帳款」+「出貨」**：4 顆 KPI、5 個過濾 chip（全部/待出貨/待收款/待確認/久未收 ≥7 天）、可摺疊「待備商品總覽」、統一表格同時顯示出貨與收款狀態，FIFO 排序，支援匯出 CSV / Excel、列印 PDF |
| 客戶 | 客戶名冊：搜尋 + 累計營收 / 目前未收 / 最近訂單統計，點客戶名或「查看歷史」開啟單一客戶歷史訂單彈窗（含累積/已結清/目前未收摘要 + 訂單明細與操作） |
| 洞察 | **合併原本的「分析」+「提醒」**：AI 智慧建議（Gemini 或規則引擎）、付款方式分析、訂單狀態總覽、久未收款明細（客戶名可點開歷史）、**累積未收排行 Top 5 視覺化** |

> 任何表格的客戶名稱都是可點按鈕（hover 會 underline），點下去會打開該客戶的歷史訂單彈窗，可在彈窗內直接執行確認入帳 / 標記送達 / 編輯 / 刪除等操作。

---

## AI 智慧建議

「洞察」分頁的核心功能。系統會分析 Firestore 內的訂單、客戶、商品資料，給出 3-7 條客製化營運建議。

### 雙引擎切換

面板右上角可切換：

| Provider | 條件 | 行為 |
|---|---|---|
| **Google Gemini** | `VITE_GEMINI_API_KEY` 已設定 | 真 LLM 分析，回傳結構化 JSON |
| **規則引擎** | 永遠可用 | 內建 13 條規則，本地秒回，零成本 |

任一 provider 失敗會自動 fallback 到規則引擎，不會白屏。

### 建議分類

| 嚴重度 | 顏色 | 適用情境 |
|---|---|---|
| 🚨 critical | 紅 | 金額大或時間久的緊急問題（如 30 天未收且 > 5 萬） |
| ⚠️ warning | 琥珀 | 需要注意的趨勢（收款率偏低、待出貨堆積） |
| ℹ️ info | 青 | 觀察類洞察（高頻客戶、商品占比、沉睡客戶） |
| ✅ positive | 綠 | 正向訊號（收款健康、營收成長） |

### 24 小時快取機制

| 觸發時機 | 行為 |
|---|---|
| 第一次掛載 / 切換 provider | 先讀 localStorage 快取，<24h 直接用、>24h 才呼叫 API |
| 切回洞察分頁 | 讀快取 → 不呼叫 API |
| Firestore 資料變動 | **不會自動觸發**（避免燒額度） |
| 點「重新分析」按鈕 | 強制呼叫 API、覆蓋快取、24 小時計時器歸零 |

效果：每天進站第一次自動更新一次，其他時間都用快取，Gemini 免費額度可永遠用不完。

兩個 provider 的快取分開存（key: `aiAdvisor:cache:gemini` / `aiAdvisor:cache:rules`），切換 provider 不會誤刪。

### 接其他 AI Provider

[src/lib/aiAdvisor.ts](src/lib/aiAdvisor.ts) 已預留 `openai` / `claude` 的 enum 與 dispatch 點：

```ts
if (provider === "gemini") suggestions = await callGemini(...)
// TODO: callOpenAI / callClaude 之後再補
```

要接 OpenAI 或 Claude 只要實作對應 `callXXX` 函式並補進 dispatch，UI 會自動顯示對應的 provider label。

---

## 資料匯出

「訂單作業 / 客戶 / 洞察」三個視圖頂端皆有 **匯出列**（[ExportBar](src/components/ExportBar.tsx)），可勾選欄位後產出三種格式：

| 格式 | 實作 | 行為 |
|---|---|---|
| **CSV** | 原生 Blob + UTF-8 BOM | 直接下載 `.csv`，Excel 開啟不亂碼 |
| **Excel** | [xlsx (SheetJS)](https://www.npmjs.com/package/xlsx) `aoa_to_sheet` + `writeFile` | 直接下載 `.xlsx`，數值 / 日期保留原始型別 |
| **PDF** | `window.open()` + `window.print()` | 開新視窗自動觸發列印，使用者選「另存 PDF」即可 |

### 操作流程

1. 進入「訂單作業 / 客戶 / 洞察」任一視圖
2. 在匯出列勾選要匯出的欄位（可全選 / 清除）
3. 點「匯出 CSV」/「匯出 Excel」/「列印 PDF」

### 檔名規則

下載檔名格式為 `{filename}_YYYYMMDD.{ext}`，例：`unpaid_orders_20260509.xlsx`。

### 列印樣式

PDF 列印頁會帶標題、列印時間戳、總筆數，表格採斑馬紋，`@media print` 自動裁掉按鈕，列印後關閉視窗即可。

---

## 個人化設定

點 sidebar 左下角頭像或齒輪，可調整：

### 個人資料
- 顯示名稱、角色（老闆 / 客戶）、電話、備註
- 角色會影響頭像配色（紫色＝老闆，綠色＝客戶）

### 外觀（即時生效）
- **主題模式**：淺色 / 深色 / 跟隨系統
- **字體大小**：小 14px / 中 16px / 大 18px
- **強調色**：薰衣草紫、湖水青、玫瑰紅、琥珀橘、石墨黑（5 色預設）

### 偏好
- 啟動時預設視圖

> 偏好設定存於瀏覽器 localStorage，不會上 Firestore；每台裝置可獨立設定。

---

## 開發指令

```bash
npm run dev          # 啟動開發伺服器（預設 localhost:5173）
npm run build        # tsc 型別檢查 + vite build → dist/
npm run preview      # 預覽 dist 產出
npm run lint         # 跑 ESLint

npm run seed         # CLI 寫入範例資料到 Firestore
npm run seed:clear   # CLI 清除所有 SEED_ 前綴文件
```

---

## 部署

`npm run build` 產出 `dist/` 為純靜態檔，可部署到任何靜態 hosting。

**Firebase Hosting**（建議，與 Firestore 同個專案）：
```bash
npm install -g firebase-tools
firebase login
firebase init hosting    # 選 dist 為 public 目錄、選 SPA 改寫
firebase deploy
```

**其他選項**：Vercel / Netlify / Cloudflare Pages 任一靜態 hosting 都可。記得在 hosting 平台設定環境變數（同 `.env.local` 的所有 `VITE_*`）。

---

## Firestore 規則 & 索引

`firestore.rules`、`firestore.indexes.json`、`firebase.json` 已 commit 在 repo 根目錄。
要部署兩者：

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

> ⚠ **規則尚未啟用**：`firestore.rules` 是與 LINE bot 對齊的 baseline，但需要先把 Firebase Auth 整合與 custom claim `role` 上線後才能 deploy（不然會擋掉現有的 dev seed 流程）。Auth 接好之前，`firebase.json` 會被 `firebase deploy` 讀但你只要不執行那個指令就不會觸發。

### 角色規則摘要

系統只有兩種角色：`boss` 與 `customer`。送達回報由 boss 在 dashboard 進行
（透過「標記送達」對話框寫入 `deliveryDate` + 自由文字 `driverId`），bot 不
再有 driver command surface。

| Collection | boss | customer |
|---|---|---|
| Users | read all + write | 只能讀自己 |
| Products | read + write | read |
| Orders | read + write 全部；可建立未綁定 LINE ID 的手動訂單 | 只能 read 自己的、create 時 `customerId` 必須等於 `request.auth.uid`（**customer 不能 update**） |

### 索引

`firestore.indexes.json` 已預先放入 dashboard + bot 兩端會用到的複合索引：

- `Orders` (customerId asc, orderDate desc) — 客戶歷史訂單頁
- `Orders` (customerName asc, orderDate desc) — dashboard 客戶搜尋
- `Orders` (paymentStatus asc, orderDate asc) — 訂單作業分頁的「未收款」/「待確認」過濾

### Gemini API Key 限制

到 [Google AI Studio](https://aistudio.google.com/apikey) → 編輯你的 key：

1. **Application restrictions** 選 `HTTP referrers`，加入允許的網域：
   - `http://localhost/*`（開發）
   - 你的正式網域（如 `https://yaoshun.web.app/*`）
2. **API restrictions** 勾 `Restrict key`，只啟用 `Generative Language API`

這樣 key 就算被人扒走，他在自己的網域也用不了。

---

## 跨 repo 協作

這個 dashboard 與 LINE bot **共用同一個 Firestore 專案**：

- LINE bot：[OogaryoO/yaoshun](https://github.com/OogaryoO/yaoshun)
  - schema 定義在 [`services/firebase_db.py`](https://github.com/OogaryoO/yaoshun/blob/main/services/firebase_db.py)
  - 訂單寫入流程在 [`handlers/message_router.py`](https://github.com/OogaryoO/yaoshun/blob/main/handlers/message_router.py)

兩端需要遵守相同的 `OrderDoc` 合約（見上方 [Orders schema](#orders)）。重點：

| 欄位 | 寫入端 | 規則 |
|---|---|---|
| `paymentStatus = "pending_confirmation"` | LINE bot（客戶回報已付） | dashboard 的「待老闆確認」chip 會撈出來 |
| `paymentStatus = "paid"` + `paidAt` | dashboard 的「確認入帳」按鈕 | 永遠用 `serverTimestamp()`，不能用 client 時鐘 |
| `deliveryDate` + `driverId`（free-text label） | dashboard 的「標記送達」對話框 | 透過 `markOrderDelivered(id, label)` 寫入。bot 端需移除 `_handle_driver_message` / `送達 ORD-…` driver command 與 `update_order_payment(driver_id=…)` 參數 |
| `driverId` | 兩端皆可寫 | **自由文字標籤**（boss 在 dashboard 上手打或從 datalist 選），**不是** Users foreign key。`null` 表示未指派，永遠不要寫 `"尚未指派"` |
| `role = "driver"` 舊文件 | n/a | dashboard 讀取時 coerce 成 `"customer"` 並 `console.warn`。bot 端如果還在寫這個值需要一起拿掉 |
| `Users` / `Products` 寫入 | dashboard 會用 `setDoc(..., { merge: true })` | 確保 bot 之後新增欄位（例如 `lastSeenAt`、`liffConsent`）不會被覆蓋 |

`firestore.indexes.json` 是 dashboard 與 bot 的**共同 source of truth**；bot 端的 README 應反向 link 到這份檔案，不要各自維護一份。

---

## 開發、測試、CI

```bash
npm run dev          # 本機 dev server
npm run lint         # ESLint
npm run test         # Vitest
npm run build        # tsc + vite build
```

GitHub Actions [`.github/workflows/ci.yml`](.github/workflows/ci.yml) 會在 push / PR 時跑
`npm ci && npm run lint && npm run test && npm run build`。lint 暫時設 `continue-on-error`，
等遺留錯誤清完後再變硬性 gate。

---

## 後續路線圖

- [ ] LINE Login 整合，使用者首次登入自動寫入 Users
- [ ] LIFF 表單給客戶下單（讀 Products、寫 Orders）
- [ ] LINE Notify Webhook：未收款 / 待出貨提醒
- [x] 對帳報表 CSV / Excel / PDF 匯出（訂單作業・客戶・洞察三視圖）
- [x] **儀表板 IA 重整**：把「帳款 + 出貨」合併為「訂單作業」、「分析 + 提醒」合併為「洞察」、新增「客戶」歷史頁與彈窗、表單送出後留頁、產品下拉顯示規格
- [x] `pending_confirmation` 狀態與「確認入帳」流程
- [x] `paidAt` 欄位用 `serverTimestamp()` 寫入
- [x] commit `firestore.rules` / `firestore.indexes.json`（**尚未 deploy**，等 Auth 接好）
- [ ] Firebase Auth + 部署 `firestore.rules`
- [ ] 接 OpenAI / Claude 作為備援 AI provider
- [ ] AI 建議的點讚/採納回饋機制（用來迭代 prompt）
