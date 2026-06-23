# Drive mobile app roadmap

## 目標

建立一個 iOS / Android app，讓使用者可以在手機上登入 WSPC、瀏覽 Drive library 目錄、按需下載檔案閱讀，並在後續 milestone 支援文字檔編輯。

第一版以「更懶、更穩」為原則：mobile app 直接呼叫 WSPC Drive API，不包 `wspc-cli`，也不把 desktop sync engine 搬進手機。手機版先做 manifest browser 與 lazy download，不做完整資料夾同步。

每個 milestone 之後再各自撰寫詳細 spec。這份 roadmap 只記錄方向與切分，不一口氣設計所有畫面、狀態機與 conflict UX。

## 已定結論

- 第一版使用 React Native / Expo。
- 第一版建立獨立 GitHub repo，不把 `wspc-cli` 改成 monorepo。
- mobile app 不 spawn `wspc-cli`，也不打包 CLI。
- app 使用 OAuth / OIDC PKCE 登入，不在 app 內放 client secret。
- token 放在 mobile secure storage，不放在一般 app state。
- app 每次開啟時同步 library manifest，用 manifest 建立目錄結構。
- 檔案內容採 lazy download：使用者點選檔案時才下載。
- 已下載檔案用 manifest 的 `entry_version` / `current_version_id` 判斷是否需要重新下載。
- 第一版先做到 read-only；文字編輯與上傳放到後續 milestone。
- 非文字檔案第一版交給手機系統 viewer / share sheet，不自建 viewer。
- 如果未來 mobile / desktop / CLI 真的需要共享 Drive core，再評估 shared package 或 monorepo。

## 建議架構

```text
Expo mobile app
  -> OAuth PKCE login
  -> SecureStore token storage
  -> Drive library manifest API
  -> local manifest index
  -> lazy file download cache
  -> built-in text reader later
  -> system viewer for non-text files
```

本機資料分兩層：

- manifest index：記錄 library、path、entry version、content hash、size、mtime 等 metadata。
- file cache：只保存使用者開過的檔案內容，並用 remote version 判斷是否過期。

手機 app 不維護 `.wspc-drive/state.json`，也不做 desktop-style full folder sync。它是 Drive browser，不是 Drive daemon。

## Milestone 1：Auth 與 manifest browser

目標是先證明 mobile app 可以登入、取得 library manifest，並顯示目錄結構。

範圍：

- 建立獨立 Expo TypeScript project。
- 設定 iOS / Android redirect scheme。
- 使用 OAuth / OIDC PKCE 登入。
- 登出並清除 secure token。
- 取得使用者可用的 Drive libraries。
- 選擇一個 library。
- app 開啟或手動 refresh 時拉取完整 manifest。
- 將 manifest 轉成目錄樹 / 檔案列表。
- 保存 manifest metadata，讓 app 重開後可以先顯示上次索引，再背景 refresh。

不做：

- 不下載檔案內容。
- 不做文字編輯。
- 不做 offline edit。
- 不做 realtime / push sync。
- 不做多 library 同步策略。

完成後再寫 M2 spec。

## Milestone 2：Lazy download 與本機 cache

目標是讓使用者點選檔案時可以閱讀內容，並且避免重複下載同版本檔案。

範圍：

- 點選檔案時下載該檔案 content。
- 下載前檢查本機 cache 是否已有相同 `entry_version` / `current_version_id`。
- 若版本相同，直接開本機 cache。
- 若 manifest 顯示版本更新，重新下載並替換 cache。
- 文字檔先用 read-only text viewer 顯示。
- 非文字檔案寫入 app cache 後，交給系統 viewer / share sheet。
- 顯示 basic loading、download error、auth expired、file not found。

不做：

- 不在背景預抓所有檔案。
- 不做完整 offline library mirror。
- 不做自訂 PDF / image / office viewer。
- 不做編輯與上傳。

完成後再寫 M3 spec。

## Milestone 3：文字檔編輯與安全上傳

目標是支援 `txt` / `md` 檔案的基本閱讀與編輯，但避免資料遺失。

範圍：

- 內建文字編輯器支援 `txt` / `md`。
- 編輯時建立 draft state，不直接覆蓋 remote。
- 儲存時使用目前 manifest / cache 的 expected version 做 conditional upload。
- 上傳成功後更新 manifest index 與 file cache。
- 若 remote version 已變，停止覆蓋並提示使用者 refresh 或另存副本。
- 至少支援「放棄本機修改」與「保留本機副本」。

不做：

- 不做多人即時協作。
- 不做 CRDT。
- 不做完整 Git-like history。
- 不做 binary edit。
- 不做複雜 conflict merge UI；除非後續 spec 明確要求。

完成後再寫 M4 spec。

## Milestone 4：視痛點再做的項目

只有在 M1 到 M3 暴露真問題後才做。

可能項目：

- Markdown preview。
- 最近檔案 / favorite。
- 搜尋 manifest path / filename。
- 多 library 切換與 pinning。
- 更好的外部 viewer integration。
- 背景 refresh。
- Realtime manifest refresh hint。
- Offline read-only mode。
- 更完整 conflict resolution。
- app 內建立 / rename / delete 檔案。

這些目前不是第一版必要條件。

## Spec 拆分順序

1. M1 spec：只處理 Expo project、OAuth login/logout、library selection、manifest browser。
2. M2 spec：處理 lazy download、cache、read-only viewer、system viewer。
3. M3 spec：處理文字編輯、conditional upload、version conflict。
4. M4 spec：只在有實際痛點時撰寫。

每份 spec 都應先重新讀當時的 Drive API / OpenAPI、現有 Drive manifest 規格、mobile OAuth provider 設定與 Expo project 現況，再決定是否調整 milestone 邊界。
