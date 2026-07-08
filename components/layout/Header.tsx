'use client'

import React, { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Bell, Sparkles, Phone, LogOut, CheckCircle, HelpCircle } from 'lucide-react'

interface UserInfo {
  name: string
  phone: string
}

export default function Header() {
  const router = useRouter()
  const supabase = createClient()
  const [userInfo, setUserInfo] = useState<UserInfo>({ name: 'Học viên', phone: '' })
  const [initials, setInitials] = useState('HV')
  
  // Dropdown states
  const [showBellDropdown, setShowBellDropdown] = useState(false)
  const [showUserDropdown, setShowUserDropdown] = useState(false)

  // Refs for click outside
  const bellRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)

  // Dynamic notifications state
  const [notifications, setNotifications] = useState<string[]>([])

  useEffect(() => {
    async function fetchUserAndStats() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // Fetch profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, phone')
          .eq('id', user.id)
          .single()

        const nameVal = profile?.full_name || 'Học viên'
        const phoneVal = profile?.phone || user.phone || 'Chưa cập nhật'

        setUserInfo({
          name: nameVal,
          phone: phoneVal,
        })

        // Generate initials
        const parts = nameVal.trim().split(' ')
        setInitials(parts.length >= 2
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : nameVal.slice(0, 2).toUpperCase()
        )

        // Load today's activity stats to build real notification alerts
        const today = new Date().toISOString().split('T')[0]
        
        // 1. Vocabs count
        const { data: set } = await supabase
          .from('vocabulary_sets')
          .select('id')
          .eq('user_id', user.id)
          .eq('date', today)
          .single()

        let count = 0
        if (set) {
          const { count: vocabCount } = await supabase
            .from('vocabularies')
            .select('*', { count: 'exact', head: true })
            .eq('set_id', set.id)
          count = vocabCount || 0
        }

        // 2. Exercise record
        const { data: exercises } = await supabase
          .from('exercise_records')
          .select('exercise_type')
          .eq('user_id', user.id)
          .eq('date', today)
          .eq('is_completed', true)

        const completedCount = exercises?.length || 0

        const alerts: string[] = []
        if (count === 0) {
          alerts.push('📅 Bạn chưa thêm từ vựng nào hôm nay. Hãy tạo danh sách ngay nhé!')
        } else {
          alerts.push(`📝 Hôm nay bạn đã thêm ${count} từ vựng mới để luyện tập.`)
        }

        if (completedCount < 3) {
          alerts.push(`🎯 Bạn đã làm ${completedCount}/3 bài tập nối từ của ngày hôm nay.`)
        } else {
          alerts.push('🎉 Tuyệt vời! Bạn đã hoàn thành xuất sắc tất cả bài tập hôm nay.')
        }

        setNotifications(alerts)
      }
    }

    fetchUserAndStats()
  }, [supabase])

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setShowBellDropdown(false)
      }
      if (userRef.current && !userRef.current.contains(event.target as Node)) {
        setShowUserDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-6 py-3.5 bg-white border-b border-slate-200"
      style={{
        boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
      }}
    >
      {/* Greeting */}
      <div className="flex items-center gap-2.5">
        <Sparkles className="w-5 h-5 text-amber-400 animate-sparkle flex-shrink-0" />
        <div className="leading-tight">
          <span className="text-xs font-bold text-slate-400 block">{greeting},</span>
          <span className="text-sm font-black text-slate-700">{userInfo.name}! 🎉</span>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3 relative">
        {/* Notification Bell Dropdown Container */}
        <div className="relative" ref={bellRef}>
          <button
            onClick={() => {
              setShowBellDropdown(!showBellDropdown)
              setShowUserDropdown(false)
            }}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105 border border-slate-100 bg-[#e7f3ff] text-[#1877f2] relative cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {notifications.length > 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></span>
            )}
          </button>

          {/* Dropdown Menu for Bell */}
          {showBellDropdown && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl border border-slate-200 shadow-xl z-50 p-4 animate-bounce-in max-w-[calc(100vw-2rem)]">
              <h3 className="font-black text-slate-800 text-sm border-b border-slate-100 pb-2 mb-2 flex items-center gap-1.5">
                <span>🔔</span> Thông Báo Tiến Độ
              </h3>
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {notifications.length === 0 ? (
                  <p className="text-xs text-slate-400 font-bold py-2 text-center">Không có thông báo mới</p>
                ) : (
                  notifications.map((n, i) => (
                    <div key={i} className="text-xs text-slate-600 font-bold bg-slate-50 p-2.5 rounded-xl border border-slate-100 leading-relaxed">
                      {n}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile Avatar Dropdown Container */}
        <div className="relative" ref={userRef}>
          <button
            onClick={() => {
              setShowUserDropdown(!showUserDropdown)
              setShowBellDropdown(false)
            }}
            className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white text-xs tracking-wide cursor-pointer transition-all hover:scale-105"
            style={{ background: '#1877f2' }}
          >
            {initials}
          </button>

          {/* Dropdown Menu for User Profile */}
          {showUserDropdown && (
            <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl border border-slate-200 shadow-xl z-50 p-4 animate-bounce-in max-w-[calc(100vw-2rem)]">
              {/* User Meta */}
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100 mb-2">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white text-sm"
                  style={{ background: '#1877f2' }}
                >
                  {initials}
                </div>
                <div className="leading-tight overflow-hidden">
                  <h4 className="font-black text-slate-800 text-sm truncate">{userInfo.name}</h4>
                  <p className="text-[10px] text-slate-400 font-bold truncate">{userInfo.phone}</p>
                </div>
              </div>

              {/* Action Links */}
              <div className="space-y-1">
                <div className="flex items-center gap-2.5 p-2 rounded-xl text-xs text-slate-600 font-bold bg-slate-50 border border-slate-100">
                  <Phone className="w-4 h-4 text-slate-400" />
                  <div className="overflow-hidden">
                    <span className="block text-[9px] text-slate-400 uppercase leading-none mb-0.5">Số điện thoại</span>
                    <span className="block truncate">{userInfo.phone || 'Chưa cập nhật'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 p-2 rounded-xl text-xs text-slate-600 font-bold bg-slate-50 border border-slate-100">
                  <HelpCircle className="w-4 h-4 text-slate-400" />
                  <div>
                    <span className="block text-[9px] text-slate-400 uppercase leading-none mb-0.5">Trạng thái</span>
                    <span className="block text-emerald-500 font-extrabold">Đang hoạt động ✓</span>
                  </div>
                </div>

                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-xl text-xs text-red-600 font-black hover:bg-red-50 border border-transparent hover:border-red-100 transition-colors mt-2 text-left cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Đăng Xuất
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
