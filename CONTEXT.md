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

**Recurring Series**:
由一個 Series Master 與一個 Recurrence Rule 定義共同內容與排程的 Calendar Event pattern。
_Avoid_: Recurring event、repeated event、recurrence group

**Series Master**:
定義 Recurring Series 共同內容與 recurrence 的 authoritative Calendar Event；它不是個別 Occurrence。
_Avoid_: Parent event、template event、recurring event

**Occurrence**:
Recurring Series 的一個排程成員；即使有效時間後來改變，仍由原始 recurrence set 中的 start 識別。
_Avoid_: Instance、child event、generated event

**Occurrence Exception**:
只覆寫一個 Occurrence 時間或取消狀態的 persisted record，由 Series 與 immutable Recurrence ID 識別。
_Avoid_: Exception Event、Detached Event、independent Event row

**Recurrence ID**:
識別 Recurring Series 內單一 Occurrence 的 immutable original recurrence-set start；Occurrence 改期後仍不改變。
_Avoid_: Event ID、instance ID、occurrence start
