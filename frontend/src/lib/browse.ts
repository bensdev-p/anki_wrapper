import { useCallback, useEffect, useRef, useState } from 'react'
import { useBackend } from '../backend/context'
import type { BrowseRow, BrowseSort } from '../backend/types'

export const PAGE = 100

/**
 * Pages of browser rows for one search, fetched as they scroll into view.
 * The previous results stay visible (dimmed) while a new search loads.
 */
export function useBrowse(query: string, sort: BrowseSort, reverse: boolean) {
  const backend = useBackend()
  const [total, setTotal] = useState<number | null>(null)
  const [fsrs, setFsrs] = useState(true)
  const [pages, setPages] = useState<Map<number, BrowseRow[]>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const inflight = useRef(new Set<number>())
  const params = useRef({ query, sort, reverse })
  params.current = { query, sort, reverse }

  const fetchPage = useCallback(
    async (page: number, gen: number) => {
      if (inflight.current.has(page)) return
      inflight.current.add(page)
      try {
        const { query: q, sort: s, reverse: r } = params.current
        const res = await backend.browse(q, s, r, page * PAGE, PAGE)
        if (gen !== generation.current) return
        setTotal(res.total)
        setFsrs(res.fsrs)
        setError(null)
        setPages((prev) => new Map(prev).set(page, res.rows))
      } catch (e) {
        if (gen === generation.current) setError(e instanceof Error ? e.message : String(e))
      } finally {
        inflight.current.delete(page)
        if (gen === generation.current) setLoading(false)
      }
    },
    [backend],
  )

  /** Start over (new search, or after a change): page 0 replaces the old results. */
  const reload = useCallback(() => {
    const gen = ++generation.current
    inflight.current.clear()
    setLoading(true)
    const keep = pages
    void backend
      .browse(params.current.query, params.current.sort, params.current.reverse, 0, PAGE)
      .then(
        (res) => {
          if (gen !== generation.current) return
          setTotal(res.total)
          setFsrs(res.fsrs)
          setError(null)
          setPages(new Map([[0, res.rows]]))
        },
        (e: Error) => gen === generation.current && (setError(e.message), setPages(keep)),
      )
      .finally(() => gen === generation.current && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend])

  useEffect(() => {
    reload()
  }, [query, sort, reverse, reload])

  /** Make sure rows [start, end) are loaded. */
  const ensure = useCallback(
    (start: number, end: number) => {
      for (let p = Math.floor(start / PAGE); p <= Math.floor(Math.max(start, end - 1) / PAGE); p++) {
        if (!pages.has(p)) void fetchPage(p, generation.current)
      }
    },
    [fetchPage, pages],
  )

  const rowAt = useCallback((i: number) => pages.get(Math.floor(i / PAGE))?.[i % PAGE], [pages])

  return { total, fsrs, rowAt, ensure, reload, error, loading }
}
