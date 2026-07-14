'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard,
  BookOpen,
  GraduationCap,
  Dumbbell,
  CalendarDays,
  Library,
  ListChecks,
  ClipboardList,
  LogOut,
  X,
  Sparkles,
  Trophy,
  Tags,
} from 'lucide-react'

const navItems = [
  { href: '/dashboard',          label: 'Tổng Quan',        icon: LayoutDashboard },
  { href: '/vocabulary',         label: 'Từ Vựng',          icon: BookOpen },
  { href: '/learn',              label: 'Học Từ Mới',       icon: GraduationCap },
  { href: '/exercises',          label: 'Luyện Tập',        icon: Dumbbell },
  { href: '/review',             label: 'Ôn Tập Tổng Hợp',  icon: CalendarDays },
  { href: '/dictionary',         label: 'Từ Điển',          icon: Library },
  { href: '/review-dictionary',  label: 'Ôn Tập Từ Điển',   icon: ListChecks },
  { href: '/vocabulary-by-topic', label: 'Học Theo Chủ Đề', icon: Tags },
  { href: '/practice-exam',      label: 'Luyện Đề TOCFL',   icon: ClipboardList },
  { href: '/thi-thu',            label: 'Thi Thử TOCFL',    icon: Trophy },
]

interface MobileDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export default function MobileDrawer({ isOpen, onClose }: MobileDrawerProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  // Lock body scroll while the drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    onClose()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`md:hidden fixed inset-0 z-[60] bg-slate-900/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer panel, slides in from the left */}
      <aside
        className={`md:hidden fixed top-0 left-0 bottom-0 z-[70] w-72 max-w-[85vw] bg-white shadow-2xl transition-transform duration-300 ease-out flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center font-chinese text-lg font-black text-[#189fec] bg-[#e7f3ff] border border-slate-200">
              学
            </div>
            <span className="font-black text-slate-800 tracking-wide">FENGXUE</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-50 text-slate-500"
            aria-label="Đóng menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'))
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl font-black text-sm transition-all relative ${
                  isActive ? 'bg-[#e7f3ff] text-[#189fec]' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
                {isActive && <Sparkles className="w-4 h-4 text-amber-400 absolute right-3 animate-sparkle" />}
              </Link>
            )
          })}
        </nav>

        <div className="p-3 border-t border-slate-100">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl font-black text-sm text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>Đăng Xuất</span>
          </button>
        </div>
      </aside>
    </>
  )
}
