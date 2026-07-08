'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { User, Smartphone, Lock, ArrowRight, Sparkles } from 'lucide-react'

export default function RegisterPage() {
  const router = useRouter()
  const supabase = createClient()

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!fullName.trim()) { setError('Vui lòng nhập họ và tên'); setLoading(false); return }

    const phoneTrimmed = phone.trim()
    if (!phoneTrimmed) { setError('Vui lòng nhập số điện thoại'); setLoading(false); return }
    if (!/^[0-9]{9,11}$/.test(phoneTrimmed)) { setError('Số điện thoại phải gồm 9–11 chữ số'); setLoading(false); return }
    if (password.length < 6) { setError('Mật khẩu phải ít nhất 6 ký tự'); setLoading(false); return }
    if (password !== confirmPassword) { setError('Mật khẩu xác nhận không khớp'); setLoading(false); return }

    const email = `${phoneTrimmed}@fengxue.com`

    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName.trim(), phone: phoneTrimmed },
        },
      })

      if (signUpError) { setError(signUpError.message); setLoading(false); return }

      if (signUpData.user) {
        router.push('/dashboard')
        router.refresh()
      } else {
        setError('Có lỗi xảy ra trong quá trình đăng ký')
      }
    } catch (err: any) {
      setError(err?.message || 'Có lỗi xảy ra, vui lòng thử lại')
    } finally {
      setLoading(false)
    }
  }

  const fields = [
    { id: 'fullname-input', icon: User, label: 'Họ và tên', type: 'text', value: fullName, setter: setFullName, placeholder: 'Nguyễn Văn A' },
    { id: 'phone-reg-input', icon: Smartphone, label: 'Số điện thoại', type: 'tel', value: phone, setter: setPhone, placeholder: '0912345678' },
    { id: 'password-reg-input', icon: Lock, label: 'Mật khẩu', type: 'password', value: password, setter: setPassword, placeholder: 'Tối thiểu 6 ký tự' },
    { id: 'confirm-password-input', icon: Lock, label: 'Xác nhận mật khẩu', type: 'password', value: confirmPassword, setter: setConfirmPassword, placeholder: 'Nhập lại mật khẩu' },
  ]

  return (
    <div className="cartoon-card p-8 md:p-10 bg-white">
      {/* Logo */}
      <div className="flex flex-col items-center mb-6">
        <div className="relative mb-3 flex items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-[#e7f3ff] flex items-center justify-center text-[#189fec] font-chinese text-3xl font-black border-2 border-slate-200">
            学
          </div>
          <Sparkles className="w-5 h-5 text-amber-400 absolute -top-1 -right-1 animate-sparkle" />
        </div>
        <h1 className="text-2xl font-black text-slate-800 tracking-tight">Tạo Tài Khoản</h1>
        <p className="text-slate-400 font-extrabold text-sm mt-1">Học tiếng Trung cực dễ & cực vui! 🐼</p>
      </div>

      <form onSubmit={handleRegister} className="space-y-4">
        {error && (
          <div className="bg-rose-50 border-2 border-rose-200 text-rose-600 rounded-2xl p-3.5 text-xs font-black flex items-center gap-2 animate-shake">
            ⚠️ {error}
          </div>
        )}

        {fields.map(({ id, icon: Icon, label, type, value, setter, placeholder }) => (
          <div key={id}>
            <label className="block text-slate-500 text-xs font-black tracking-wider mb-1.5">
              {label}
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-slate-400">
                <Icon className="w-4.5 h-4.5" />
              </span>
              <input
                id={id}
                type={type}
                value={value}
                onChange={(e) => setter(e.target.value)}
                placeholder={placeholder}
                disabled={loading}
                className="pl-11 w-full px-4 py-3 rounded-2xl font-bold border-2 border-slate-200 bg-slate-50/50 focus:bg-white focus:border-[#189fec] focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all text-slate-800 placeholder-slate-300"
              />
            </div>
          </div>
        ))}

        <button
          id="register-btn"
          type="submit"
          disabled={loading}
          className="cartoon-btn w-full py-3.5 text-sm font-black flex items-center justify-center gap-2 mt-2"
        >
          {loading ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Đang đăng ký...
            </>
          ) : (
            <>
              Đăng Ký
              <ArrowRight className="w-4 h-4 stroke-[3]" />
            </>
          )}
        </button>
      </form>

      <div className="mt-5 text-center text-sm font-black text-slate-400">
        Đã có tài khoản?{' '}
        <Link href="/login" className="text-[#189fec] hover:underline font-bold">
          Đăng nhập
        </Link>
      </div>
    </div>
  )
}
