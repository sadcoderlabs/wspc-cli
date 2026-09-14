# 驗收報告：Imported Event 與 Email 同步結果

日期：2026-09-15。CLI worktree `codex/inbound-invitation-contract`，功能 commit `2f446ffc`；server `codex/calendar-inbound-single-event`，功能 commit `1bd1e799`。

由 server 的本地 OpenAPI 產生 SDK／CLI，未手改 generated files。JSON 保留 Event／Agenda 的 invitation、Email detail 的 calendar_sync；`event set` 的說明包含 `IMPORTED_EVENT_READ_ONLY`。OpenAPI snapshot 同步也包含 upstream 已合併的 Drive schema 更新。

本地 wrangler dev + proxy 8780，CLI 本地 build，非 TTY JSON 輸出。`event show`／`event agenda` 保留 UTC／IANA／全天的 invitation metadata；PATCH Imported Event exit 1 並顯示 `IMPORTED_EVENT_READ_ONLY`。`event rm`→外部更新→`event restore` 回到相同 ID 的最新快照；ICS 保留外部 UID／SEQUENCE。

`email show` 讀回真實 local callback 的 `untrusted / unverified_sender`；對本地合成工作注入 normalized trust fixture 後，cron 經真實 Workers RPC 建立 Event，讀回 `calendar_sync.status=created` 與 event_id。這不是 production provider 信任驗證。完整低敏 server 證據將連於 server PR。

`npm run typecheck`、746 項 tests、`npm run build` 通過。CLI 既有 JSON renderer 不丟棄新欄位，無需新增 invite command 或 output renderer。

尚待 server merge／deploy 後同步 live OpenAPI，CLI PR exact-head CI、merge、既有 release workflow 與 installed package 驗證。Provider 啟用由獨立 Todo `tod_01M2GDMWXJ2EKZN9WMJWD8711V` 處理；本次 upstream 預設停用。
