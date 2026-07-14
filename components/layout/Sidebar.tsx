'use client'

import React from 'react'
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

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside
      className="hidden md:flex flex-col w-64 h-screen sticky top-0 p-4 justify-between bg-white border-r-2 border-slate-200"
    >
      <div className="space-y-1">
        {/* Brand/Logo */}
        <div className="flex items-center gap-3 px-3 py-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center font-chinese text-xl font-black text-[#189fec] bg-[#e7f3ff] border border-slate-200 flex-shrink-0"
          >
            学
          </div>
          <div>
            <h1 className="font-black text-lg text-slate-800 leading-none tracking-wide">FENGXUE</h1>
            <span className="text-[10px] font-bold text-slate-400">
              Học Tiếng Trung 🐼
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="h-[2px] bg-slate-100 mx-3 rounded-full" />

        {/* Nav Links */}
        <nav className="space-y-2 px-1">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'))
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl font-black text-sm transition-all duration-100 group relative overflow-hidden"
                style={
                  isActive
                    ? {
                        background: '#ffffff',
                        color: '#189fec',
                        border: '2px solid #189fec',
                        borderBottom: '5px solid #189fec',
                        transform: 'translateY(-2px)'
                      }
                    : {
                        background: 'transparent',
                        color: '#64748b',
                        border: '2px solid transparent',
                        borderBottom: '2px solid transparent',
                      }
                }
              >
                <span
                  className={`transition-all duration-200 relative z-10 ${isActive ? 'text-[#189fec]' : 'text-slate-400 group-hover:text-[#189fec]'}`}
                >
                  <Icon className="w-5 h-5" />
                </span>
                <span className="relative z-10 group-hover:text-[#189fec] transition-colors duration-200">
                  {item.label}
                </span>
                {isActive && (
                  <Sparkles className="w-4 h-4 text-amber-400 absolute right-3 animate-sparkle" />
                )}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Log out */}
      <div className="px-1 pb-2">
        <div className="h-[2px] bg-slate-100 mx-3 mb-4 rounded-full" />
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl font-black text-sm transition-all duration-200 group text-slate-500 hover:text-rose-600 hover:bg-rose-50"
        >
          <LogOut className="w-5 h-5 text-slate-400 group-hover:text-rose-500" />
          <span>Đăng Xuất</span>
        </button>
      </div>
    </aside>
  )
}
