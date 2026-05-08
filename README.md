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
```

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
| `role` | string | ✓ | `boss` / `driver` / `customer` |
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
| `customerId` | string | ✓ | 下單客戶 LINE ID |
| `customerName` | string | ✓ | 客戶名稱（反正規化欄位） |
| `driverId` | string | | 出貨司機 LINE ID |
| `items` | array | ✓ | 訂單品項陣列（見下） |
| `totalAmount` | number | ✓ | 訂單總金額 |
| `paymentStatus` | string | ✓ | `unpaid` / `paid` |
| `paymentMethod` | string \| null | | `cash` / `transfer` / `check` |
| `orderDate` | Timestamp | ✓ | 下單時間 |
| `deliveryDate` | Timestamp \| null | | 出貨時間（null 代表未出貨） |

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

---

## 專案架構

```
src/
├── App.tsx                       # 主畫面：sidebar + 6 個視圖切換
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
| 總覽 | 8 顆 KPI、付款方式圓環圖、近期訂單、智慧提醒、訂單狀態統計 |
| 填寫資料 | 訂單表單，支援多品項陣列、Products 下拉自動帶入價格 |
| 帳款 | 未收款訂單追蹤，含距今天數、出貨狀態 |
| 出貨 | 待出貨訂單清單，依下單時間排序 |
| 分析 | 已收款付款方式百分比、訂單狀態分佈 |
| 提醒 | **AI 智慧建議**（Gemini 或規則引擎）、久未收款明細表 |

---

## AI 智慧建議

「提醒」分頁的核心功能。系統會分析 Firestore 內的訂單、客戶、商品資料，給出 3-7 條客製化營運建議。

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
| 切回提醒分頁 | 讀快取 → 不呼叫 API |
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

## 個人化設定

點 sidebar 左下角頭像或齒輪，可調整：

### 個人資料
- 顯示名稱、角色（老闆/司機/客戶）、電話、備註
- 角色會影響頭像配色（紫/青/綠）

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

## 安全規則建議（上線前必改）

### Firestore 規則

預設「測試模式」30 天後會關閉所有寫入。正式環境建議改為：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /Users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId
                   || request.auth.token.role == 'boss';
    }
    match /Products/{id} {
      allow read: if request.auth != null;
      allow write: if request.auth.token.role == 'boss';
    }
    match /Orders/{id} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if request.auth.token.role == 'boss'
                            || request.auth.uid == resource.data.driverId;
    }
  }
}
```

> 啟用認證並設 custom claim `role` 後再切到此規則。

### Gemini API Key 限制

到 [Google AI Studio](https://aistudio.google.com/apikey) → 編輯你的 key：

1. **Application restrictions** 選 `HTTP referrers`，加入允許的網域：
   - `http://localhost/*`（開發）
   - 你的正式網域（如 `https://yaoshun.web.app/*`）
2. **API restrictions** 勾 `Restrict key`，只啟用 `Generative Language API`

這樣 key 就算被人扒走，他在自己的網域也用不了。

---

## 後續路線圖

- [ ] LINE Login 整合，使用者首次登入自動寫入 Users
- [ ] LIFF 表單給客戶下單（讀 Products、寫 Orders）
- [ ] LINE Notify Webhook：未收款 / 待出貨提醒
- [ ] 對帳報表 CSV 匯出
- [ ] Firebase Auth + 上述 Firestore 安全規則
- [ ] 接 OpenAI / Claude 作為備援 AI provider
- [ ] AI 建議的點讚/採納回饋機制（用來迭代 prompt）
