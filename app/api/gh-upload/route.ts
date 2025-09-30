// app/api/gh-upload/route.ts  (или src/app/api/gh-upload/route.ts)
export const runtime = 'nodejs';            // не edge
export const dynamic = 'force-dynamic';     // чтобы не кешировалось

export async function GET() {
  return new Response(JSON.stringify({
    ok: true,
    note: "gh-upload API is alive",
  }), { status: 200, headers: { 'Content-Type': 'application/json' }});
}
