'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Smartphone, Lock, ArrowRight, Sparkles } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const phoneTrimmed = phone.trim()
    if (!phoneTrimmed) {
      setError('Vui lòng nhập số điện thoại')
      setLoading(false)
      return
    }

    if (!/^[0-9]{9,11}$/.test(phoneTrimmed)) {
      setError('Số điện thoại phải gồm 9–11 chữ số')
      setLoading(false)
      return
    }

    const email = `${phoneTrimmed}@fengxue.com`

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

      if (signInError) {
        setError(
          signInError.message === 'Invalid login credentials'
            ? 'Số điện thoại hoặc mật khẩu không chính xác'
            : signInError.message
        )
        setLoading(false)
      } else {
        // Keep the button in its loading state through the redirect — it only resets
        // on error above, since a successful login unmounts this page on navigation.
        router.push('/dashboard')
        router.refresh()
      }
    } catch (err: any) {
      setError(err?.message || 'Có lỗi xảy ra, vui lòng thử lại')
      setLoading(false)
    }
  }

  return (
    <div className="cartoon-card p-8 md:p-10 bg-white">
      {/* Logo */}
      <div className="flex flex-col items-center mb-8">
        <div className="relative mb-3 flex items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-[#e7f3ff] flex items-center justify-center text-[#189fec] font-chinese text-3xl font-black border-2 border-slate-200">
            学
          </div>
          <Sparkles className="w-5 h-5 text-amber-400 absolute -top-1 -right-1 animate-sparkle" />
        </div>
        <h1 className="text-2xl font-black text-slate-800 tracking-tight">
          FENGXUE
        </h1>
        <p className="text-slate-400 font-extrabold text-sm mt-1">Học tiếng Trung cực dễ & cực vui! 🐼</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        {error && (
          <div className="bg-rose-50 border-2 border-rose-200 text-rose-600 rounded-2xl p-4 text-xs font-black flex items-center gap-2 animate-shake">
            ⚠️ {error}
          </div>
        )}

        {/* Phone */}
        <div>
          <label className="block text-slate-500 text-xs font-black uppercase tracking-wider mb-2">
            Số điện thoại
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-slate-400">
              <Smartphone className="w-5 h-5" />
            </span>
            <input
              id="phone-input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0912345678"
              disabled={loading}
              className="pl-12 w-full px-4 py-3.5 rounded-2xl font-bold border-2 border-slate-200 bg-slate-50/50 focus:bg-white focus:border-[#189fec] focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all text-slate-800"
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label className="block text-slate-500 text-xs font-black uppercase tracking-wider mb-2">
            Mật khẩu
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-slate-400">
              <Lock className="w-5 h-5" />
            </span>
            <input
              id="password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              disabled={loading}
              className="pl-12 w-full px-4 py-3.5 rounded-2xl font-bold border-2 border-slate-200 bg-slate-50/50 focus:bg-white focus:border-[#189fec] focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all text-slate-800"
            />
          </div>
        </div>

        {/* Submit */}
        <button
          id="login-btn"
          type="submit"
          disabled={loading}
          className="cartoon-btn w-full py-3.5 text-sm font-black flex items-center justify-center gap-2 mt-2"
        >
          {loading ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Đang xác thực...
            </>
          ) : (
            <>
              Đăng Nhập
              <ArrowRight className="w-4 h-4 stroke-[3]" />
            </>
          )}
        </button>
      </form>

      <div className="mt-6 text-center text-sm font-black text-slate-400">
        Chưa có tài khoản?{' '}
        <Link href="/register" className="text-[#189fec] hover:underline font-bold">
          Đăng ký miễn phí
        </Link>
      </div>
    </div>
  )
}
