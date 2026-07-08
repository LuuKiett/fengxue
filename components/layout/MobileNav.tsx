'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  BookOpen,
  GraduationCap,
  Dumbbell,
  CalendarDays,
  Library,
  ListChecks,
} from 'lucide-react'

const navItems = [
  { href: '/dashboard',         label: 'Bảng',    icon: LayoutDashboard },
  { href: '/vocabulary',        label: 'Từ vựng', icon: BookOpen },
  { href: '/learn',             label: 'Học',      icon: GraduationCap },
  { href: '/exercises',         label: 'Luyện',    icon: Dumbbell },
  { href: '/review',            label: 'Ôn tập',   icon: CalendarDays },
  { href: '/dictionary',        label: 'Từ điển',  icon: Library },
  { href: '/review-dictionary', label: 'Ôn từ điển', icon: ListChecks },
]

export default function MobileNav() {
  const pathname = usePathname()

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 flex justify-around items-center px-2 py-2.5 z-40 bg-white border-t-2 border-slate-200"
      style={{
        boxShadow: '0 -4px 16px rgba(0,0,0,0.03)',
      }}
    >
      {navItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'))
        const Icon = item.icon

        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-2xl transition-all duration-200 relative border-2 border-transparent"
            style={isActive
              ? {
                  borderColor: '#189fec',
                  borderBottomWidth: '4px',
                  color: '#189fec',
                  transform: 'translateY(-1px)'
                }
              : { color: '#64748b' }
            }
          >
            <Icon className="w-5 h-5 relative z-10" />
            <span className="text-[10px] font-black relative z-10 tracking-tight">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
