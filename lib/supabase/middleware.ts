import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export const updateSession = async (request: NextRequest) => {
  // Create an unmodified response
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // This will refresh session if expired
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAuthRoute = path.startsWith('/login') || path.startsWith('/register')
  const isDashboardRoute = 
    path === '/' ||
    path.startsWith('/dashboard') ||
    path.startsWith('/vocabulary') ||
    path.startsWith('/learn') ||
    path.startsWith('/exercises') ||
    path.startsWith('/review')

  if (isDashboardRoute) {
    if (!user) {
      // Redirect to login if trying to access dashboard and not logged in
      return NextResponse.redirect(new URL('/login', request.url))
    } else if (path === '/') {
      // Redirect to dashboard from landing page if logged in
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  if (isAuthRoute && user) {
    // Redirect to dashboard if logged in and trying to access login/register
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}
