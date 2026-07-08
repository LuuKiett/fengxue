import React from 'react'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden px-4 py-8 bg-[#f0f2f5]">
      {/* Decorative cartoon elements */}
      <div className="absolute top-10 left-10 w-28 h-12 bg-white rounded-full opacity-60 filter blur-[1px] animate-cloud"></div>
      <div className="absolute bottom-20 right-10 w-36 h-16 bg-white rounded-full opacity-60 filter blur-[1px] animate-cloud-slow" style={{ animationDelay: '1.5s' }}></div>
      
      {/* Subtle cute floating bubbles */}
      <div className="absolute top-1/3 left-1/4 w-12 h-12 bg-sky-200/40 rounded-full animate-float-slow"></div>
      <div className="absolute bottom-1/4 left-10 w-16 h-16 bg-blue-200/30 rounded-full animate-float" style={{ animationDelay: '1s' }}></div>

      {/* Sparkles (4-pointed stars) background decorations */}
      <div className="absolute top-20 left-1/3 text-amber-400 text-3xl select-none animate-sparkle">✦</div>
      <div className="absolute bottom-1/3 left-12 text-[#189fec]/30 text-4xl select-none animate-sparkle" style={{ animationDelay: '0.5s' }}>✦</div>
      <div className="absolute top-1/3 right-16 text-[#189fec]/20 text-2xl select-none animate-sparkle" style={{ animationDelay: '1.2s' }}>✦</div>

      {/* Floating Chinese characters decorations */}
      <div className="absolute top-12 left-16 text-[#189fec]/10 font-chinese text-8xl font-black select-none animate-float-slow" style={{ animationDelay: '0.5s' }}>学</div>
      <div className="absolute bottom-20 right-16 text-[#189fec]/10 font-chinese text-7xl font-black select-none animate-float-slow" style={{ animationDelay: '3s' }}>汉</div>

      {/* Card Wrapper */}
      <div className="relative z-10 w-full max-w-md animate-bounce-in">
        {children}
      </div>
    </div>
  )
}
