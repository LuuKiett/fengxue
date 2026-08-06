'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LogOut, Sparkles, ChevronDown } from 'lucide-react'
import { navEntries, isNavGroup, isHrefActive } from './navConfig'

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  // Explicit open/closed overrides — when a group has no override, it defaults to
  // open exactly when the current route is one of its children (see isOpen below).
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({})

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside
      className="hidden md:flex flex-col w-64 h-screen sticky top-0 p-4 justify-between bg-white border-r-2 border-slate-200"
    >
      <div className="space-y-1 overflow-y-auto">
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
          {navEntries.map((entry) => {
            if (!isNavGroup(entry)) {
              const isActive = isHrefActive(pathname, entry.href)
              const Icon = entry.icon
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
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
                    {entry.label}
                  </span>
                  {isActive && (
                    <Sparkles className="w-4 h-4 text-amber-400 absolute right-3 animate-sparkle" />
                  )}
                </Link>
              )
            }

            const groupActive = entry.items.some((item) => isHrefActive(pathname, item.href))
            const isOpen = manualOpen[entry.label] ?? groupActive
            const Icon = entry.icon

            return (
              <div key={entry.label}>
                <button
                  type="button"
                  onClick={() => setManualOpen((prev) => ({ ...prev, [entry.label]: !isOpen }))}
                  className="cursor-pointer flex items-center gap-3 w-full px-4 py-3 rounded-2xl font-black text-sm transition-all duration-100 group"
                  style={
                    groupActive
                      ? { background: '#e7f3ff', color: '#189fec', border: '2px solid transparent' }
                      : { background: 'transparent', color: '#64748b', border: '2px solid transparent' }
                  }
                >
                  <span className={groupActive ? 'text-[#189fec]' : 'text-slate-400 group-hover:text-[#189fec]'}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="flex-1 text-left group-hover:text-[#189fec] transition-colors duration-200">
                    {entry.label}
                  </span>
                  <ChevronDown className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div className="mt-1 ml-4 pl-3 border-l-2 border-slate-100 space-y-1">
                    {entry.items.map((item) => {
                      const isActive = isHrefActive(pathname, item.href)
                      const ItemIcon = item.icon
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-bold text-sm transition-all duration-100 group relative ${
                            isActive ? 'bg-[#e7f3ff] text-[#189fec]' : 'text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          <ItemIcon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#189fec]' : 'text-slate-400 group-hover:text-[#189fec]'}`} />
                          <span>{item.label}</span>
                          {isActive && (
                            <Sparkles className="w-3.5 h-3.5 text-amber-400 absolute right-2 animate-sparkle" />
                          )}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
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
