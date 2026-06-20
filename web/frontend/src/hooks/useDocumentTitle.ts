import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const PAGE_TITLES: Record<string, string> = {
  '/': '工作台',
  '/create': '创建短剧',
  '/works': '我的作品',
}

export function useDocumentTitle(suffix?: string) {
  const location = useLocation()

  useEffect(() => {
    const base = 'ViMax'
    const page = PAGE_TITLES[location.pathname]
      || (location.pathname.startsWith('/works/') ? '作品详情' : null)

    const title = suffix
      ? `${suffix} — ${base}`
      : page
        ? `${page} — ${base}`
        : base

    document.title = title
  }, [location.pathname, suffix])
}
