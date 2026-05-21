import { useMemo, useState } from "react"
import { FileSpreadsheet, FileText, Printer } from "lucide-react"
import * as XLSX from "xlsx"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const FILTER_ALL = "__all__"

export type ExportFilter<T> = {
  optionsFor: (rows: T[]) => string[]
  matches: (row: T, selected: string) => boolean
}

export type ExportColumn<T> = {
  key: string
  label: string
  getValue: (row: T) => string | number | Date | null | undefined
  formatText?: (row: T) => string
  defaultSelected?: boolean
  filter?: ExportFilter<T>
}

type ExportBarProps<T> = {
  rows: T[]
  columns: ExportColumn<T>[]
  filename?: string
  title?: string
  className?: string
}

function formatDateText(value: Date) {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, "0")
  const day = `${value.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function valueToText<T>(column: ExportColumn<T>, row: T): string {
  if (column.formatText) return column.formatText(row)
  const raw = column.getValue(row)
  if (raw === null || raw === undefined) return ""
  if (raw instanceof Date) return formatDateText(raw)
  return String(raw)
}

function valueForExcel<T>(column: ExportColumn<T>, row: T): string | number | Date {
  if (column.formatText) return column.formatText(row)
  const raw = column.getValue(row)
  if (raw === null || raw === undefined) return ""
  return raw
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function todayStamp() {
  const now = new Date()
  const y = now.getFullYear()
  const m = `${now.getMonth() + 1}`.padStart(2, "0")
  const d = `${now.getDate()}`.padStart(2, "0")
  return `${y}${m}${d}`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function ExportBar<T>({
  rows,
  columns,
  filename = "export",
  title = "資料匯出",
  className,
}: ExportBarProps<T>) {
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        columns.filter((col) => col.defaultSelected !== false).map((col) => col.key),
      ),
  )
  const [filters, setFilters] = useState<Record<string, string>>({})

  const filterableColumns = useMemo(
    () => columns.filter((col): col is ExportColumn<T> & { filter: ExportFilter<T> } => Boolean(col.filter)),
    [columns],
  )

  const filterOptions = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const col of filterableColumns) {
      const opts = col.filter.optionsFor(rows).filter((v) => v !== "")
      map[col.key] = Array.from(new Set(opts)).sort((a, b) => a.localeCompare(b, "zh-Hant"))
    }
    return map
  }, [filterableColumns, rows])

  const filteredRows = useMemo(() => {
    return rows.filter((row) =>
      filterableColumns.every((col) => {
        const selectedValue = filters[col.key]
        if (!selectedValue || selectedValue === FILTER_ALL) return true
        return col.filter.matches(row, selectedValue)
      }),
    )
  }, [rows, filterableColumns, filters])

  const activeColumns = useMemo(
    () => columns.filter((col) => selected.has(col.key)),
    [columns, selected],
  )

  const canExport = filteredRows.length > 0 && activeColumns.length > 0

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
        // Unchecking the column clears its filter so the export stays consistent
        setFilters((curFilters) => {
          if (!curFilters[key] || curFilters[key] === FILTER_ALL) return curFilters
          const { [key]: _removed, ...rest } = curFilters
          return rest
        })
      } else {
        next.add(key)
      }
      return next
    })
  }

  const changeFilter = (key: string, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    // Setting a real filter implies the user wants that column visible
    if (value && value !== FILTER_ALL) {
      setSelected((current) => {
        if (current.has(key)) return current
        const next = new Set(current)
        next.add(key)
        return next
      })
    }
  }

  const selectAll = () => setSelected(new Set(columns.map((col) => col.key)))
  const clearAll = () => {
    setSelected(new Set())
    setFilters({})
  }

  const exportCsv = () => {
    if (!canExport) return
    const header = activeColumns.map((col) => csvEscape(col.label)).join(",")
    const body = filteredRows
      .map((row) =>
        activeColumns.map((col) => csvEscape(valueToText(col, row))).join(","),
      )
      .join("\r\n")
    const csv = `﻿${header}\r\n${body}\r\n`
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    downloadBlob(blob, `${filename}_${todayStamp()}.csv`)
  }

  const exportXlsx = () => {
    if (!canExport) return
    const aoa: Array<Array<string | number | Date>> = [
      activeColumns.map((col) => col.label),
      ...filteredRows.map((row) => activeColumns.map((col) => valueForExcel(col, row))),
    ]
    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, "資料")
    XLSX.writeFile(workbook, `${filename}_${todayStamp()}.xlsx`)
  }

  const printPdf = () => {
    if (!canExport) return
    const win = window.open("", "_blank", "width=1024,height=768")
    if (!win) return
    const headerCells = activeColumns
      .map((col) => `<th>${escapeHtml(col.label)}</th>`)
      .join("")
    const bodyRows = filteredRows
      .map((row) => {
        const cells = activeColumns
          .map((col) => `<td>${escapeHtml(valueToText(col, row))}</td>`)
          .join("")
        return `<tr>${cells}</tr>`
      })
      .join("")
    const stamp = new Date().toLocaleString("zh-TW")
    const html = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        font-family: "Helvetica Neue", "PingFang TC", "Microsoft JhengHei", sans-serif;
        margin: 24px;
        color: #111;
      }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td {
        border: 1px solid #d0d0d0;
        padding: 6px 8px;
        text-align: left;
        vertical-align: top;
        word-break: break-word;
      }
      th { background: #f5f5f5; font-weight: 600; }
      tr:nth-child(even) td { background: #fafafa; }
      @media print {
        body { margin: 12mm; }
        button { display: none; }
      }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">列印時間：${escapeHtml(stamp)}　·　共 ${filteredRows.length} 筆</div>
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    <script>
      window.addEventListener("load", function () {
        setTimeout(function () {
          window.focus();
          window.print();
        }, 50);
      });
    </script>
  </body>
</html>`
    win.document.open()
    win.document.write(html)
    win.document.close()
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-muted/30 p-3",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">匯出欄位（可篩選的欄位旁邊有下拉選單）</span>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="xs" onClick={selectAll}>
              全選
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={clearAll}>
              清除
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {columns.map((col) => {
            const checked = selected.has(col.key)
            const hasFilter = Boolean(col.filter)
            const filterValue = filters[col.key] ?? FILTER_ALL
            const options = filterOptions[col.key] ?? []
            return (
              <div key={col.key} className="flex items-center gap-1.5 text-sm">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(col.key)}
                    className="size-3.5 cursor-pointer accent-primary"
                  />
                  <span>{col.label}</span>
                </label>
                {hasFilter ? (
                  <Select
                    value={filterValue}
                    onValueChange={(next) => changeFilter(col.key, next as string)}
                  >
                    <SelectTrigger size="sm" className="min-w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={FILTER_ALL}>全部</SelectItem>
                        {options.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          共 {filteredRows.length} / {rows.length} 筆 · 已選 {activeColumns.length} 欄
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!canExport}
          >
            <FileText data-icon="inline-start" />
            匯出 CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportXlsx}
            disabled={!canExport}
          >
            <FileSpreadsheet data-icon="inline-start" />
            匯出 Excel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={printPdf}
            disabled={!canExport}
          >
            <Printer data-icon="inline-start" />
            列印 / PDF
          </Button>
        </div>
      </div>
    </div>
  )
}
