# WSPC CLI

WSPC CLI 將 WSPC API 的資料轉成適合人類閱讀或其他程式處理的命令列輸出。

## Language

**Calendar Date**:
以 ISO date-only（`YYYY-MM-DD`）表示的日曆日期；不包含時間或時區，也不代表該日午夜的 instant。
_Avoid_: Date-only timestamp、midnight timestamp

**Instant**:
時間軸上的單一時間點，以 Unix ms 或帶 `Z`／offset 的 ISO datetime 表示，能跨時區指向同一時刻。
_Avoid_: Calendar Date、offsetless datetime

**Relative Time**:
以目前時間為基準、按實際經過時間描述 Instant 距離的顯示值，例如 `2h ago`；不適用於 Calendar Date，也不表示日曆距離。
_Avoid_: Relative Date

**Exclusive End**:
不屬於事件區間的結束 Calendar Date；all-day event 以此表示事件涵蓋範圍。
_Avoid_: Inclusive End
