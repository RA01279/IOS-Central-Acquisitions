// middleware.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  // This exact route verifies its owner-scoped helper bearer credential itself.
  if (req.nextUrl.pathname === "/api/outlook-helper/worker" || req.nextUrl.pathname === "/api/agents/worker") return NextResponse.next();
  let response = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: any) => {
          response.cookies.set({ name, value, ...options });
        },
        remove: (name: string, options: any) => {
          response.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!user && !isLoginPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Protect everything except static assets, the unauthenticated health
  // check, and the login page itself (login is handled inside the middleware
  // body above, not excluded here, so the redirect-away-from-login-when-authed
  // logic still runs).
  // The PWA files (manifest, service worker, icons) and the logos must load
  // before sign-in, or the install prompt and the login page break.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/cron|api/export|api/digest|manifest.webmanifest|sw.js|pwa-icon|logo-white.svg|logo-navy.svg|pdf.worker.min.mjs|offline).*)"],
};
