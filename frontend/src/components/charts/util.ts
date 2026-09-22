import { useLayoutEffect, useRef, useState } from 'react'

/** Width of an element, kept current with a ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** 0 / step / 2·step … covering `max` with at most `count` + 1 clean ticks. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && Number.isInteger(s)) ?? Math.ceil(raw)
  const ticks: number[] = []
  for (let v = 0; v < max + step; v += step) ticks.push(v)
  return ticks
}

const nf = new Intl.NumberFormat()
export const fmt = (n: number) => nf.format(Math.round(n))

/** 1,284 / 12.9K / 1.2M */
export function compact(n: number): string {
  if (Math.abs(n) < 10_000) return fmt(n)
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function pct(part: number, whole: number, digits = 0): string {
  return whole ? `${((part / whole) * 100).toFixed(digits)}%` : '—'
}

export function duration(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

/** Local calendar date for a day offset from today (0 = today). */
export function dayToDate(day: number): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + day)
  return d
}

export const shortDate = (day: number) => dayToDate(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
export const longDate = (day: number) =>
  dayToDate(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

export function dayLabel(day: number): string {
  if (day === 0) return 'Today'
  if (day === -1) return 'Yesterday'
  if (day === 1) return 'Tomorrow'
  return longDate(day)
}

/** Range label for a bucket of days. */
export function rangeLabel(from: number, to: number): string {
  return from === to ? dayLabel(from) : `${shortDate(from)} – ${shortDate(to)}`
}
