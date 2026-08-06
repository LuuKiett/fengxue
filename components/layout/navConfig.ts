// Shared nav structure for Sidebar.tsx (desktop) and MobileDrawer.tsx (mobile) — a
// single source of truth so the two stop duplicating (and drifting on) the same list.
// Grouped/collapsible per explicit user request to shorten what used to be 13 flat
// top-level links: "Tự Điền Từ Vựng" (Từ Vựng/Học Từ Mới/Luyện Tập/Ôn Tập Tổng Hợp),
// "Từ Điển" (Từ Điển/Ôn Tập Từ Điển), "Chủ Đề" (Học Theo Chủ Đề/Tổng Hợp Chủ Đề), and
// "Tài Liệu & Luyện TOCFL" (Từ Điển TOCFL/Luyện Đề TOCFL/Thi Thử TOCFL). "Tổng Quan"
// and "Sách Giáo Khoa" stay standalone (not part of any group).
import {
  LayoutDashboard,
  BookOpen,
  GraduationCap,
  Dumbbell,
  CalendarDays,
  Library,
  ListChecks,
  ClipboardList,
  Trophy,
  Tags,
  BookMarked,
  Award,
  BookOpenText,
  PenLine,
  type LucideIcon,
} from 'lucide-react'

export interface NavLeaf {
  href: string
  label: string
  icon: LucideIcon
}

export interface NavGroup {
  label: string
  icon: LucideIcon
  items: NavLeaf[]
}

export type NavEntry = NavLeaf | NavGroup

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'items' in entry
}

export const navEntries: NavEntry[] = [
  { href: '/dashboard', label: 'Tổng Quan', icon: LayoutDashboard },
  {
    label: 'Tự Điền Từ Vựng',
    icon: PenLine,
    items: [
      { href: '/vocabulary', label: 'Từ Vựng', icon: BookOpen },
      { href: '/learn', label: 'Học Từ Mới', icon: GraduationCap },
      { href: '/exercises', label: 'Luyện Tập', icon: Dumbbell },
      { href: '/review', label: 'Ôn Tập Tổng Hợp', icon: CalendarDays },
    ],
  },
  {
    label: 'Từ Điển',
    icon: Library,
    items: [
      { href: '/dictionary', label: 'Từ Điển', icon: Library },
      { href: '/review-dictionary', label: 'Ôn Tập Từ Điển', icon: ListChecks },
    ],
  },
  {
    label: 'Chủ Đề',
    icon: Tags,
    items: [
      { href: '/vocabulary-by-topic', label: 'Học Theo Chủ Đề', icon: Tags },
      { href: '/full-dictionary', label: 'Tổng Hợp Chủ Đề', icon: BookMarked },
    ],
  },
  { href: '/textbook', label: 'Sách Giáo Khoa', icon: BookOpenText },
  {
    label: 'Tài Liệu TOCFL',
    icon: Award,
    items: [
      { href: '/tocfl-dictionary', label: 'Từ Điển TOCFL', icon: Award },
      { href: '/practice-exam', label: 'Luyện Đề TOCFL', icon: ClipboardList },
      { href: '/thi-thu', label: 'Thi Thử TOCFL', icon: Trophy },
    ],
  },
]

export function isHrefActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'))
}
