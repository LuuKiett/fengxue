'use client'

import React, { useState } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import MobileDrawer from '@/components/layout/MobileDrawer'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-[#f0f2f5]">
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setDrawerOpen(true)} />

        <main className="flex-1 p-4 md:p-8 overflow-y-auto w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Mobile Slide-out Drawer, opened via the header hamburger — same nav as the desktop Sidebar */}
      <MobileDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}
